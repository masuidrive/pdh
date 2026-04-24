import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { URL } from "node:url";
import { evaluateAcVerificationTable } from "./ac-verification.mjs";
import { buildFlowView, getStep, renderMermaidFlow } from "./flow.mjs";
import { loadStepInterruptions } from "./interruptions.mjs";
import { loadJudgements } from "./judgements.mjs";
import { loadCurrentNote, parseStepHistory } from "./note-state.mjs";
import { createRedactor } from "./redaction.mjs";
import { loadStepUiOutput, loadStepUiRuntime } from "./step-ui.mjs";
import { hasCompletedProviderAttempt, latestAttemptResult, latestHumanGate, loadRuntime, readProgressEvents, stepDir } from "./runtime-state.mjs";

const MAX_TEXT = 120000;

export function startWebServer({ repoPath = process.cwd(), host = "127.0.0.1", port = 8765 } = {}) {
  const repo = resolve(repoPath);
  const server = createServer((request, response) => {
    handleRequest({ request, response, repo });
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(Number(port), host, () => {
      server.off("error", reject);
      const address = server.address();
      const actualHost = address.address === "::" ? "localhost" : address.address;
      resolveServer({
        server,
        repo,
        url: `http://${actualHost}:${address.port}/`
      });
    });
  });
}

function handleRequest({ request, response, repo }) {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    sendJson(response, 405, { error: "read_only_web_ui" });
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    sendHtml(response, renderHtml());
    return;
  }
  if (url.pathname === "/api/state") {
    sendJson(response, 200, collectState({ repo }));
    return;
  }
  if (url.pathname === "/api/flow.mmd") {
    sendText(response, 200, collectMermaid({ repo, variant: url.searchParams.get("variant") }));
    return;
  }
  sendJson(response, 404, { error: "not_found" });
}

function collectState({ repo }) {
  const runtime = loadRuntime(repo);
  const redactor = createRedactor({ repoPath: repo });
  const note = runtime.note;
  const run = runtime.run;
  const currentStep = run?.current_step_id ? getStep(runtime.flow, run.current_step_id) : null;
  const currentGate = run?.id && currentStep ? latestHumanGate({ stateDir: runtime.stateDir, runId: run.id, stepId: currentStep.id }) : null;
  const interruptions = run?.id && currentStep
    ? loadStepInterruptions({ stateDir: runtime.stateDir, runId: run.id, stepId: currentStep.id }).map((item) => redactObject(item, redactor))
    : [];
  const events = run ? readProgressEvents({ repoPath: repo, runId: run.id, limit: 120 }).map((event) => redactObject(event, redactor)) : [];
  const history = parseStepHistory(note.body).entries;
  const ac = evaluateAcVerificationTable({ repoPath: repo, allowUnverified: true });
  const variants = Object.fromEntries(["full", "light"].map((variant) => [
    variant,
    buildVariantState({ repo, runtime, variant, history, events, redactor })
  ]));
  const activeVariant = run?.flow_variant ?? note.pdh.variant ?? "full";
  const summary = buildSummary({ runtime, activeVariant: variants[activeVariant], ac, currentStep, currentGate, interruptions });
  return {
    repo,
    repoName: basename(repo),
    mode: "read-only",
    generatedAt: new Date().toISOString(),
    runtime: {
      run: run ? redactObject(run, redactor) : null,
      noteState: redactObject(note.pdh, redactor),
      currentStep: currentStep ? stepMeta(currentStep) : null
    },
    summary,
    flow: {
      activeVariant,
      variants
    },
    current: {
      gate: currentGate ? gatePayload(currentGate, redactor) : null,
      interruptions,
      nextAction: describeNextAction({ repo, runtime, currentStep, currentGate, interruptions }),
      stepArtifacts: currentStep && run?.id ? listStepArtifacts({ stateDir: runtime.stateDir, runId: run.id, stepId: currentStep.id, redactor }) : []
    },
    history,
    events,
    ac: {
      ok: ac.ok,
      counts: ac.counts,
      errors: ac.errors
    },
    git: gitState(repo, redactor),
    files: {
      note: join(repo, "current-note.md"),
      ticket: join(repo, "current-ticket.md")
    }
  };
}

function buildVariantState({ repo, runtime, variant, history, events, redactor }) {
  const view = buildFlowView(runtime.flow, variant, runtime.run?.current_step_id ?? null);
  const sequenceSet = new Set(view.sequence);
  const historyByStep = latestHistoryByStep(history);
  const steps = view.steps.map((step, index) => {
    const historyEntry = historyByStep.get(step.id) ?? null;
    const current = runtime.run?.current_step_id === step.id;
    const attempt = runtime.run?.id
      ? latestAttemptResult({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id, provider: step.provider })
      : null;
    const gate = runtime.run?.id ? latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }) : null;
    const interruptions = current && runtime.run?.id
      ? loadStepInterruptions({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }).map((item) => redactObject(item, redactor))
      : [];
    const progress = stepProgress({
      runtime,
      variant,
      sequence: view.sequence,
      index,
      step,
      historyEntry,
      gate,
      attempt,
      interruptions
    });
    const uiOutput = runtime.run?.id ? loadStepUiOutput({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }) : null;
    const uiRuntime = runtime.run?.id ? loadStepUiRuntime({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }) : null;
    return {
      ...stepMeta(step),
      progress,
      current,
      uiContract: step.ui ?? null,
      uiOutput: uiOutput ? redactObject(uiOutput, redactor) : null,
      uiRuntime: uiRuntime ? redactObject(uiRuntime, redactor) : null,
      historyEntry,
      latestAttempt: attempt ? redactObject(attempt, redactor) : null,
      gate: gate ? gatePayload(gate, redactor) : null,
      interruptions,
      judgements: runtime.run?.id
        ? loadJudgements({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }).map((judgement) => redactObject(judgement, redactor))
        : [],
      artifacts: runtime.run?.id ? listStepArtifacts({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id, redactor }) : [],
      events: events.filter((event) => event.stepId === step.id).slice(-12)
    };
  });
  const skippedSteps = runtime.flow.variants?.full?.sequence?.filter((stepId) => !sequenceSet.has(stepId)) ?? [];
  return {
    id: view.id,
    variant,
    count: steps.length,
    initial: view.initial,
    sequence: view.sequence,
    mermaid: renderMermaidFlow(runtime.flow, variant, runtime.run?.current_step_id ?? null),
    overview: buildOverview({ runtime, variant, steps }),
    steps,
    skippedSteps
  };
}

