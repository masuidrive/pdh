import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { URL } from "node:url";
import { Store, defaultStateDir } from "./db.mjs";
import { buildFlowView, loadFlow, getStep, renderMermaidFlow } from "./flow.mjs";
import { loadStepInterruptions } from "./interruptions.mjs";
import { createRedactor } from "./redaction.mjs";

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
    sendJson(response, 200, collectState({ repo, runId: url.searchParams.get("run") }));
    return;
  }
  if (url.pathname === "/api/flow.mmd") {
    sendText(response, 200, collectMermaid({ repo, runId: url.searchParams.get("run"), variant: url.searchParams.get("variant") }));
    return;
  }
  sendJson(response, 404, { error: "not_found" });
}

function collectState({ repo, runId = null }) {
  const stateDir = defaultStateDir(repo);
  const redactor = createRedactor({ repoPath: repo });
  const store = openReadOnlyStore(stateDir);
  const runs = store ? listRuns(store, redactor) : [];
  const selectedRunId = runId && runs.some((run) => run.id === runId) ? runId : runs[0]?.id ?? null;
  const detail = store && selectedRunId ? runDetail({ store, stateDir, repo, runId: selectedRunId, redactor }) : null;
  store?.db.close();
  return {
    repo,
    stateDir,
    mode: "read-only",
    generatedAt: new Date().toISOString(),
    runs,
    selectedRunId,
    run: detail,
    git: gitState(repo, redactor)
  };
}

function openReadOnlyStore(stateDir) {
  const dbPath = join(stateDir, "state.sqlite");
  if (!existsSync(dbPath)) {
    return null;
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  return new Store(db, stateDir);
}

function listRuns(store, redactor) {
  return store.db.prepare(`
    SELECT id, flow_id, flow_variant, ticket_id, status, current_step_id, repo_path, created_at, updated_at, completed_at
    FROM runs
    ORDER BY updated_at DESC
    LIMIT 50
  `).all().map((row) => redactObject(row, redactor));
}

function runDetail({ store, stateDir, repo, runId, redactor }) {
  const run = redactObject(store.getRun(runId), redactor);
  if (!run) {
    return null;
  }
  const flow = loadFlow(run.flow_id);
  const currentStep = run.current_step_id ? getStep(flow, run.current_step_id) : null;
  const events = store.recentEvents(runId, 120).map((event) => normalizeEvent(event, redactor));
  const steps = store.db.prepare(`
    SELECT id, run_id, step_id, attempt, round, provider, mode, status, started_at, finished_at, exit_code, summary, error
    FROM run_steps
    WHERE run_id = ?
    ORDER BY id ASC
  `).all(runId).map((row) => redactObject(row, redactor));
  const gates = store.db.prepare(`
    SELECT id, run_id, step_id, status, prompt, summary, decision, reason, created_at, resolved_at
    FROM human_gates
    WHERE run_id = ?
    ORDER BY id ASC
  `).all(runId).map((row) => ({
    ...redactObject(row, redactor),
    summaryText: readStateFile(row.summary, stateDir, redactor)
  }));
  const flowView = annotateFlowProgress(
    buildFlowView(flow, "full", run.current_step_id),
    { run, steps, gates, events }
  );
  const sessions = store.db.prepare(`
    SELECT run_id, step_id, attempt, provider, session_id, resume_token, raw_log_path
    FROM provider_sessions
    WHERE run_id = ?
    ORDER BY step_id ASC, attempt ASC
  `).all(runId).map((row) => redactObject(row, redactor));
  const interruptions = run.current_step_id
    ? loadStepInterruptions({ stateDir, runId, stepId: run.current_step_id }).map((item) => redactObject(item, redactor))
    : [];
  const cli = nextCliCommands({ run, currentStep, repo });
  return {
    run,
    flow: {
      ...flowView,
      activeVariant: run.flow_variant,
      mermaid: renderMermaidFlow(flow, run.flow_variant, run.current_step_id)
    },
    currentStep,
    steps,
    gates,
    sessions,
    interruptions,
    events,
    cli,
    nextAction: describeNextAction({ run, currentStep, cli })
  };
}

function annotateFlowProgress(flowView, { run, steps, gates, events }) {
  const latestStep = latestByStepId(steps);
  const latestGate = latestByStepId(gates);
  const transitionedFrom = new Set();
  for (const event of events) {
    const match = String(event.message ?? "").match(/^\[([^\]]+)\] -> \[([^\]]+)\]$/);
    if (event.type === "status" && match) {
      transitionedFrom.add(match[1]);
    }
  }
  const initialStepId = events.find((event) => event.type === "status" && String(event.message ?? "").startsWith("Created "))?.stepId ?? flowView.initial;
  const initialIndex = flowView.sequence.indexOf(initialStepId);
  return {
    ...flowView,
    steps: flowView.steps.map((step, index) => ({
      ...step,
      progress: stepProgress({
        run,
        step,
        index,
        initialIndex,
        latestStep: latestStep.get(step.id),
        latestGate: latestGate.get(step.id),
        transitioned: transitionedFrom.has(step.id)
      })
    }))
  };
}

function latestByStepId(rows) {
  const latest = new Map();
  for (const row of rows) {
    latest.set(row.step_id, row);
  }
  return latest;
}

function stepProgress({ run, step, index, initialIndex, latestStep, latestGate, transitioned }) {
  if (initialIndex >= 0 && index < initialIndex && !latestStep && !latestGate && !transitioned) {
    return progress("skipped", "Not run", "Run started after this step.");
  }
  if (run.status === "completed" && (step.current || transitioned || latestGate?.status === "resolved" || latestStep?.status === "completed")) {
    return progress("done", "Done", completionNote({ latestStep, latestGate, transitioned }));
  }
  if (step.current) {
    if (run.status === "needs_human") {
      return progress("needs_human", "Needs decision", gateNote(latestGate));
    }
    if (run.status === "interrupted") {
      return progress("interrupted", "Needs answer", "Open interruption must be answered.");
    }
    if (run.status === "blocked") {
      return progress("blocked", "Blocked", latestStep?.error || "Check failed guards or required commands.");
    }
    if (run.status === "failed") {
      return progress("failed", "Failed", latestStep?.error || "Provider step failed.");
    }
    if (latestStep?.status === "completed") {
      return progress("ready", "Ready", "Provider completed; advance the runtime.");
    }
    if (latestStep?.status === "running") {
      return progress("running", "Running", "Provider execution is in progress.");
    }
    return progress("current", "Current", "This is the active step for the selected run.");
  }
  if (transitioned || latestGate?.status === "resolved" || latestStep?.status === "completed") {
    return progress("done", "Done", completionNote({ latestStep, latestGate, transitioned }));
  }
  if (latestStep?.status === "failed") {
    return progress("failed", "Failed", latestStep.error || "Provider step failed.");
  }
  if (latestStep?.status === "running") {
    return progress("running", "Running", "Provider execution is in progress.");
  }
  return progress("pending", "Pending", "Not reached yet.");
}

function progress(status, label, note = "") {
  return { status, label, note };
}

function completionNote({ latestStep, latestGate, transitioned }) {
  if (latestGate?.decision) {
    return `Gate decision: ${latestGate.decision}`;
  }
  if (latestStep?.summary) {
    return latestStep.summary;
  }
  if (transitioned) {
    return "Advanced to the next step.";
  }
  return "Completed.";
}

function gateNote(gate) {
  if (!gate) {
    return "Gate summary is being prepared.";
  }
  if (gate.decision) {
    return `Gate decision: ${gate.decision}`;
  }
  return "Review the gate summary and decide.";
}