function buildOverview({ runtime, variant, steps }) {
  const groups = [
    { id: "start", label: "Start", title: "開始", stepIds: [] },
    { id: "plan", label: "Plan", title: "計画", stepIds: variant === "full" ? ["PD-C-2", "PD-C-3", "PD-C-4", "PD-C-5"] : ["PD-C-3", "PD-C-5"] },
    { id: "implement", label: "Build", title: "実装", stepIds: ["PD-C-6"] },
    { id: "review", label: "Review", title: "検証", stepIds: variant === "full" ? ["PD-C-7", "PD-C-8", "PD-C-9"] : ["PD-C-7", "PD-C-9"] },
    { id: "close", label: "Close", title: "完了承認", stepIds: ["PD-C-10"] },
    { id: "done", label: "End", title: "完了", stepIds: [] }
  ];
  return groups.map((group, index) => {
    if (group.id === "start") {
      return {
        ...group,
        state: runtime.run ? "done" : "pending"
      };
    }
    if (group.id === "done") {
      return {
        ...group,
        state: runtime.run?.status === "completed" ? "done" : "pending"
      };
    }
    const related = steps.filter((step) => group.stepIds.includes(step.id));
    if (related.some((step) => step.progress.status === "waiting" || step.progress.status === "blocked" || step.progress.status === "failed")) {
      return { ...group, state: "waiting" };
    }
    if (related.every((step) => step.progress.status === "done")) {
      return { ...group, state: "done" };
    }
    if (related.some((step) => step.current || step.progress.status === "running")) {
      return { ...group, state: "waiting" };
    }
    const beforeCurrent = steps.findIndex((step) => step.current);
    const relatedIndex = Math.min(...related.map((step) => steps.findIndex((item) => item.id === step.id)).filter((value) => value >= 0));
    return { ...group, state: beforeCurrent >= 0 && relatedIndex < beforeCurrent ? "done" : "pending" };
  });
}

function buildSummary({ runtime, activeVariant, ac, currentStep, currentGate, interruptions }) {
  const doneCount = activeVariant.steps.filter((step) => step.progress.status === "done").length;
  const total = activeVariant.steps.length;
  const openItems = [
    runtime.run?.status === "needs_human" ? 1 : 0,
    interruptions.length > 0 ? 1 : 0,
    runtime.run?.status === "blocked" ? 1 : 0,
    runtime.run?.status === "failed" ? 1 : 0
  ].reduce((sum, value) => sum + value, 0);
  return {
    doneCount,
    totalSteps: total,
    currentLabel: currentStep ? `${currentStep.id} ${currentStep.label}` : "未開始",
    acCounts: ac.counts,
    openItems,
    gateStatus: currentGate?.decision ?? currentGate?.status ?? null
  };
}

function stepProgress({ runtime, sequence, index, step, historyEntry, gate, attempt, interruptions }) {
  const run = runtime.run;
  if (!sequence.includes(step.id)) {
    return progress("skipped", "スキップ", "選択中 variant では実行しない step です。");
  }
  if (!run) {
    return progress("pending", "未開始", "まだ run が始まっていません。");
  }
  if (run.status === "completed") {
    return progress("done", "完了", "この run は完了しています。");
  }
  const currentIndex = sequence.indexOf(run.current_step_id);
  if (step.id === run.current_step_id) {
    if (run.status === "needs_human") {
      return progress("waiting", "ユーザ回答待ち", gate?.summary ? "gate summary を確認して CLI で判断します。" : "gate summary を生成中です。");
    }
    if (run.status === "interrupted") {
      return progress("waiting", "割り込み待ち", interruptions.length > 0 ? "CLI で answer すると継続します。" : "割り込み回答待ちです。");
    }
    if (run.status === "blocked") {
      return progress("blocked", "ガード待ち", "必要な記録や検証を追加してから `run-next` を再実行します。");
    }
    if (run.status === "failed") {
      return progress("failed", "再試行待ち", "provider の再実行または resume が必要です。");
    }
    if (step.provider !== "runtime" && run.id && hasCompletedProviderAttempt({ stateDir: runtime.stateDir, runId: run.id, stepId: step.id, provider: step.provider })) {
      return progress("waiting", "advance待ち", "`run-next` で guard 評価と遷移を進めます。");
    }
    return progress("waiting", "現在", "この step が進行中です。");
  }
  if (historyEntry) {
    return progress("done", "完了", historyEntry.summary);
  }
  if (currentIndex >= 0 && index < currentIndex) {
    return progress("done", "完了", "履歴行がなくても先行 step とみなします。");
  }
  if (attempt?.status === "failed") {
    return progress("failed", "失敗", "最新 attempt が失敗しています。");
  }
  return progress("pending", "未着手", "前段 step の完了後に自動で開始されます。");
}

function progress(status, label, note = "") {
  return { status, label, note };
}

function latestHistoryByStep(entries) {
  const map = new Map();
  for (const entry of entries) {
    map.set(entry.stepId, entry);
  }
  return map;
}

function stepMeta(step) {
  return {
    id: step.id,
    label: step.label ?? step.id,
    summary: step.summary ?? "",
    userAction: step.userAction ?? "",
    ui: step.ui ?? null,
    provider: step.provider,
    mode: step.mode
  };
}

function describeNextAction({ repo, runtime, currentStep, currentGate, interruptions }) {
  if (!runtime.run || !currentStep) {
    return {
      title: "最初にすること",
      body: "repo root で `run` を実行して current-note.md の frontmatter を初期化します。",
      commands: [`node src/cli.mjs run --repo ${shellQuote(repo)} --ticket <ticket-id> --variant full`],
      targetTab: "commands"
    };
  }
  if (runtime.run.status === "needs_human") {
    return {
      title: `${currentStep.id} の判断`,
      body: "Web UI は read-only です。gate summary を読んで terminal から判断します。",
      commands: humanDecisionCommands(repo, currentStep.id),
      targetTab: "gate"
    };
  }
  if (interruptions.length > 0 || runtime.run.status === "interrupted") {
    return {
      title: `${currentStep.id} の割り込み回答`,
      body: "質問内容を確認して CLI の `answer` で返答します。",
      commands: interruptAnswerCommands(repo, currentStep.id),
      targetTab: "detail"
    };
  }
  if (runtime.run.status === "failed") {
    return {
      title: `${currentStep.id} の再実行`,
      body: "失敗 summary を確認して `resume` か `run-provider` を再実行します。",
      commands: [`node src/cli.mjs resume --repo ${shellQuote(repo)}`],
      targetTab: "commands"
    };
  }
  return {
    title: `${currentStep.id} を進める`,
    body: "通常は `run-next` だけで、gate や割り込みまで自動で進みます。",
    commands: [`node src/cli.mjs run-next --repo ${shellQuote(repo)}`],
    targetTab: "commands"
  };
}

function gatePayload(gate, redactor) {
  return {
    ...redactObject(gate, redactor),
    summaryText: gate.summary && existsSync(gate.summary) ? safeReadText(gate.summary, redactor) : ""
  };
}

function listStepArtifacts({ stateDir, runId, stepId, redactor }) {
  const dir = stepDir(stateDir, runId, stepId);
  if (!existsSync(dir)) {
    return [];
  }
  const artifacts = [];
  visitArtifacts(dir, artifacts, dir);
  return artifacts
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((artifact) => redactObject(artifact, redactor))
    .slice(0, 40);
}

function visitArtifacts(dir, artifacts, root) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      visitArtifacts(fullPath, artifacts, root);
      continue;
    }
    artifacts.push({
      name: fullPath.slice(root.length + 1),
      path: fullPath,
      size: safeSize(fullPath)
    });
  }
}

function collectMermaid({ repo, variant = null }) {
  const runtime = loadRuntime(repo);
  return renderMermaidFlow(runtime.flow, variant ?? runtime.run?.flow_variant ?? "full", runtime.run?.current_step_id ?? null);
}

function gitState(repo, redactor) {
  const branch = runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = runGit(repo, ["status", "--short"]);
  const diff = runGit(repo, ["diff", "--", "current-note.md", "current-ticket.md", "src", "flows", "README.md", "product-brief.md", "technical-plan.md", "tasks.md"]);
  return {
    branch: firstLine(branch.stdout || branch.stderr || "unknown"),
    clean: !(status.stdout ?? "").trim(),
    statusLines: redactLines(status.stdout, redactor, 20),
    diffText: clampText(redactor(diff.stdout ?? ""), MAX_TEXT)
  };
}