function describeNextAction({ run, currentStep, cli }) {
  if (!run || !currentStep) {
    return null;
  }
  const stepName = currentStep.label ? `${currentStep.id} ${currentStep.label}` : currentStep.id;
  if (run.status === "completed") {
    return {
      status: "done",
      title: "完了",
      detail: `${stepName} まで完了しています。`,
      targetTab: "diff",
      targetLabel: "Diff",
      commands: []
    };
  }
  if (run.status === "needs_human") {
    return {
      status: "needs_human",
      title: `${stepName}の gate 判断`,
      detail: "Gate summary と差分を見て、approve / request-changes / reject を CLI で実行します。",
      targetTab: "gates",
      targetLabel: "Gates",
      commands: cli
    };
  }
  if (run.status === "interrupted") {
    return {
      status: "interrupted",
      title: `${stepName}の割り込み回答`,
      detail: "Interruptions の質問を見て、answer を CLI で実行します。",
      targetTab: "interruptions",
      targetLabel: "Interruptions",
      commands: cli
    };
  }
  if (run.status === "blocked") {
    return {
      status: "blocked",
      title: `${stepName}の block 解消`,
      detail: currentStep.provider === "runtime"
        ? "Gates または Logs で止まった理由を見て、必要な CLI 操作を実行します。"
        : "Logs で理由を見て、Commands の run-next または復旧コマンドを使います。",
      targetTab: currentStep.provider === "runtime" ? "gates" : "commands",
      targetLabel: currentStep.provider === "runtime" ? "Gates" : "Commands",
      commands: cli
    };
  }
  if (run.status === "failed") {
    return {
      status: "failed",
      title: `${stepName}の provider 失敗`,
      detail: "Logs と failure summary を見て、resume または run-provider を CLI で実行します。",
      targetTab: "logs",
      targetLabel: "Logs",
      commands: cli
    };
  }
  if (currentStep.provider !== "runtime") {
    return {
      status: "current",
      title: `${stepName}を実行`,
      detail: "Commands の run-next を実行します。Provider 実行と次の遷移は gate / interruption / block まで自動で進みます。",
      targetTab: "commands",
      targetLabel: "Commands",
      commands: cli
    };
  }
  return {
    status: "current",
    title: `${stepName}を進める`,
    detail: "Commands の run-next を CLI で実行します。",
    targetTab: "commands",
    targetLabel: "Commands",
    commands: cli
  };
}

function collectMermaid({ repo, runId = null, variant = null }) {
  const stateDir = defaultStateDir(repo);
  const store = openReadOnlyStore(stateDir);
  let flowId = "pdh-ticket-core";
  let selectedVariant = variant ?? "full";
  let currentStepId = null;
  if (store && runId) {
    const run = store.getRun(runId);
    if (run) {
      flowId = run.flow_id;
      selectedVariant = variant ?? run.flow_variant;
      currentStepId = run.current_step_id;
    }
  }
  store?.db.close();
  return renderMermaidFlow(loadFlow(flowId), selectedVariant, currentStepId);
}

function gitState(repo, redactor) {
  return {
    branch: gitOutput(repo, ["rev-parse", "--abbrev-ref", "HEAD"], redactor).stdout.trim(),
    status: gitOutput(repo, ["status", "--short"], redactor).stdout,
    diffStat: gitOutput(repo, ["diff", "--stat"], redactor).stdout,
    diff: gitOutput(repo, ["diff", "--"], redactor, MAX_TEXT).stdout
  };
}

function gitOutput(repo, args, redactor, maxLength = 30000) {
  const result = spawnSync("git", args, { cwd: repo, text: true, encoding: "utf8" });
  const text = result.status === 0 ? result.stdout : result.stderr || result.stdout;
  return {
    status: result.status,
    stdout: truncate(redactor(text), maxLength)
  };
}

function normalizeEvent(event, redactor) {
  return {
    id: event.id,
    runId: event.run_id,
    stepId: event.step_id,
    attempt: event.attempt,
    ts: event.ts,
    type: event.type,
    provider: event.provider,
    message: redactor(event.message ?? ""),
    payload: parsePayload(event.payload_json, redactor)
  };
}

function parsePayload(value, redactor) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(redactor(value));
  } catch {
    return redactor(value);
  }
}

function readStateFile(path, stateDir, redactor) {
  if (!path) {
    return null;
  }
  const fullPath = resolve(path);
  const root = resolve(stateDir);
  if (!fullPath.startsWith(`${root}/`) && fullPath !== root) {
    return null;
  }
  if (!existsSync(fullPath)) {
    return null;
  }
  return truncate(redactor(readFileSync(fullPath, "utf8")), MAX_TEXT);
}

function nextCliCommands({ run, currentStep, repo }) {
  if (!run || !currentStep) {
    return [];
  }
  const repoArg = ` --repo ${shellQuote(repo)}`;
  if (run.status === "failed") {
    return [
      `node src/cli.mjs status ${run.id}${repoArg}`,
      `node src/cli.mjs resume ${run.id}${repoArg}`
    ];
  }
  if (run.status === "needs_human") {
    return [
      `node src/cli.mjs show-gate ${run.id}${repoArg} --step ${run.current_step_id}`,
      `node src/cli.mjs approve ${run.id}${repoArg} --step ${run.current_step_id} --reason ok`,
      `node src/cli.mjs request-changes ${run.id}${repoArg} --step ${run.current_step_id} --reason "<reason>"`
    ];
  }
  if (run.status === "interrupted") {
    return [
      `node src/cli.mjs show-interrupts ${run.id}${repoArg} --step ${run.current_step_id}`,
      `node src/cli.mjs answer ${run.id}${repoArg} --step ${run.current_step_id} --message "<answer>"`
    ];
  }
  if (currentStep.provider !== "runtime") {
    return [
      `node src/cli.mjs run-next ${run.id}${repoArg}`
    ];
  }
  return [`node src/cli.mjs run-next ${run.id}${repoArg}`];
}