function runGit(repo, args) {
  const result = spawnSync("git", args, { cwd: repo, text: true, encoding: "utf8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status
  };
}

function safeReadText(path, redactor) {
  try {
    return clampText(redactor(readFileSync(path, "utf8")), MAX_TEXT);
  } catch {
    return "";
  }
}

function safeSize(path) {
  try {
    return statLabel(readFileSync(path).byteLength);
  } catch {
    return "-";
  }
}

function statLabel(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

function clampText(text, limit) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n…`;
}

function redactObject(value, redactor) {
  return JSON.parse(redactor(JSON.stringify(value)));
}

function redactLines(text, redactor, limit) {
  return redactor(text ?? "").split(/\r?\n/).filter(Boolean).slice(0, limit);
}

function firstLine(text) {
  return String(text ?? "").trim().split(/\r?\n/)[0] || "(empty)";
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function humanDecisionCommands(repo, stepId) {
  const repoArg = ` --repo ${shellQuote(repo)}`;
  return [
    `node src/cli.mjs approve${repoArg} --step ${stepId} --reason ok`,
    `node src/cli.mjs request-changes${repoArg} --step ${stepId} --reason "<reason>"`,
    `node src/cli.mjs reject${repoArg} --step ${stepId} --reason "<reason>"`
  ];
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendHtml(response, body) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function renderHtml() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDH Dev Dashboard</title>
<style>
  :root {
    --bg: #ffffff;
    --surface: #fafaf8;
    --surface-2: #f5f4ef;
    --border: #e8e6df;
    --border-strong: #d6d3c8;
    --text: #1c1b18;
    --text-muted: #6d6b64;
    --text-dim: #a3a097;
    --done: #1d9e75;
    --done-bg: #e1f5ee;
    --done-text: #0f6e56;
    --pending-bg: #f6f5f1;
    --pending-text: #a3a097;
    --waiting: #ba7517;
    --waiting-bg: #faeeda;
    --waiting-text: #854f0b;
    --waiting-border: #fac775;
    --skip-bg: #ede9dc;
    --skip-text: #8a887d;
    --critical-bg: #fcebeb;
    --critical-text: #a32d2d;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', 'Meiryo', sans-serif;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    min-height: 100%;
  }
  .app { display: flex; flex-direction: column; min-height: 100vh; }
  .header {
    border-bottom: 1px solid var(--border);
    padding: 12px 16px;
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; background: var(--bg); flex-wrap: wrap;
  }
  .brand {
    display: flex; align-items: center; gap: 10px;
    font-weight: 500; font-size: 14px; white-space: nowrap;
  }
  .brand-logo {
    width: 22px; height: 22px; border-radius: 6px;
    background: #1c1b18; color: #fff;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 600;
  }
  .breadcrumbs {
    font-size: 12px; color: var(--text-muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    min-width: 0; flex: 1;
  }
  .breadcrumbs .sep { color: var(--text-dim); margin: 0 6px; }
  .breadcrumbs .current { color: var(--text); font-weight: 500; }
  .header-right {
    display: flex; align-items: center; gap: 10px;
    font-size: 11px; color: var(--text-muted);
    flex-wrap: wrap;
  }
  .flow-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border-radius: 999px;
    background: #efeefc; color: #3c3489;
    font-size: 11px; font-weight: 500;
    border: 1px solid #cecbf6; white-space: nowrap;
  }
  .waiting-indicator {
    display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
    padding: 4px 10px; border-radius: 999px;
    background: var(--waiting-bg); color: var(--waiting-text);
    font-weight: 500; border: 1px solid var(--waiting-border);
  }
  .waiting-indicator.critical {
    background: var(--critical-bg); color: var(--critical-text); border-color: #f0b7b7;
  }
  .waiting-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: currentColor;
    animation: pulse 1.8s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.45; transform: scale(1.3); }
  }
  .main { display: grid; grid-template-columns: 1fr 380px; min-height: 0; flex: 1; }
  .panel-left { padding: 18px 20px 32px; border-right: 1px solid var(--border); min-width: 0; }
  .panel-right { background: var(--surface); min-width: 0; }
  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px; margin-bottom: 18px;
  }
  .summary-card {
    background: var(--bg); border: 1px solid var(--border);
    border-radius: 8px; padding: 10px 12px; min-width: 0;
  }
  .summary-card.alert { background: var(--waiting-bg); border-color: var(--waiting-border); }
  .summary-card.error { background: var(--critical-bg); border-color: #f0b7b7; }
  .summary-card .label {
    font-size: 11px; color: var(--text-muted); margin-bottom: 3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .summary-card .value { font-size: 15px; font-weight: 500; }
  .summary-card .value .sub { font-size: 11px; color: var(--text-muted); font-weight: 400; }
  .summary-card .value.done { color: var(--done); }
  .summary-card .value.waiting { color: var(--waiting-text); }
  .summary-card .value.error { color: var(--critical-text); }
  .section-head {
    display: flex; align-items: baseline; justify-content: space-between;
    margin: 16px 0 10px; gap: 12px; flex-wrap: wrap;
  }
  .section-title { font-size: 13px; font-weight: 500; color: var(--text); }
  .section-title .subtitle { font-size: 11px; font-weight: 400; color: var(--text-muted); margin-left: 6px; }
  .legend { display: flex; gap: 10px; font-size: 11px; color: var(--text-muted); flex-wrap: wrap; }
  .legend-item { display: flex; align-items: center; gap: 5px; }
  .legend-dot { width: 8px; height: 8px; border-radius: 50%; }
  .flow-container {
    background: var(--bg); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px;
  }
  .overview-scroll { overflow-x: auto; margin: 0 -16px; padding: 0 16px 4px; }
  .overview-flow { display: flex; align-items: center; gap: 6px; min-width: min-content; }
  .overview-node {
    flex: 0 0 auto; padding: 8px 12px;
    border-radius: 8px; border: 1px solid var(--border);
    background: var(--bg); cursor: pointer;
    transition: transform 0.15s, border-color 0.15s;
    min-width: 96px; text-align: center;
  }
  .overview-node .ov-label { font-size: 10px; color: var(--text-dim); margin-bottom: 1px; }
  .overview-node .ov-name { font-weight: 500; color: var(--text); font-size: 12px; }
  .overview-node.done { background: var(--done-bg); border-color: #9fe1cb; }
  .overview-node.done .ov-label, .overview-node.done .ov-name { color: var(--done-text); }
  .overview-node.waiting {
    background: var(--waiting-bg); border-color: var(--waiting-border);
    box-shadow: 0 0 0 3px rgba(186, 117, 23, 0.14);
  }
  .overview-node.waiting .ov-label, .overview-node.waiting .ov-name { color: var(--waiting-text); }
  .overview-node.pending {
    background: var(--pending-bg); border-color: var(--border); opacity: 0.55;
  }
  .overview-node.pending .ov-name { color: var(--pending-text); }
  .overview-node:hover { transform: translateY(-1px); border-color: var(--border-strong); }
  .overview-node.selected { outline: 2px solid #1c1b18; outline-offset: 1px; }
  .overview-arrow { color: var(--text-dim); flex: 0 0 auto; font-size: 12px; }
  .flow-toggle {
    display: inline-flex; background: var(--surface-2);
    border-radius: 8px; padding: 3px; gap: 2px;
  }
  .flow-toggle button {
    border: 0; background: transparent;
    padding: 5px 12px; border-radius: 6px;
    cursor: pointer; color: var(--text-muted);
    font-family: inherit; font-size: 12px; font-weight: 500;
    white-space: nowrap;
  }
  .flow-toggle button.on {
    background: var(--bg); color: var(--text);
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }
  .flow-toggle button .count { color: var(--text-dim); font-weight: 400; margin-left: 4px; }
  .pdc-list { display: flex; flex-direction: column; gap: 8px; }
  .node {
    position: relative; background: var(--bg);
    border: 1px solid var(--border); border-radius: 10px;
    padding: 10px 12px; cursor: pointer;
    transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
    display: flex; align-items: center; gap: 10px;
  }
  .node:hover { border-color: var(--border-strong); transform: translateY(-1px); }
  .node.selected { outline: 2px solid #1c1b18; outline-offset: 1px; }
  .node-icon {
    flex: 0 0 auto; width: 26px; height: 26px;
    border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 600;
  }
  .node-body { flex: 1; min-width: 0; }
  .node-step { font-size: 10px; color: var(--text-muted); font-weight: 500; }
  .node-title {
    font-size: 13px; font-weight: 500; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .node-meta {
    font-size: 11px; color: var(--text-muted); margin-top: 1px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .node.done { background: var(--done-bg); border-color: #9fe1cb; }
  .node.done .node-icon { background: var(--done); color: #fff; }
  .node.done .node-title { color: var(--done-text); }
  .node.waiting {
    background: var(--waiting-bg); border-color: var(--waiting-border);
    box-shadow: 0 0 0 3px rgba(186, 117, 23, 0.14);
  }
  .node.blocked {
    background: var(--waiting-bg); border-color: var(--waiting-border);
    box-shadow: 0 0 0 3px rgba(186, 117, 23, 0.14);
  }
  .node.waiting .node-icon { background: var(--waiting); color: #fff; position: relative; }
  .node.blocked .node-icon { background: var(--waiting); color: #fff; position: relative; }
  .node.waiting .node-title { color: var(--waiting-text); }
  .node.waiting .node-meta { color: var(--waiting-text); opacity: 0.8; }
  .node.blocked .node-title { color: var(--waiting-text); }
  .node.blocked .node-meta { color: var(--waiting-text); opacity: 0.8; }
  .node.failed { background: var(--critical-bg); border-color: #f0b7b7; }
  .node.failed .node-icon { background: #b53a3a; color: #fff; }
  .node.failed .node-title, .node.failed .node-meta { color: var(--critical-text); }
  .node.pending { background: var(--pending-bg); border-color: var(--border); opacity: 0.55; }
  .node.pending .node-icon { background: #e0ddd2; color: #a3a097; }
  .node.pending .node-title { color: var(--pending-text); }
  .node.skipped { background: var(--skip-bg); border-color: var(--border); opacity: 0.45; }
  .node.skipped .node-icon { background: #d6d3c8; color: #8a887d; }
  .node.skipped .node-title {
    color: var(--skip-text);
    text-decoration: line-through;
    text-decoration-color: var(--text-dim);
  }
  .node + .node::before {
    content: ''; position: absolute;
    top: -9px; left: 23px;
    width: 1px; height: 10px;
    background: var(--border-strong);
  }
  .detail { padding: 18px 20px 32px; }
  .detail-head {
    margin-bottom: 14px; padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .detail-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
  .detail-title { font-size: 17px; font-weight: 500; color: var(--text); margin-bottom: 6px; }
  .detail-desc { font-size: 12px; color: var(--text-muted); line-height: 1.6; }
  .status-pill {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 10px; border-radius: 999px;
    font-size: 11px; font-weight: 500; margin-top: 8px;
  }
  .status-pill.done { background: var(--done-bg); color: var(--done-text); }
  .status-pill.waiting { background: var(--waiting-bg); color: var(--waiting-text); }
  .status-pill.blocked { background: var(--waiting-bg); color: var(--waiting-text); }
  .status-pill.pending { background: var(--pending-bg); color: var(--text-muted); }
  .status-pill.skipped { background: var(--skip-bg); color: var(--skip-text); }
  .status-pill.failed { background: var(--critical-bg); color: var(--critical-text); }
  .detail-section { margin-top: 16px; }
  .detail-section-title {
    font-size: 11px; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.04em;
    margin-bottom: 8px; font-weight: 500;
  }
  .question-card {
    background: var(--waiting-bg);
    border: 1px solid var(--waiting-border);
    border-radius: 10px;
    padding: 14px 14px 12px;
    margin-top: 16px;
  }
  .question-card.error { background: var(--critical-bg); border-color: #f0b7b7; }
  .question-card-head {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 10px; padding-bottom: 10px;
    border-bottom: 1px solid rgba(186, 117, 23, 0.18);
  }
  .question-card-head .icon {
    width: 22px; height: 22px; border-radius: 50%;
    background: var(--waiting); color: #fff;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 600;
    flex: 0 0 auto;
  }
  .question-card.error .question-card-head .icon { background: #b53a3a; }
  .question-card-head .title { font-size: 13px; font-weight: 500; color: inherit; flex: 1; }
  .question-card-head .elapsed {
    font-size: 11px; color: inherit;
    opacity: 0.75; font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .question-body { font-size: 12.5px; line-height: 1.65; color: var(--text); }
  .question-body p { margin: 0 0 10px; }
  .question-body p:last-child { margin-bottom: 0; }
  .question-body code {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11.5px;
    background: rgba(255,255,255,0.7);
    padding: 1px 5px; border-radius: 3px;
  }
  .viewer-note {
    margin-top: 12px; padding: 8px 10px;
    background: rgba(255,255,255,0.6);
    border-radius: 6px;
    font-size: 11px; color: var(--text-muted);
    display: flex; gap: 6px; align-items: flex-start;
  }
  .viewer-note .info-icon {
    flex: 0 0 auto;
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--text-dim); color: #fff;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 600;
    margin-top: 1px;
  }
  .activity {
    display: flex; flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 8px; overflow: hidden;
  }
  .activity-item {
    background: var(--bg); padding: 8px 10px;
    font-size: 12px;
    border-bottom: 1px solid var(--border);
  }
  .activity-item:last-child { border-bottom: 0; }
  .activity-item.highlight {
    background: var(--waiting-bg);
    border-left: 3px solid var(--waiting);
    padding-left: 9px;
  }
  .activity-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
  .activity-time {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 10px; color: var(--text-muted);
  }
  .activity-actor { font-size: 10px; padding: 1px 6px; border-radius: 3px; white-space: nowrap; }
  .activity-actor.runtime { background: #efeefc; color: #3c3489; }
  .activity-actor.codex { background: #e6f1fb; color: #185fa5; }
  .activity-actor.claude { background: #e1f5ee; color: #0f6e56; }
  .activity-msg { color: var(--text); line-height: 1.5; word-wrap: break-word; }
  .activity-msg code {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px; background: var(--surface-2);
    padding: 1px 5px; border-radius: 3px;
  }
  .artifacts, .commands, .history-list { display: flex; flex-direction: column; gap: 5px; }
  .artifact, .command, .history-item {
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    font-size: 12px;
    display: flex; align-items: center; gap: 8px;
    min-width: 0;
  }
  .artifact-name, .command-text, .history-text {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px; flex: 1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    min-width: 0;
  }
  .artifact-size, .history-meta { color: var(--text-muted); font-size: 11px; flex: 0 0 auto; }
  .review-table { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .review-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 8px; padding: 7px 10px;
    font-size: 12px; align-items: center;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .review-row:last-child { border-bottom: 0; }
  .review-row .rv-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .review-row .rv-round { color: var(--text-muted); font-variant-numeric: tabular-nums; font-size: 11px; }
  .sev {
    display: inline-block;
    padding: 1px 7px; border-radius: 999px;
    font-size: 10px; font-weight: 500; white-space: nowrap;
  }
  .sev.none { background: var(--done-bg); color: var(--done-text); }
  .sev.minor { background: var(--waiting-bg); color: var(--waiting-text); }
  .sev.critical { background: var(--critical-bg); color: var(--critical-text); }
  .mono {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    background: var(--surface-2);
    padding: 1px 5px; border-radius: 3px;
  }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }
  @media (max-width: 820px) {
    .main { grid-template-columns: 1fr; }
    .panel-right { border-top: 1px solid var(--border); border-right: 0; }
    .panel-left { border-right: 0; }
  }
  @media (max-width: 600px) {
    .header { padding: 10px 14px; }
    .panel-left { padding: 14px 14px 24px; }
    .detail { padding: 16px 14px 24px; }
    .brand span:not(.brand-logo) { display: none; }
  }
</style>
</head>
<body>
  <div class="app">
    <header class="header">
      <div style="display:flex;align-items:center;gap:14px;min-width:0;flex:1;">
        <div class="brand">
          <span class="brand-logo">PD</span>
          <span>PDH Dev</span>
        </div>
        <div class="breadcrumbs" id="breadcrumbs"></div>
      </div>
      <div class="header-right" id="header-right"></div>
    </header>
    <div class="main">
      <section class="panel-left">
        <div class="summary" id="summary"></div>
        <div class="section-head">
          <div class="section-title">全体フロー<span class="subtitle">Ticket 開始 → Close</span></div>
          <div class="legend">
            <span class="legend-item"><span class="legend-dot" style="background: var(--done);"></span>完了</span>
            <span class="legend-item"><span class="legend-dot" style="background: var(--waiting);"></span>要対応</span>
            <span class="legend-item"><span class="legend-dot" style="background: #d3d1c7;"></span>未着手</span>
          </div>
        </div>
        <div class="flow-container" style="margin-bottom:20px;">
          <div class="overview-scroll"><div class="overview-flow" id="overview-flow"></div></div>
        </div>
        <div class="section-head">
          <div class="section-title">PD-C: Ticket 開発<span class="subtitle">ステップ詳細</span></div>
          <div class="flow-toggle" id="flow-toggle">
            <button class="on" data-flow="full">Full<span class="count" id="full-count"></span></button>
            <button data-flow="light">Light<span class="count" id="light-count"></span></button>
          </div>
        </div>
        <div class="flow-container"><div class="pdc-list" id="pdc-list"></div></div>
      </section>
      <aside class="panel-right"><div class="detail" id="detail"></div></aside>
    </div>
  </div>
<script>
  const state = { data: null, currentFlow: 'full', selectedId: null };

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function iconFor(status) {
    if (status === 'done') return '\\u2713';
    if (status === 'failed') return '!';
    if (status === 'waiting' || status === 'blocked') return '?';
    if (status === 'skipped') return '\\u2013';
    return '';
  }

  function variantData() {
    return state.data?.flow?.variants?.[state.currentFlow];
  }

  function selectedStep() {
    const flow = variantData();
    return flow?.steps?.find((step) => step.id === state.selectedId) || null;
  }

  function listOf(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function stepShowItems(step, nextAction) {
    const items = [];
    const contract = step.uiContract || {};
    listOf(contract.mustShow).forEach((item) => items.push({ label: item, kind: 'contract' }));
    listOf(step.uiOutput?.summary).forEach((item) => items.push({ label: item, kind: 'summary' }));
    listOf(step.uiOutput?.risks).forEach((item) => items.push({ label: item, kind: 'risk' }));
    listOf(step.uiRuntime?.changedFiles).forEach((item) => items.push({ label: item, kind: 'changed file' }));
    listOf(step.uiRuntime?.diffStat).forEach((item) => items.push({ label: item, kind: 'diff' }));
    if (step.uiRuntime?.latestAttempt?.status) {
      items.push({
        label: (step.uiRuntime.latestAttempt.provider || 'provider') + ' attempt ' + (step.uiRuntime.latestAttempt.attempt || '?') + ': ' + step.uiRuntime.latestAttempt.status,
        kind: 'attempt'
      });
    }
    listOf(step.uiRuntime?.judgements).forEach((item) => {
      items.push({ label: item.kind + ': ' + item.status, kind: 'judgement' });
    });
    if (step.uiRuntime?.gate?.summary) {
      items.push({ label: step.uiRuntime.gate.summary, kind: 'gate' });
    }
    listOf(step.uiRuntime?.interruptions).forEach((item) => {
      items.push({ label: item.message || item.artifact || item.id, kind: 'interrupt' });
    });
    listOf(nextAction?.commands).forEach((item) => items.push({ label: item, kind: 'command' }));
    return items;
  }

  function stepReadyItems(step) {
    const items = [];
    listOf(step.uiOutput?.readyWhen).forEach((item) => items.push({ label: item, kind: 'ready' }));
    listOf(step.uiRuntime?.guards).forEach((guard) => {
      const label = guard.id + ': ' + guard.status + (guard.evidence ? ' · ' + guard.evidence : '');
      items.push({ label, kind: guard.status });
    });
    return items;
  }

  function fetchState() {
    return fetch('/api/state', { cache: 'no-store' }).then((response) => response.json());
  }

  function refresh() {
    fetchState().then((data) => {
      state.data = data;
      document.getElementById('full-count').textContent = data.flow.variants.full.count;
      document.getElementById('light-count').textContent = data.flow.variants.light.count;
      state.currentFlow = data.flow.activeVariant || state.currentFlow;
      const currentId = data.runtime?.run?.current_step_id || data.flow.variants[state.currentFlow].steps?.[0]?.id || null;
      state.selectedId = state.selectedId && data.flow.variants[state.currentFlow].steps.some((step) => step.id === state.selectedId)
        ? state.selectedId
        : currentId;
      document.querySelectorAll('#flow-toggle button').forEach((button) => {
        button.classList.toggle('on', button.dataset.flow === state.currentFlow);
      });
      render();
    });
  }

  function render() {
    renderHeader();
    renderSummary();
    renderOverview();
    renderSteps();
    renderDetail();
  }

  function renderHeader() {
    const data = state.data;
    const current = data.runtime.currentStep;
    document.getElementById('breadcrumbs').innerHTML =
      '<span>' + esc(data.repoName) + '</span>' +
      '<span class="sep">/</span>' +
      '<span class="current">' + esc(data.runtime.run?.ticket_id || 'no-ticket') + '</span>';

    const variant = state.currentFlow.toUpperCase();
    const status = data.runtime.run?.status || 'idle';
    const waitingClass = status === 'failed' ? 'waiting-indicator critical' : 'waiting-indicator';
    const indicatorText = current
      ? current.id + ' ' + current.label + ' · ' + status
      : '未開始';
    document.getElementById('header-right').innerHTML =
      '<span class="flow-badge">Flow: ' + esc(variant) + '</span>' +
      '<span class="' + waitingClass + '"><span class="waiting-dot"></span>' + esc(indicatorText) + '</span>';
  }

  function renderSummary() {
    const summary = state.data.summary;
    const ac = summary.acCounts || { verified: 0, deferred: 0, unverified: 0 };
    document.getElementById('summary').innerHTML =
      '<div class="summary-card"><div class="label">完了ステップ</div><div class="value done">' + esc(summary.doneCount + ' / ' + summary.totalSteps) + '</div></div>' +
      '<div class="summary-card alert"><div class="label">現在</div><div class="value waiting">' + esc(summary.currentLabel) + '</div></div>' +
      '<div class="summary-card"><div class="label">AC 裏取り</div><div class="value">' + esc(ac.verified + ' verified') + ' <span class="sub">' + esc('deferred ' + ac.deferred + ' / unverified ' + ac.unverified) + '</span></div></div>' +
      '<div class="summary-card ' + (summary.openItems > 0 ? 'alert' : '') + '"><div class="label">要対応</div><div class="value ' + (summary.openItems > 0 ? 'waiting' : 'done') + '">' + esc(String(summary.openItems)) + ' <span class="sub">open items</span></div></div>';
  }

  function renderOverview() {
    const overview = variantData().overview;
    const root = document.getElementById('overview-flow');
    root.innerHTML = '';
    overview.forEach((node, index) => {
      const el = document.createElement('div');
      el.className = 'overview-node ' + node.state;
      el.innerHTML = '<div class="ov-label">' + esc(node.label) + '</div><div class="ov-name">' + esc(node.title) + '</div>';
      root.appendChild(el);
      if (index < overview.length - 1) {
        const arrow = document.createElement('div');
        arrow.className = 'overview-arrow';
        arrow.textContent = '\\u2192';
        root.appendChild(arrow);
      }
    });
  }

  function renderSteps() {
    const steps = variantData().steps;
    const root = document.getElementById('pdc-list');
    root.innerHTML = '';
    steps.forEach((step) => {
      const el = document.createElement('div');
      el.className = 'node ' + step.progress.status + (step.id === state.selectedId ? ' selected' : '');
      el.innerHTML =
        '<div class="node-icon">' + iconFor(step.progress.status) + '</div>' +
        '<div class="node-body">' +
          '<div class="node-step">' + esc(step.id) + '</div>' +
          '<div class="node-title">' + esc(step.label) + '</div>' +
          '<div class="node-meta">' + esc(step.progress.label + ' · ' + (step.progress.note || step.summary || '')) + '</div>' +
        '</div>';
      el.addEventListener('click', () => {
        state.selectedId = step.id;
        renderSteps();
        renderDetail();
      });
      root.appendChild(el);
    });
  }

  function renderDetail() {
    const step = selectedStep();
    const root = document.getElementById('detail');
    if (!step) {
      root.innerHTML = '';
      return;
    }
    const current = state.data.runtime.currentStep;
    const nextAction = state.data.current.nextAction;
    const currentGate = state.data.current.gate;
    const interruptions = state.data.current.interruptions || [];
    let html =
      '<div class="detail-head">' +
        '<div class="detail-label">' + esc(step.id + ' · ' + step.provider + ' / ' + step.mode) + '</div>' +
        '<div class="detail-title">' + esc(step.label) + '</div>' +
        '<div class="detail-desc">' + esc(step.summary || '') + '</div>' +
        '<span class="status-pill ' + esc(step.progress.status) + '"><span style="width:6px;height:6px;border-radius:50%;background:currentColor;"></span>' + esc(step.progress.label) + '</span>' +
      '</div>';

    if (current && current.id === step.id && (state.data.runtime.run?.status === 'needs_human' || state.data.runtime.run?.status === 'interrupted' || state.data.runtime.run?.status === 'failed' || state.data.runtime.run?.status === 'blocked')) {
      const isError = state.data.runtime.run.status === 'failed';
      const questionBody = [];
      if (state.data.runtime.run.status === 'needs_human') {
        questionBody.push('<p>この step は human gate です。要約を確認して terminal から判断してください。</p>');
        if (currentGate?.summaryText) {
          questionBody.push('<p>' + esc(currentGate.summaryText.slice(0, 1200)) + '</p>');
        }
      } else if (state.data.runtime.run.status === 'interrupted') {
        const latest = interruptions[interruptions.length - 1];
        questionBody.push('<p>割り込み質問に未回答です。CLI の <code>answer</code> で回答してください。</p>');
        if (latest?.message) {
          questionBody.push('<p>' + esc(latest.message) + '</p>');
        }
      } else if (state.data.runtime.run.status === 'failed') {
        questionBody.push('<p>provider が失敗しています。summary を確認して <code>resume</code> か <code>run-provider</code> を再実行します。</p>');
      } else {
        questionBody.push('<p>guard が通っていません。必要な note/ticket 更新、commit、検証を追加してから <code>run-next</code> を再実行します。</p>');
      }
      html +=
        '<div class="question-card' + (isError ? ' error' : '') + '">' +
          '<div class="question-card-head">' +
            '<span class="icon">' + (isError ? '!' : '?') + '</span>' +
            '<span class="title">' + esc(nextAction.title) + '</span>' +
          '</div>' +
          '<div class="question-body">' + questionBody.join('') + '</div>' +
          '<div class="viewer-note"><span class="info-icon">i</span><span>この UI は viewer です。操作は terminal の CLI で実行します。</span></div>' +
        '</div>';
    }

    html +=
      '<div class="detail-section"><div class="detail-section-title">見るもの</div>' +
      '<div style="padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text);">' +
      esc(step.userAction || 'この step の summary と event log を確認してください。') +
      '</div></div>';

    if (nextAction?.commands?.length && current && current.id === step.id) {
      html += '<div class="detail-section"><div class="detail-section-title">Next</div><div class="commands">';
      nextAction.commands.forEach((command) => {
        html += '<div class="command"><span class="command-text">' + esc(command) + '</span></div>';
      });
      html += '</div></div>';
    }

    if (step.gate || step.interruptions?.length) {
      html += '<div class="detail-section"><div class="detail-section-title">現在の待ち状態</div><div class="artifacts">';
      if (step.gate?.summary) {
        html += '<div class="artifact"><span class="artifact-name">' + esc(step.gate.summary) + '</span><span class="artifact-size">' + esc(step.gate.decision || step.gate.status) + '</span></div>';
      }
      step.interruptions.forEach((item) => {
        html += '<div class="artifact"><span class="artifact-name">' + esc(item.artifactPath) + '</span><span class="artifact-size">' + esc(item.status || item.kind || 'open') + '</span></div>';
      });
      html += '</div></div>';
    }

    if (step.judgements?.length) {
      html += '<div class="detail-section"><div class="detail-section-title">レビュー結果</div><div class="review-table">';
      step.judgements.forEach((judgement, index) => {
        const sev = judgement.status === 'No Critical/Major' || judgement.status === 'No Unverified' ? 'none' : judgement.status.toLowerCase().includes('critical') ? 'critical' : 'minor';
        html +=
          '<div class="review-row">' +
            '<div class="rv-name">' + esc(judgement.kind) + '</div>' +
            '<div class="rv-round">R' + esc(String(index + 1)) + '</div>' +
            '<div><span class="sev ' + esc(sev) + '">' + esc(judgement.status) + '</span></div>' +
          '</div>';
      });
      html += '</div></div>';
    }

    if (step.events?.length) {
      html += '<div class="detail-section"><div class="detail-section-title">エージェント実行ログ</div><div class="activity">';
      step.events.forEach((event) => {
        const highlight = event.type === 'interrupted' || event.type === 'guard_failed' || event.type === 'human_gate_resolved';
        html +=
          '<div class="activity-item' + (highlight ? ' highlight' : '') + '">' +
            '<div class="activity-meta">' +
              '<span class="activity-time">' + esc((event.ts || '').replace('T', ' ').replace('Z', '')) + '</span>' +
              '<span class="activity-actor ' + esc(event.provider || 'runtime') + '">' + esc((event.provider || 'runtime').toUpperCase()) + '</span>' +
            '</div>' +
            '<div class="activity-msg">' + esc(event.message || event.type) + '</div>' +
          '</div>';
      });
      html += '</div></div>';
    }

    if (step.artifacts?.length) {
      html += '<div class="detail-section"><div class="detail-section-title">成果物</div><div class="artifacts">';
      step.artifacts.forEach((artifact) => {
        html += '<div class="artifact"><span class="artifact-name">' + esc(artifact.name) + '</span><span class="artifact-size">' + esc(artifact.size) + '</span></div>';
      });
      html += '</div></div>';
    }

    const contract = step.uiContract || {};
    const showItems = stepShowItems(step, current && current.id === step.id ? nextAction : null);
    const readyItems = stepReadyItems(step);
    const omitItems = listOf(contract.omit);
    html += '<div class="detail-section"><div class="detail-section-title">実行結果</div>' +
      '<div style="padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text);">' +
      '<div><strong>誰が見る:</strong> ' + esc(contract.viewer || '開発者') + '</div>' +
      '<div style="margin-top:6px;"><strong>判断したいこと:</strong> ' + esc(contract.decision || step.summary || '') + '</div>' +
      '</div></div>';

    html += '<div class="detail-section"><div class="detail-section-title">この step で出すべきもの</div><div class="artifacts">';
    if (!showItems.length) {
      html += '<div class="artifact"><span class="artifact-name">まだありません</span><span class="artifact-size">pending</span></div>';
    }
    showItems.forEach((item) => {
      html += '<div class="artifact"><span class="artifact-name">' + esc(item.label) + '</span><span class="artifact-size">' + esc(item.kind) + '</span></div>';
    });
    html += '</div></div>';

    html += '<div class="detail-section"><div class="detail-section-title">揃っていれば進める</div><div class="artifacts">';
    if (!readyItems.length) {
      html += '<div class="artifact"><span class="artifact-name">guard 評価待ち</span><span class="artifact-size">pending</span></div>';
    }
    readyItems.forEach((item) => {
      html += '<div class="artifact"><span class="artifact-name">' + esc(item.label) + '</span><span class="artifact-size">' + esc(item.kind) + '</span></div>';
    });
    html += '</div></div>';

    html += '<div class="detail-section"><div class="detail-section-title">ここでは出さない</div><div class="artifacts">';
    if (!omitItems.length) {
      html += '<div class="artifact"><span class="artifact-name">特になし</span><span class="artifact-size">omit</span></div>';
    }
    omitItems.forEach((item) => {
      html += '<div class="artifact"><span class="artifact-name">' + esc(item) + '</span><span class="artifact-size">omit</span></div>';
    });
    html += '</div></div>';

    html += '<div class="detail-section"><div class="detail-section-title">Repo</div><div style="padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text);">' +
      '<div>note: <span class="mono">' + esc(state.data.files.note) + '</span></div>' +
      '<div style="margin-top:4px;">ticket: <span class="mono">' + esc(state.data.files.ticket) + '</span></div>' +
      '<div style="margin-top:4px;">branch: <span class="mono">' + esc(state.data.git.branch) + '</span></div>' +
      '</div></div>';

    root.innerHTML = html;
  }

  document.getElementById('flow-toggle').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    state.currentFlow = button.dataset.flow;
    document.querySelectorAll('#flow-toggle button').forEach((item) => {
      item.classList.toggle('on', item.dataset.flow === state.currentFlow);
    });
    const flow = variantData();
    if (!flow.steps.some((step) => step.id === state.selectedId)) {
      state.selectedId = flow.steps[0]?.id || null;
    }
    render();
  });

  refresh();
  setInterval(refresh, 5000);
</script>
</body>
</html>`;
}