function redactObject(value, redactor) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(redactor(JSON.stringify(value)));
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n... [truncated ${text.length - maxLength} chars]`;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function sendHtml(response, body) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sendText(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function renderHtml() {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PDH Dev Dashboard - pdh-flowchart</title>
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
      --info: #185fa5;
      --info-bg: #e6f1fb;
      --info-border: #c9def4;
      --danger: #a32d2d;
      --danger-bg: #fcebeb;
      --danger-border: #efc2c2;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", "Meiryo", sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 13px;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
      min-height: 100%;
    }
    pre, code {
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
    }
    .app { display: flex; flex-direction: column; min-height: 100vh; }
    .header {
      border-bottom: 1px solid var(--border);
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: var(--bg);
      flex-wrap: wrap;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
      flex: 1;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 500;
      font-size: 14px;
      white-space: nowrap;
    }
    .brand-logo {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: #1c1b18;
      color: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
    }
    .breadcrumbs {
      font-size: 12px;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      flex: 1;
    }
    .breadcrumbs .sep { color: var(--text-dim); margin: 0 6px; }
    .breadcrumbs .current { color: var(--text); font-weight: 500; }
    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .run-switcher { display: none; }
    .run-select {
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--text);
      border-radius: 8px;
      padding: 5px 10px;
      font-size: 12px;
      font-family: inherit;
      max-width: 240px;
    }
    .flow-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: #efeefc;
      color: #3c3489;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid #cecbf6;
      white-space: nowrap;
    }
    .waiting-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--waiting-bg);
      color: var(--waiting-text);
      font-weight: 500;
      border: 1px solid var(--waiting-border);
    }
    .waiting-indicator.running {
      background: var(--info-bg);
      color: var(--info);
      border-color: var(--info-border);
    }
    .waiting-indicator.done {
      background: var(--done-bg);
      color: var(--done-text);
      border-color: #9fe1cb;
    }
    .waiting-indicator.failed {
      background: var(--danger-bg);
      color: var(--danger);
      border-color: var(--danger-border);
    }
    .waiting-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
      animation: pulse 1.8s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.45; transform: scale(1.3); }
    }
    .main {
      display: grid;
      grid-template-columns: 1fr 380px;
      min-height: 0;
      flex: 1;
    }
    .panel-left {
      padding: 18px 20px 32px;
      border-right: 1px solid var(--border);
      min-width: 0;
    }
    .panel-right {
      background: var(--surface);
      min-width: 0;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 10px;
      margin-bottom: 18px;
    }
    .summary-card {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      min-width: 0;
    }
    .summary-card.alert { background: var(--waiting-bg); border-color: var(--waiting-border); }
    .summary-card.done { background: var(--done-bg); border-color: #9fe1cb; }
    .summary-card .label {
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .summary-card.alert .label { color: var(--waiting-text); }
    .summary-card.done .label { color: var(--done-text); }
    .summary-card .value {
      font-size: 15px;
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    .summary-card .value .sub {
      font-size: 11px;
      color: var(--text-muted);
      font-weight: 400;
    }
    .summary-card .value.done { color: var(--done); }
    .summary-card .value.waiting { color: var(--waiting-text); }
    .summary-card .value.muted { color: var(--text-muted); }
    .section-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin: 16px 0 10px;
      gap: 12px;
      flex-wrap: wrap;
    }
    .section-title { font-size: 13px; font-weight: 500; color: var(--text); }
    .section-title .subtitle { font-size: 11px; font-weight: 400; color: var(--text-muted); margin-left: 6px; }
    .legend { display: flex; gap: 10px; font-size: 11px; color: var(--text-muted); flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 5px; }
    .legend-dot { width: 8px; height: 8px; border-radius: 50%; }
    .flow-container {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
    }
    .overview-scroll { overflow-x: auto; margin: 0 -16px; padding: 0 16px 4px; }
    .overview-flow { display: flex; align-items: center; gap: 6px; min-width: min-content; }
    .overview-node {
      flex: 0 0 auto;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg);
      cursor: pointer;
      transition: transform 0.15s, border-color 0.15s;
      min-width: 96px;
      text-align: center;
    }
    .overview-node .ov-label { font-size: 10px; color: var(--text-dim); margin-bottom: 1px; }
    .overview-node .ov-name { font-weight: 500; color: var(--text); font-size: 12px; }
    .overview-node.done { background: var(--done-bg); border-color: #9fe1cb; }
    .overview-node.done .ov-label, .overview-node.done .ov-name { color: var(--done-text); }
    .overview-node.waiting {
      background: var(--waiting-bg);
      border-color: var(--waiting-border);
      box-shadow: 0 0 0 3px rgba(186, 117, 23, 0.14);
    }
    .overview-node.waiting .ov-label, .overview-node.waiting .ov-name { color: var(--waiting-text); }
    .overview-node.pending {
      background: var(--pending-bg);
      border-color: var(--border);
      opacity: 0.55;
    }
    .overview-node.pending .ov-name { color: var(--pending-text); }
    .overview-node:hover { transform: translateY(-1px); border-color: var(--border-strong); }
    .overview-node.selected { outline: 2px solid #1c1b18; outline-offset: 1px; }
    .overview-arrow { color: var(--text-dim); flex: 0 0 auto; font-size: 12px; }
    .flow-toggle {
      display: inline-flex;
      background: var(--surface-2);
      border-radius: 8px;
      padding: 3px;
      gap: 2px;
    }
    .flow-toggle button {
      border: 0;
      background: transparent;
      padding: 5px 12px;
      border-radius: 6px;
      cursor: pointer;
      color: var(--text-muted);
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
    }
    .flow-toggle button.on {
      background: var(--bg);
      color: var(--text);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .flow-toggle button .count { color: var(--text-dim); font-weight: 400; margin-left: 4px; }
    .pdc-list { display: flex; flex-direction: column; gap: 8px; }
    .node {
      position: relative;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      cursor: pointer;
      transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .node:hover { border-color: var(--border-strong); transform: translateY(-1px); }
    .node.selected { outline: 2px solid #1c1b18; outline-offset: 1px; }
    .node-icon {
      flex: 0 0 auto;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
    }
    .node-body { flex: 1; min-width: 0; }
    .node-step { font-size: 10px; color: var(--text-muted); font-weight: 500; }
    .node-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .node-meta {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 1px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .node.done { background: var(--done-bg); border-color: #9fe1cb; }
    .node.done .node-icon { background: var(--done); color: #fff; }
    .node.done .node-title { color: var(--done-text); }
    .node.waiting {
      background: var(--waiting-bg);
      border-color: var(--waiting-border);
      box-shadow: 0 0 0 3px rgba(186, 117, 23, 0.14);
    }
    .node.waiting .node-icon { background: var(--waiting); color: #fff; position: relative; }
    .node.waiting .node-icon::after {
      content: "";
      position: absolute;
      inset: -3px;
      border: 2px solid var(--waiting);
      border-radius: 50%;
      opacity: 0.4;
      animation: ringPulse 1.8s ease-in-out infinite;
    }
    @keyframes ringPulse {
      0%, 100% { transform: scale(1); opacity: 0.4; }
      50% { transform: scale(1.3); opacity: 0; }
    }
    .node.waiting .node-title { color: var(--waiting-text); }
    .node.waiting .node-meta { color: var(--waiting-text); opacity: 0.8; }
    .node.pending {
      background: var(--pending-bg);
      border-color: var(--border);
      opacity: 0.55;
    }
    .node.pending .node-icon { background: #e0ddd2; color: #a3a097; }
    .node.pending .node-title { color: var(--pending-text); }
    .node.skipped {
      background: var(--skip-bg);
      border-color: var(--border);
      opacity: 0.45;
    }
    .node.skipped .node-icon { background: #d6d3c8; color: #8a887d; }
    .node.skipped .node-title {
      color: var(--skip-text);
      text-decoration: line-through;
      text-decoration-color: var(--text-dim);
    }
    .node + .node::before {
      content: "";
      position: absolute;
      top: -9px;
      left: 23px;
      width: 1px;
      height: 10px;
      background: var(--border-strong);
    }
    .detail { padding: 18px 20px 32px; }
    .detail-head {
      margin-bottom: 14px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .detail-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
    .detail-title { font-size: 17px; font-weight: 500; color: var(--text); margin-bottom: 6px; }
    .detail-desc { font-size: 12px; color: var(--text-muted); line-height: 1.6; }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 500;
      margin-top: 8px;
    }
    .status-pill.done { background: var(--done-bg); color: var(--done-text); }
    .status-pill.waiting { background: var(--waiting-bg); color: var(--waiting-text); }
    .status-pill.pending { background: var(--pending-bg); color: var(--text-muted); }
    .status-pill.skipped { background: var(--skip-bg); color: var(--skip-text); }
    .detail-section { margin-top: 16px; }
    .detail-section-title {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 8px;
      font-weight: 500;
    }
    .text-card, .code-panel, .placeholder-card {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
    }
    .text-card { font-size: 12px; color: var(--text); line-height: 1.65; }
    .text-card .muted { color: var(--text-muted); }
    .code-panel pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 11px;
      line-height: 1.6;
    }
    .placeholder-card {
      border-style: dashed;
      border-color: var(--border-strong);
      font-size: 12px;
      color: var(--text-muted);
      text-align: center;
    }
    .question-card {
      background: var(--waiting-bg);
      border: 1px solid var(--waiting-border);
      border-radius: 10px;
      padding: 14px 14px 12px;
      margin-top: 16px;
    }
    .question-card.failed {
      background: var(--danger-bg);
      border-color: var(--danger-border);
    }
    .question-card.running {
      background: var(--info-bg);
      border-color: var(--info-border);
    }
    .question-card-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(186, 117, 23, 0.18);
    }
    .question-card.failed .question-card-head { border-bottom-color: rgba(163, 45, 45, 0.18); }
    .question-card.running .question-card-head { border-bottom-color: rgba(24, 95, 165, 0.18); }
    .question-card-head .icon {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--waiting);
      color: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      position: relative;
      flex: 0 0 auto;
    }
    .question-card.failed .question-card-head .icon { background: var(--danger); }
    .question-card.running .question-card-head .icon { background: var(--info); }
    .question-card-head .icon::after {
      content: "";
      position: absolute;
      inset: -3px;
      border: 2px solid currentColor;
      border-radius: 50%;
      opacity: 0.3;
      animation: ringPulse 1.8s ease-in-out infinite;
    }
    .question-card-head .title {
      font-size: 13px;
      font-weight: 500;
      color: var(--waiting-text);
      flex: 1;
    }
    .question-card.failed .question-card-head .title { color: var(--danger); }
    .question-card.running .question-card-head .title { color: var(--info); }
    .question-card-head .elapsed {
      font-size: 11px;
      color: currentColor;
      opacity: 0.75;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .question-body { font-size: 12.5px; line-height: 1.65; color: var(--text); }
    .question-body p { margin: 0 0 10px; }
    .question-body p:last-child { margin-bottom: 0; }
    .question-body code {
      font-size: 11.5px;
      background: rgba(255, 255, 255, 0.7);
      padding: 1px 5px;
      border-radius: 3px;
    }
    .question-body strong { font-weight: 500; color: var(--waiting-text); }
    .question-card.failed .question-body strong { color: var(--danger); }
    .question-card.running .question-body strong { color: var(--info); }
    .question-options {
      margin: 12px 0 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .question-option {
      background: var(--bg);
      border: 1px solid var(--waiting-border);
      border-radius: 8px;
      padding: 9px 12px;
      display: flex;
      gap: 10px;
      font-size: 12.5px;
    }
    .question-card.failed .question-option { border-color: var(--danger-border); }
    .question-card.running .question-option { border-color: var(--info-border); }
    .question-option .opt-label {
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--waiting-bg);
      color: var(--waiting-text);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
    }
    .question-card.failed .question-option .opt-label { background: var(--danger-bg); color: var(--danger); }
    .question-card.running .question-option .opt-label { background: var(--info-bg); color: var(--info); }
    .question-option .opt-body { flex: 1; min-width: 0; }
    .question-option .opt-title { font-weight: 500; color: var(--text); margin-bottom: 2px; }
    .question-option .opt-hint { font-size: 11px; color: var(--text-muted); line-height: 1.5; overflow-wrap: anywhere; }
    .question-option.recommended { border-color: var(--waiting); }
    .question-card.failed .question-option.recommended { border-color: var(--danger); }
    .question-card.running .question-option.recommended { border-color: var(--info); }
    .question-option.recommended .opt-title::after {
      content: "推奨";
      display: inline-block;
      background: var(--waiting);
      color: #fff;
      font-size: 10px;
      font-weight: 500;
      padding: 1px 6px;
      border-radius: 999px;
      margin-left: 6px;
      vertical-align: middle;
    }
    .question-card.failed .question-option.recommended .opt-title::after { background: var(--danger); }
    .question-card.running .question-option.recommended .opt-title::after { background: var(--info); }
    .viewer-note {
      margin-top: 12px;
      padding: 8px 10px;
      background: rgba(255, 255, 255, 0.6);
      border-radius: 6px;
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      gap: 6px;
      align-items: flex-start;
    }
    .viewer-note .info-icon {
      flex: 0 0 auto;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--text-dim);
      color: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 600;
      margin-top: 1px;
    }
    .activity {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .activity-item {
      background: var(--bg);
      padding: 8px 10px;
      font-size: 12px;
      border-bottom: 1px solid var(--border);
    }
    .activity-item:last-child { border-bottom: 0; }
    .activity-item.highlight {
      background: var(--waiting-bg);
      border-left: 3px solid var(--waiting);
      padding-left: 9px;
    }
    .activity-item.failed {
      background: var(--danger-bg);
      border-left: 3px solid var(--danger);
      padding-left: 9px;
    }
    .activity-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; flex-wrap: wrap; }
    .activity-time {
      font-size: 10px;
      color: var(--text-muted);
    }
    .activity-actor {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 3px;
      white-space: nowrap;
    }
    .activity-actor.pm { background: #efeefc; color: #3c3489; }
    .activity-actor.coding { background: #e6f1fb; color: #185fa5; }
    .activity-actor.review { background: #faeeda; color: #854f0b; }
    .activity-msg { color: var(--text); line-height: 1.5; word-wrap: break-word; }
    .activity-msg code {
      font-size: 11px;
      background: var(--surface-2);
      padding: 1px 5px;
      border-radius: 3px;
    }
    .review-table { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .review-row {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 8px;
      padding: 7px 10px;
      font-size: 12px;
      align-items: center;
      border-bottom: 1px solid var(--border);
      background: var(--bg);
    }
    .review-row:last-child { border-bottom: 0; }
    .review-row .rv-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .review-row .rv-round { color: var(--text-muted); font-variant-numeric: tabular-nums; font-size: 11px; }
    .sev {
      display: inline-block;
      padding: 1px 7px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 500;
      white-space: nowrap;
    }
    .sev.none { background: var(--done-bg); color: var(--done-text); }
    .sev.minor { background: var(--waiting-bg); color: var(--waiting-text); }
    .sev.critical { background: var(--danger-bg); color: var(--danger); }
    .artifacts { display: flex; flex-direction: column; gap: 5px; }
    .artifact {
      padding: 7px 10px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg);
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .artifact-icon { flex: 0 0 auto; color: var(--text-muted); }
    .artifact-name {
      font-size: 11px;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .artifact-size { color: var(--text-muted); font-size: 11px; flex: 0 0 auto; }
    .empty {
      color: var(--text-muted);
      font-size: 12px;
      padding: 10px 0;
    }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }
    @media (max-width: 820px) {
      .main { grid-template-columns: 1fr; }
      .panel-right { border-top: 1px solid var(--border); }
      .panel-left { border-right: 0; }
    }
    @media (max-width: 600px) {
      .header { padding: 10px 14px; }
      .panel-left { padding: 14px 14px 24px; }
      .detail { padding: 16px 14px 24px; }
      .brand span:not(.brand-logo) { display: none; }
      .run-select { max-width: 180px; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="header">
      <div class="header-left">
        <div class="brand">
          <span class="brand-logo">PD</span>
          <span>PDH Dev</span>
        </div>
        <div class="breadcrumbs" id="breadcrumbs">-</div>
      </div>
      <div class="header-right">
        <div class="run-switcher" id="run-switcher"></div>
        <span class="flow-badge" id="flow-badge">Flow: -</span>
        <span class="waiting-indicator" id="status-indicator"><span class="waiting-dot"></span>読み込み中</span>
      </div>
    </header>
    <div class="main">
      <section class="panel-left">
        <div class="summary" id="summary"></div>
        <div class="section-head">
          <div class="section-title">全体フロー<span class="subtitle">Run progress</span></div>
          <div class="legend">
            <span class="legend-item"><span class="legend-dot" style="background: var(--done);"></span>完了</span>
            <span class="legend-item"><span class="legend-dot" style="background: var(--waiting);"></span>進行中 / 要対応</span>
            <span class="legend-item"><span class="legend-dot" style="background: #d3d1c7;"></span>未着手</span>
          </div>
        </div>
        <div class="flow-container" style="margin-bottom: 20px;">
          <div class="overview-scroll">
            <div class="overview-flow" id="overview-flow"></div>
          </div>
        </div>
        <div class="section-head">
          <div class="section-title">PD-C: Ticket 開発<span class="subtitle">ステップ詳細</span></div>
          <div class="flow-toggle" id="flow-toggle"></div>
        </div>
        <div class="flow-container">
          <div class="pdc-list" id="pdc-list"></div>
        </div>
      </section>
      <aside class="panel-right">
        <div class="detail" id="detail"></div>
      </aside>
    </div>
  </div>
  <script>
    const state = {
      runId: new URLSearchParams(location.search).get('run'),
      flow: null,
      selectedId: null,
      data: null
    };

    const OVERVIEW_PHASES = [
      { id: 'start', label: 'Start', title: '開始', steps: ['PD-C-2', 'PD-C-3'] },
      { id: 'plan', label: 'Plan', title: '準備', steps: ['PD-C-2', 'PD-C-3', 'PD-C-4', 'PD-C-5'] },
      { id: 'build', label: 'Build', title: '実装', steps: ['PD-C-6'] },
      { id: 'verify', label: 'Verify', title: '検証', steps: ['PD-C-7', 'PD-C-8', 'PD-C-9'] },
      { id: 'close', label: 'Close', title: '完了承認', steps: ['PD-C-10'] },
      { id: 'done', label: 'End', title: '完了', steps: [], complete: true }
    ];

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function basenamePath(value) {
      const input = String(value ?? '');
      const parts = input.split('/').filter(Boolean);
      return parts[parts.length - 1] || input || '-';
    }

    function formatInlineCode(value) {
      return '<code>' + esc(value) + '</code>';
    }

    function formatDateTime(value) {
      if (!value) {
        return '-';
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return String(value);
      }
      return date.toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    function formatShortTime(value) {
      if (!value) {
        return '-';
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return String(value);
      }
      return date.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    function elapsedText(from, to) {
      if (!from) {
        return '';
      }
      const left = new Date(from);
      const right = new Date(to || Date.now());
      if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) {
        return '';
      }
      const diffMinutes = Math.max(0, Math.floor((right.getTime() - left.getTime()) / 60000));
      const hours = String(Math.floor(diffMinutes / 60)).padStart(2, '0');
      const minutes = String(diffMinutes % 60).padStart(2, '0');
      return hours + ':' + minutes;
    }

    function selectedVariant(detail) {
      return state.flow || detail?.flow?.activeVariant || 'full';
    }

    function variantMeta(detail, variant) {
      return detail?.flow?.variants?.[variant] || { sequence: detail?.flow?.sequence || [], count: Number(detail?.flow?.sequence?.length || 0) };
    }

    function variantSequence(detail, variant) {
      return variantMeta(detail, variant).sequence || [];
    }

    function variantCount(detail, variant) {
      return Number(variantMeta(detail, variant).count || variantSequence(detail, variant).length || 0);
    }

    function flowSteps(detail) {
      return detail?.flow?.steps || [];
    }

    function stepById(detail, stepId) {
      return flowSteps(detail).find((step) => step.id === stepId) || null;
    }

    function currentStep(detail) {
      return stepById(detail, detail?.run?.current_step_id);
    }

    function isSkippedInVariant(detail, stepId) {
      return !variantSequence(detail, selectedVariant(detail)).includes(stepId);
    }

    function displayState(detail, step) {
      if (!step) {
        return 'pending';
      }
      if (isSkippedInVariant(detail, step.id)) {
        return 'skipped';
      }
      const progress = step.progress?.status || 'pending';
      if (progress === 'done') {
        return 'done';
      }
      if (progress === 'pending') {
        return 'pending';
      }
      if (progress === 'skipped') {
        return 'skipped';
      }
      return 'waiting';
    }

    function stepStatusLabel(detail, step, display) {
      if (display === 'done') {
        return '完了';
      }
      if (display === 'skipped') {
        return 'スキップ';
      }
      if (display === 'pending') {
        return '未着手';
      }
      if (step?.id === detail?.run?.current_step_id) {
        const runStatus = detail?.run?.status;
        if (runStatus === 'needs_human') {
          return '承認待ち';
        }
        if (runStatus === 'interrupted') {
          return '回答待ち';
        }
        if (runStatus === 'blocked') {
          return '要対応';
        }
        if (runStatus === 'failed') {
          return '失敗';
        }
      }
      return '進行中';
    }

    function stepMeta(detail, step, display) {
      if (display === 'skipped') {
        return selectedVariant(detail) === 'light' ? 'Light ではスキップ' : 'Flow 外';
      }
      if (display === 'done') {
        return step.progress?.note || '完了';
      }
      if (display === 'pending') {
        return step.summary || '未着手';
      }
      if (step.id === detail?.run?.current_step_id) {
        return currentStepMeta(detail, step);
      }
      return step.progress?.note || step.summary || '進行中';
    }

    function currentStepMeta(detail, step) {
      const runStatus = detail?.run?.status;
      if (runStatus === 'needs_human') {
        return 'ユーザ判断待ち';
      }
      if (runStatus === 'interrupted') {
        return 'ユーザ回答待ち';
      }
      if (runStatus === 'blocked') {
        return 'block 解消待ち';
      }
      if (runStatus === 'failed') {
        return '復旧待ち';
      }
      if (detail?.nextAction?.targetLabel) {
        return detail.nextAction.targetLabel + ' を確認';
      }
      return step.progress?.note || '進行中';
    }

    function doneStepCount(detail) {
      return flowSteps(detail).filter((step) => !isSkippedInVariant(detail, step.id) && displayState(detail, step) === 'done').length;
    }

    function actionCount(detail) {
      if (!detail?.nextAction) {
        return 0;
      }
      return detail.run?.status === 'completed' ? 0 : 1;
    }

    function variantLabel(value) {
      return value === 'light' ? 'Light' : 'Full';
    }

    function runStatusInfo(data) {
      const detail = data?.run;
      const status = detail?.run?.status || 'idle';
      let label = '待機中';
      let className = 'running';
      if (status === 'needs_human') {
        label = 'ユーザ判断待ち';
        className = 'waiting';
      } else if (status === 'interrupted') {
        label = 'ユーザ回答待ち';
        className = 'waiting';
      } else if (status === 'blocked') {
        label = '要対応';
        className = 'waiting';
      } else if (status === 'failed') {
        label = '復旧待ち';
        className = 'failed';
      } else if (status === 'completed') {
        label = '完了';
        className = 'done';
      } else if (status === 'running') {
        label = '次の実行待ち';
        className = 'running';
      }
      const since = statusSince(detail);
      const elapsed = elapsedText(since, data?.generatedAt);
      return {
        label,
        className,
        elapsed
      };
    }

    function statusSince(detail) {
      if (!detail) {
        return null;
      }
      if (detail.run?.status === 'needs_human') {
        return latestGate(detail, detail.run.current_step_id)?.created_at || detail.run.updated_at || detail.run.created_at;
      }
      if (detail.run?.status === 'interrupted') {
        return latestInterruption(detail, detail.run.current_step_id)?.createdAt || detail.run.updated_at || detail.run.created_at;
      }
      return detail.run?.updated_at || detail.run?.created_at || null;
    }

    function latestGate(detail, stepId) {
      return (detail?.gates || []).filter((gate) => gate.step_id === stepId).at(-1) || null;
    }

    function latestInterruption(detail, stepId) {
      return (detail?.interruptions || []).filter((item) => item.stepId === stepId).at(-1) || null;
    }

    function ensureSelections(data) {
      const detail = data?.run;
      if (!detail) {
        state.selectedId = null;
        state.flow = null;
        return;
      }
      if (!detail.flow?.variants?.[state.flow]) {
        state.flow = detail.flow.activeVariant || 'full';
      }
      const ids = flowSteps(detail).map((step) => step.id);
      if (!ids.includes(state.selectedId)) {
        state.selectedId = detail.run?.current_step_id || ids[0] || null;
      }
    }

    async function load() {
      const query = state.runId ? '?run=' + encodeURIComponent(state.runId) : '';
      const response = await fetch('/api/state' + query, { cache: 'no-store' });
      state.data = await response.json();
      if (!state.runId && state.data.selectedRunId) {
        state.runId = state.data.selectedRunId;
      }
      ensureSelections(state.data);
      render();
    }

    function render() {
      renderHeader(state.data);
      renderRunSwitcher(state.data.runs || []);
      renderSummary(state.data);
      renderOverview(state.data.run);
      renderFlowToggle(state.data.run);
      renderPdc(state.data.run);
      renderDetail(state.data);
    }

    function renderHeader(data) {
      const repoName = basenamePath(data?.repo);
      const ticket = data?.run?.run?.ticket_id || data?.selectedRunId || '-';
      const current = currentStep(data?.run);
      document.getElementById('breadcrumbs').innerHTML =
        '<span>' + esc(repoName) + '</span>' +
        '<span class="sep">/</span>' +
        '<span>' + esc(ticket) + '</span>' +
        '<span class="sep">/</span>' +
        '<span class="current">' + esc(current ? current.id + ' ' + current.label : 'run') + '</span>';
      document.getElementById('flow-badge').textContent = 'Flow: ' + variantLabel(selectedVariant(data?.run));
      const status = runStatusInfo(data);
      document.getElementById('status-indicator').className = 'waiting-indicator ' + status.className;
      document.getElementById('status-indicator').innerHTML =
        '<span class="waiting-dot"></span>' +
        esc(status.label + (status.elapsed ? ' · ' + status.elapsed + ' 経過' : ''));
    }

    function renderRunSwitcher(runs) {
      const root = document.getElementById('run-switcher');
      if (!runs.length || runs.length === 1) {
        root.style.display = 'none';
        root.innerHTML = '';
        return;
      }
      root.style.display = 'block';
      root.innerHTML =
        '<select class="run-select" id="run-select">' +
        runs.map((run) =>
          '<option value="' + esc(run.id) + '"' + (run.id === state.runId ? ' selected' : '') + '>' +
          esc((run.ticket_id || run.id) + ' · ' + (run.current_step_id || '-')) +
          '</option>'
        ).join('') +
        '</select>';
      const select = document.getElementById('run-select');
      select.addEventListener('change', () => {
        state.runId = select.value;
        state.selectedId = null;
        state.flow = null;
        history.replaceState(null, '', '?run=' + encodeURIComponent(state.runId));
        load();
      });
    }

    function summaryCard(label, value, sub, className) {
      const valueClass = className === 'alert' ? 'waiting' : (className === 'done' ? 'done' : 'muted');
      return '<div class="summary-card ' + esc(className || '') + '">' +
        '<div class="label">' + esc(label) + '</div>' +
        '<div class="value ' + esc(valueClass) + '">' + esc(value) +
        (sub ? ' <span class="sub">' + esc(sub) + '</span>' : '') +
        '</div>' +
        '</div>';
    }

    function renderSummary(data) {
      const detail = data?.run;
      if (!detail) {
        document.getElementById('summary').innerHTML =
          summaryCard('Run', 'No run', '', '') +
          summaryCard('現在', '-', '', '') +
          summaryCard('Flow', '-', '', '') +
          summaryCard('要対応', '0', 'none', '');
        return;
      }
      const current = currentStep(detail);
      const currentLabel = current ? current.id + ' ' + current.label : '-';
      const currentClass = detail.run?.status === 'completed' ? 'done' : (detail.run?.status === 'running' ? '' : 'alert');
      const nextTarget = detail.nextAction?.targetLabel || 'none';
      const providerLabel = current ? current.provider + ' / ' + current.mode : '-';
      document.getElementById('summary').innerHTML = [
        summaryCard('完了ステップ', String(doneStepCount(detail)) + ' / ' + String(variantCount(detail, selectedVariant(detail))), '', doneStepCount(detail) > 0 ? 'done' : ''),
        summaryCard('現在', currentLabel, stepStatusLabel(detail, current, displayState(detail, current)), currentClass),
        summaryCard('Provider', providerLabel, variantLabel(selectedVariant(detail)), ''),
        summaryCard('要対応', String(actionCount(detail)), nextTarget, actionCount(detail) > 0 ? 'alert' : '')
      ].join('');
    }

    function phaseNodes(detail) {
      return OVERVIEW_PHASES
        .map((phase) => ({
          ...phase,
          steps: phase.complete ? [] : phase.steps.filter((stepId) => variantSequence(detail, selectedVariant(detail)).includes(stepId))
        }))
        .filter((phase) => phase.complete || phase.steps.length > 0);
    }

    function phaseState(detail, phase) {
      if (phase.complete) {
        return detail?.run?.status === 'completed' ? 'done' : 'pending';
      }
      const states = phase.steps
        .map((stepId) => displayState(detail, stepById(detail, stepId)))
        .filter(Boolean);
      if (!states.length) {
        return 'pending';
      }
      if (states.every((value) => value === 'done' || value === 'skipped')) {
        return 'done';
      }
      if (states.some((value) => value === 'waiting')) {
        return 'waiting';
      }
      if (states.some((value) => value === 'done')) {
        return 'done';
      }
      return 'pending';
    }

    function phaseSelected(detail, phase) {
      if (phase.complete) {
        return detail?.run?.status === 'completed';
      }
      return phase.steps.includes(state.selectedId);
    }

    function selectPhase(detail, phase) {
      if (!detail) {
        return;
      }
      if (phase.complete) {
        state.selectedId = detail.run?.current_step_id || flowSteps(detail).at(-1)?.id || null;
      } else {
        const current = detail.run?.current_step_id;
        state.selectedId = phase.steps.includes(current) ? current : (phase.steps[0] || state.selectedId);
      }
      render();
    }

    function renderOverview(detail) {
      const root = document.getElementById('overview-flow');
      if (!detail) {
        root.innerHTML = '<div class="empty">No run selected</div>';
        return;
      }
      const phases = phaseNodes(detail);
      root.innerHTML = '';
      phases.forEach((phase, index) => {
        const stateClass = phaseState(detail, phase);
        const button = document.createElement('div');
        button.className = 'overview-node ' + stateClass + (phaseSelected(detail, phase) ? ' selected' : '');
        button.innerHTML =
          '<div class="ov-label">' + esc(phase.label) + '</div>' +
          '<div class="ov-name">' + esc(phase.title) + '</div>';
        button.addEventListener('click', () => selectPhase(detail, phase));
        root.appendChild(button);
        if (index < phases.length - 1) {
          const arrow = document.createElement('div');
          arrow.className = 'overview-arrow';
          arrow.textContent = '→';
          root.appendChild(arrow);
        }
      });
    }

    function renderFlowToggle(detail) {
      const root = document.getElementById('flow-toggle');
      if (!detail?.flow?.variants) {
        root.innerHTML = '';
        return;
      }
      const variants = Object.keys(detail.flow.variants).sort((left, right) => (left === 'full' ? -1 : right === 'full' ? 1 : left.localeCompare(right)));
      root.innerHTML = variants.map((variant) =>
        '<button class="' + (selectedVariant(detail) === variant ? 'on' : '') + '" data-flow="' + esc(variant) + '">' +
        esc(variantLabel(variant)) +
        '<span class="count">' + esc(String(variantCount(detail, variant))) + '</span>' +
        '</button>'
      ).join('');
      root.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          state.flow = button.dataset.flow;
          render();
        });
      });
    }

    function iconFor(display) {
      if (display === 'done') {
        return '✓';
      }
      if (display === 'waiting') {
        return '?';
      }
      if (display === 'skipped') {
        return '–';
      }
      return '';
    }

    function renderPdc(detail) {
      const root = document.getElementById('pdc-list');
      if (!detail) {
        root.innerHTML = '<div class="empty">No flow</div>';
        return;
      }
      root.innerHTML = flowSteps(detail).map((step) => {
        const display = displayState(detail, step);
        return '<div class="node ' + esc(display) + (step.id === state.selectedId ? ' selected' : '') + '" data-step="' + esc(step.id) + '">' +
          '<div class="node-icon">' + esc(iconFor(display)) + '</div>' +
          '<div class="node-body">' +
          '<div class="node-step">' + esc(step.id) + '</div>' +
          '<div class="node-title">' + esc(step.label || step.id) + '</div>' +
          '<div class="node-meta">' + esc(stepMeta(detail, step, display)) + '</div>' +
          '</div>' +
          '</div>';
      }).join('');
      root.querySelectorAll('[data-step]').forEach((item) => item.addEventListener('click', () => {
        state.selectedId = item.dataset.step;
        render();
      }));
    }

    function currentStepActionCardClass(detail) {
      if (detail?.run?.status === 'failed') {
        return 'failed';
      }
      if (detail?.run?.status === 'running') {
        return 'running';
      }
      return '';
    }

    function actionCardTitle(detail) {
      return detail?.nextAction?.title || '次の操作';
    }

    function actionCardParagraphs(detail, step) {
      const paragraphs = [];
      const gate = latestGate(detail, step.id);
      const interruption = latestInterruption(detail, step.id);
      if (detail?.run?.status === 'needs_human') {
        if (gate?.prompt) {
          paragraphs.push(gate.prompt);
        }
        paragraphs.push(detail?.nextAction?.detail || 'Gate summary を確認して判断します。');
        if (gate?.summary) {
          paragraphs.push('Gate summary は下の成果物または summary セクションから確認できます。');
        }
      } else if (detail?.run?.status === 'interrupted') {
        if (interruption?.message) {
          paragraphs.push(interruption.message);
        }
        paragraphs.push(detail?.nextAction?.detail || '割り込みに回答してから続行します。');
      } else if (detail?.run?.status === 'blocked') {
        paragraphs.push(detail?.nextAction?.detail || 'block された理由を確認して解消します。');
        if (step?.progress?.note) {
          paragraphs.push(step.progress.note);
        }
      } else if (detail?.run?.status === 'failed') {
        paragraphs.push(detail?.nextAction?.detail || '失敗した provider step を復旧します。');
        paragraphs.push('status と failure summary を確認してから resume します。');
      } else if (detail?.run?.status === 'completed') {
        paragraphs.push('この run は完了しています。差分と成果物を確認します。');
      } else {
        paragraphs.push(detail?.nextAction?.detail || 'run-next を実行して gate / interruption / block まで進めます。');
      }
      return paragraphs;
    }

    function commandTitle(command) {
      if (command.includes('show-gate ')) {
        return 'gate summary を見る';
      }
      if (command.includes('approve ')) {
        return 'approve を実行する';
      }
      if (command.includes('request-changes ')) {
        return 'request-changes を実行する';
      }
      if (command.includes('reject ')) {
        return 'reject を実行する';
      }
      if (command.includes('show-interrupts ')) {
        return '割り込み内容を見る';
      }
      if (command.includes('answer ')) {
        return 'answer を実行する';
      }
      if (command.includes('resume ')) {
        return 'resume を実行する';
      }
      if (command.includes('status ')) {
        return 'status を確認する';
      }
      if (command.includes('run-next ')) {
        return 'run-next を実行する';
      }
      return 'CLI を実行する';
    }

    function renderActionCard(data, detail, step) {
      if (!step || step.id !== detail?.run?.current_step_id || !detail?.nextAction) {
        return '';
      }
      const commands = detail.nextAction.commands || [];
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const options = commands.map((command, index) =>
        '<div class="question-option' + (index === 0 ? ' recommended' : '') + '">' +
          '<span class="opt-label">' + esc(letters[index] || String(index + 1)) + '</span>' +
          '<div class="opt-body">' +
            '<div class="opt-title">' + esc(commandTitle(command)) + '</div>' +
            '<div class="opt-hint">' + formatInlineCode(command) + '</div>' +
          '</div>' +
        '</div>'
      ).join('');
      const body = actionCardParagraphs(detail, step).map((paragraph) => '<p>' + esc(paragraph) + '</p>').join('');
      return '<div class="question-card ' + esc(currentStepActionCardClass(detail)) + '">' +
        '<div class="question-card-head">' +
          '<span class="icon">' + esc(detail.run?.status === 'failed' ? '!' : '?') + '</span>' +
          '<span class="title">' + esc(actionCardTitle(detail)) + '</span>' +
          '<span class="elapsed">' + esc(runStatusInfo(data).elapsed || '') + '</span>' +
        '</div>' +
        '<div class="question-body">' + body +
          (options ? '<div class="question-options">' + options + '</div>' : '') +
        '</div>' +
        '<div class="viewer-note">' +
          '<span class="info-icon">i</span>' +
          '<span>このダッシュボードは read-only です。実行・回答・承認は CLI から行います。</span>' +
        '</div>' +
      '</div>';
    }

    function describeGuard(guard) {
      if (!guard) {
        return '-';
      }
      if (guard.type === 'note_section_updated') {
        return guard.path + ' / ' + guard.section;
      }
      if (guard.type === 'ticket_section_updated') {
        return guard.path + ' / ' + guard.section;
      }
      if (guard.type === 'git_commit_exists') {
        return guard.pattern || 'commit required';
      }
      if (guard.type === 'judgement_status') {
        return (guard.artifactKind || 'judgement') + ' / ' + (guard.accepted || []).join(', ');
      }
      if (guard.type === 'command') {
        return guard.command || 'command';
      }
      if (guard.type === 'ac_verification_table') {
        return 'allowUnverified=' + (guard.allowUnverified ? 'true' : 'false');
      }
      if (guard.type === 'artifact_exists') {
        return guard.kind || 'artifact';
      }
      if (guard.type === 'human_approved') {
        return 'explicit approval required';
      }
      if (guard.type === 'ticket_closed') {
        return 'ticket.sh close';
      }
      return guard.type || '-';
    }

    function renderGuards(step) {
      if (!step?.guards?.length) {
        return '';
      }
      return '<div class="detail-section">' +
        '<div class="detail-section-title">Guards</div>' +
        '<div class="review-table">' +
        step.guards.map((guard) =>
          '<div class="review-row">' +
            '<div class="rv-name">' + esc(guard.id || guard.type || '-') + '</div>' +
            '<div class="rv-round">' + esc(guard.type || '-') + '</div>' +
            '<div><span class="sev minor">' + esc(describeGuard(guard)) + '</span></div>' +
          '</div>'
        ).join('') +
        '</div>' +
      '</div>';
    }

    function activityClass(event) {
      if (event.type === 'blocked' || event.type === 'ask_human' || event.type === 'interrupted') {
        return ' highlight';
      }
      if (event.type === 'step_finished' && String(event.message || '').includes('failed')) {
        return ' failed';
      }
      return '';
    }

    function actorClass(event) {
      if (event.provider === 'codex') {
        return 'coding';
      }
      if (event.provider === 'claude') {
        return 'review';
      }
      return 'pm';
    }

    function actorLabel(event) {
      if (event.provider === 'codex') {
        return 'Codex';
      }
      if (event.provider === 'claude') {
        return 'Claude';
      }
      return 'Runtime';
    }

    function stepEvents(detail, stepId) {
      return (detail?.events || []).filter((event) => event.stepId === stepId);
    }

    function renderActivity(detail, stepId) {
      const events = stepEvents(detail, stepId);
      if (!events.length) {
        return '';
      }
      return '<div class="detail-section">' +
        '<div class="detail-section-title">エージェント実行ログ</div>' +
        '<div class="activity">' +
        events.map((event) =>
          '<div class="activity-item' + activityClass(event) + '">' +
            '<div class="activity-meta">' +
              '<span class="activity-time">' + esc(formatShortTime(event.ts)) + '</span>' +
              '<span class="activity-actor ' + esc(actorClass(event)) + '">' + esc(actorLabel(event)) + '</span>' +
              '<span class="activity-time">' + esc(event.type) + '</span>' +
            '</div>' +
            '<div class="activity-msg">' + esc(event.message || event.type || '-') + '</div>' +
          '</div>'
        ).join('') +
        '</div>' +
      '</div>';
    }

    function collectArtifacts(detail, stepId) {
      const items = [];
      const seen = new Set();
      function add(path, source) {
        if (!path || seen.has(path)) {
          return;
        }
        seen.add(path);
        items.push({
          path,
          source: source || 'artifact',
          name: basenamePath(path)
        });
      }
      (detail?.sessions || []).filter((session) => session.step_id === stepId).forEach((session) => {
        add(session.raw_log_path, session.provider + ' raw log');
      });
      (detail?.gates || []).filter((gate) => gate.step_id === stepId).forEach((gate) => {
        add(gate.summary, gate.decision ? 'gate ' + gate.decision : 'gate summary');
      });
      (detail?.interruptions || []).filter((item) => item.stepId === stepId).forEach((item) => {
        add(item.artifactPath, item.status || 'interruption');
        add(item.answer?.artifactPath, 'answer');
      });
      stepEvents(detail, stepId).forEach((event) => {
        const payload = event.payload || {};
        add(payload.artifactPath, event.type);
        add(payload.path, event.type);
        add(payload.rawLogPath, event.type);
      });
      return items;
    }

    function renderArtifacts(detail, stepId) {
      const items = collectArtifacts(detail, stepId);
      if (!items.length) {
        return '';
      }
      return '<div class="detail-section">' +
        '<div class="detail-section-title">成果物</div>' +
        '<div class="artifacts">' +
        items.map((item) =>
          '<div class="artifact">' +
            '<svg class="artifact-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">' +
              '<path d="M9 1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6L9 1z"/>' +
              '<path d="M9 1v5h5"/>' +
            '</svg>' +
            '<span class="artifact-name">' + esc(item.name) + '</span>' +
            '<span class="artifact-size">' + esc(item.source) + '</span>' +
          '</div>'
        ).join('') +
        '</div>' +
      '</div>';
    }

    function renderGateSummary(detail, stepId) {
      const gate = latestGate(detail, stepId);
      if (!gate?.summaryText) {
        return '';
      }
      return '<div class="detail-section">' +
        '<div class="detail-section-title">Gate Summary</div>' +
        '<div class="code-panel"><pre>' + esc(gate.summaryText) + '</pre></div>' +
      '</div>';
    }

    function renderRepository(data) {
      const lines = [
        'Branch: ' + (data?.git?.branch || '-'),
        'Git status:',
        data?.git?.status || 'clean',
        '',
        'Diff stat:',
        data?.git?.diffStat || 'none'
      ];
      return '<div class="detail-section">' +
        '<div class="detail-section-title">Repository</div>' +
        '<div class="code-panel"><pre>' + esc(lines.join('\\n')) + '</pre></div>' +
      '</div>';
    }

    function renderDetail(data) {
      const root = document.getElementById('detail');
      const detail = data?.run;
      if (!detail) {
        root.innerHTML = '<div class="placeholder-card">No run selected</div>';
        return;
      }
      const step = stepById(detail, state.selectedId) || currentStep(detail) || flowSteps(detail)[0];
      if (!step) {
        root.innerHTML = '<div class="placeholder-card">No flow steps</div>';
        return;
      }
      const display = displayState(detail, step);
      const statusLabel = stepStatusLabel(detail, step, display);
      let html =
        '<div class="detail-head">' +
          '<div class="detail-label">' + esc(step.id) + ' · ' + esc(formatDateTime(detail.run?.updated_at || detail.run?.created_at)) + '</div>' +
          '<div class="detail-title">' + esc(step.label || step.id) + '</div>' +
          '<div class="detail-desc">' + esc(step.summary || '') + '</div>' +
          '<span class="status-pill ' + esc(display) + '">' +
            '<span style="width: 6px; height: 6px; border-radius: 50%; background: currentColor;"></span>' +
            esc(statusLabel + (stepMeta(detail, step, display) ? ' · ' + stepMeta(detail, step, display) : '')) +
          '</span>' +
        '</div>';

      if (display === 'skipped') {
        html +=
          '<div class="detail-section">' +
            '<div class="detail-section-title">Light フローについて</div>' +
            '<div class="placeholder-card">この step は ' + esc(variantLabel(selectedVariant(detail))) + ' フローではスキップされます。<br/>Full に切り替えると詳細を確認できます。</div>' +
          '</div>';
      } else {
        html += renderActionCard(data, detail, step);
        html +=
          '<div class="detail-section">' +
            '<div class="detail-section-title">見るもの</div>' +
            '<div class="text-card">' + esc(step.summary || '記録と差分を確認します。') + '</div>' +
          '</div>' +
          '<div class="detail-section">' +
            '<div class="detail-section-title">次にすること</div>' +
            '<div class="text-card">' + esc(step.userAction || '特別な操作はありません。') + '</div>' +
          '</div>';
        html += renderGuards(step);
        html += renderGateSummary(detail, step.id);
        html += renderActivity(detail, step.id);
        html += renderArtifacts(detail, step.id);
        if (display === 'pending' && !stepEvents(detail, step.id).length) {
          html +=
            '<div class="detail-section">' +
              '<div class="placeholder-card">まだ実行されていません。<br/>前段のステップが完了すると自動的に開始されます。</div>' +
            '</div>';
        }
      }

      html += renderRepository(data);
      root.innerHTML = html;
    }

    load();
    setInterval(load, 2000);
  </script>
</body>
</html>`;
}
