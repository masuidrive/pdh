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
    buildFlowView(flow, run.flow_variant, run.current_step_id),
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
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>pdh-flowchart</title>
  <style>
    :root {
      --bg: #f7f8fa;
      --panel: #ffffff;
      --ink: #1b1f24;
      --muted: #667085;
      --line: #d9dee7;
      --accent: #176b87;
      --accent-2: #bf4f43;
      --ok: #247a4d;
      --warn: #9a5b00;
      --bad: #a13232;
      --code: #101418;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      letter-spacing: 0;
    }
    header {
      min-height: 64px;
      padding: 14px 20px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      display: grid;
      grid-template-columns: minmax(180px, 1fr) auto;
      gap: 16px;
      align-items: center;
    }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 18px; font-weight: 700; }
    .repo { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: 4px; overflow-wrap: anywhere; }
    .mode { border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; background: #f9fbfc; color: var(--muted); }
    main {
      display: grid;
      grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
      min-height: calc(100vh - 64px);
    }
    aside {
      border-right: 1px solid var(--line);
      background: #eef2f6;
      padding: 14px;
      overflow: auto;
    }
    .content { padding: 16px; overflow: hidden; }
    .run-list { display: grid; gap: 8px; }
    .run-item {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      padding: 10px;
      text-align: left;
      cursor: pointer;
      color: var(--ink);
    }
    .run-item.active { border-color: var(--accent); box-shadow: inset 4px 0 0 var(--accent); }
    .run-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; }
    .run-meta { margin-top: 6px; color: var(--muted); font-size: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
    .overview {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .metric, .section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 6px;
    }
    .metric { padding: 12px; min-height: 74px; }
    .label { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
    .value { font-weight: 700; overflow-wrap: anywhere; }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: #f7f8fa;
      font-size: 12px;
      color: var(--muted);
    }
    .badge.running, .badge.completed { color: var(--ok); border-color: #9fd2b8; background: #eef8f2; }
    .badge.blocked, .badge.needs_human, .badge.interrupted { color: var(--warn); border-color: #e7c47f; background: #fff8e8; }
    .badge.failed { color: var(--bad); border-color: #dda1a1; background: #fff0f0; }
    .badge.done, .badge.ready { color: var(--ok); border-color: #9fd2b8; background: #eef8f2; }
    .badge.current { color: var(--accent); border-color: #86bfd0; background: #eef7fa; }
    .badge.pending, .badge.skipped { color: var(--muted); border-color: var(--line); background: #f7f8fa; }
    .step-rail {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(74px, 1fr));
      gap: 6px;
      margin-bottom: 14px;
    }
    .step {
      min-height: 58px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      padding: 8px;
      font-size: 12px;
    }
    .step-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); }
    .step-label { font-weight: 700; margin-top: 3px; }
    .step.current { border-color: var(--accent-2); box-shadow: inset 0 -3px 0 var(--accent-2); }
    .tabs {
      display: flex;
      gap: 6px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 12px;
      overflow-x: auto;
    }
    .tab {
      border: 1px solid var(--line);
      border-bottom: 0;
      border-radius: 6px 6px 0 0;
      background: #f1f4f7;
      color: var(--ink);
      padding: 8px 12px;
      cursor: pointer;
      min-width: 74px;
    }
    .tab.active { background: var(--panel); color: var(--accent); font-weight: 700; }
    .panel-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 36%);
      gap: 12px;
    }
    .section { min-height: 220px; overflow: hidden; }
    .section h2 {
      font-size: 13px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      background: #fbfcfd;
    }
    .section-body { padding: 12px; overflow: auto; max-height: 58vh; }
    pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.45;
    }
    .diff pre, .log pre { color: #e8edf2; background: var(--code); border-radius: 6px; padding: 12px; }
    .event, .gate, .interrupt, .command, .flow-card {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 8px;
      background: #ffffff;
    }
    .next-action {
      border: 1px solid #86bfd0;
      border-radius: 6px;
      background: #eef7fa;
      padding: 12px;
      margin-bottom: 12px;
    }
    .next-action.status-needs_human, .next-action.status-interrupted, .next-action.status-blocked {
      border-color: #e7c47f;
      background: #fff8e8;
    }
    .next-action.status-failed {
      border-color: #dda1a1;
      background: #fff0f0;
    }
    .next-action.status-done {
      border-color: #9fd2b8;
      background: #eef8f2;
    }
    .next-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
    .next-title { font-weight: 700; font-size: 15px; }
    .next-detail { color: var(--ink); margin-bottom: 8px; }
    .next-target { color: var(--muted); font-size: 13px; margin-bottom: 8px; }
    .flow-map { display: grid; gap: 10px; }
    .flow-card.current { border-color: var(--accent-2); box-shadow: inset 4px 0 0 var(--accent-2); }
    .flow-card.status-done { background: #fbfdfc; }
    .flow-card.status-current, .flow-card.status-ready { border-color: #86bfd0; }
    .flow-card.status-blocked, .flow-card.status-needs_human, .flow-card.status-interrupted { border-color: #e7c47f; background: #fffdf7; }
    .flow-card.status-failed { border-color: #dda1a1; background: #fff8f8; }
    .flow-card.status-pending, .flow-card.status-skipped { background: #fafbfc; }
    .flow-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; margin-bottom: 6px; }
    .flow-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); font-size: 12px; }
    .flow-label { font-weight: 700; font-size: 15px; }
    .flow-summary { color: var(--ink); margin: 6px 0; }
    .flow-action, .flow-progress-note { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .flow-field { color: var(--muted); font-size: 12px; font-weight: 700; margin-right: 6px; }
    .flow-arrow { color: var(--muted); text-align: center; font-size: 18px; line-height: 1; }
    .event-meta { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
    .empty { color: var(--muted); padding: 12px; }
    @media (max-width: 900px) {
      header, main, .overview, .panel-grid { grid-template-columns: 1fr; }
      aside { border-right: 0; border-bottom: 1px solid var(--line); max-height: 280px; }
      .section-body { max-height: none; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>pdh-flowchart</h1>
      <div class="repo" id="repo">-</div>
    </div>
    <div class="mode" id="mode">read-only</div>
  </header>
  <main>
    <aside>
      <div class="label">Runs</div>
      <div class="run-list" id="runs"></div>
    </aside>
    <section class="content">
      <div class="overview" id="overview"></div>
      <div class="step-rail" id="steps"></div>
      <div class="tabs" id="tabs"></div>
      <div class="panel-grid">
        <section class="section" id="primary"></section>
        <section class="section" id="secondary"></section>
      </div>
    </section>
  </main>
  <script>
    const state = { runId: new URLSearchParams(location.search).get('run'), tab: 'flow', data: null };
    const tabs = ['flow', 'logs', 'diff', 'gates', 'interruptions', 'commands'];

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }
    function badge(status) {
      return '<span class="badge ' + esc(status) + '">' + esc(status || '-') + '</span>';
    }
    async function load() {
      const query = state.runId ? '?run=' + encodeURIComponent(state.runId) : '';
      const response = await fetch('/api/state' + query, { cache: 'no-store' });
      state.data = await response.json();
      if (!state.runId && state.data.selectedRunId) state.runId = state.data.selectedRunId;
      render();
    }
    function render() {
      const data = state.data;
      document.getElementById('repo').textContent = data.repo || '-';
      document.getElementById('mode').textContent = data.mode || 'read-only';
      renderRuns(data.runs || []);
      renderOverview(data);
      renderSteps(data.run);
      renderTabs();
      renderPrimary(data);
      renderSecondary(data);
    }
    function renderRuns(runs) {
      const root = document.getElementById('runs');
      if (!runs.length) {
        root.innerHTML = '<div class="empty">No runs</div>';
        return;
      }
      root.innerHTML = runs.map((run) => (
        '<button class="run-item ' + (run.id === state.runId ? 'active' : '') + '" data-run="' + esc(run.id) + '">' +
        '<div class="run-id">' + esc(run.id) + '</div>' +
        '<div class="run-meta">' + badge(run.status) + '<span>' + esc(run.current_step_id || '-') + '</span></div>' +
        '</button>'
      )).join('');
      root.querySelectorAll('[data-run]').forEach((item) => item.addEventListener('click', () => {
        state.runId = item.dataset.run;
        history.replaceState(null, '', '?run=' + encodeURIComponent(state.runId));
        load();
      }));
    }
    function renderOverview(data) {
      const run = data.run?.run;
      const current = data.run?.currentStep;
      document.getElementById('overview').innerHTML = [
        metric('Status', run ? badge(run.status) : '-'),
        metric('Current Step', esc(current ? current.id + ' ' + (current.label || '') : '-')),
        metric('Provider', esc(current?.provider || '-')),
        metric('Branch', esc(data.git?.branch || '-'))
      ].join('');
    }
    function metric(label, value) {
      return '<div class="metric"><div class="label">' + esc(label) + '</div><div class="value">' + value + '</div></div>';
    }
    function renderSteps(detail) {
      const steps = detail?.flow?.steps || [];
      const current = detail?.run?.current_step_id;
      document.getElementById('steps').innerHTML = steps.map((step) => (
        '<div class="step ' + (step.id === current ? 'current' : '') + '" title="' + esc(step.summary || '') + '">' +
        '<div class="step-id">' + esc(step.id) + '</div>' +
        '<div class="step-label">' + esc(step.label || step.id) + '</div>' +
        '<div>' + badge(step.progress?.label || '-') + '</div>' +
        '</div>'
      )).join('');
    }
    function renderTabs() {
      const root = document.getElementById('tabs');
      root.innerHTML = tabs.map((tab) => '<button class="tab ' + (state.tab === tab ? 'active' : '') + '" data-tab="' + tab + '">' + tab + '</button>').join('');
      root.querySelectorAll('[data-tab]').forEach((item) => item.addEventListener('click', () => {
        state.tab = item.dataset.tab;
        renderPrimary(state.data);
        renderSecondary(state.data);
      }));
    }
    function renderPrimary(data) {
      const primary = document.getElementById('primary');
      const detail = data.run;
      if (!detail) {
        primary.innerHTML = '<h2>Run</h2><div class="empty">No run selected</div>';
        return;
      }
      if (state.tab === 'flow') {
        primary.className = 'section';
        primary.innerHTML = '<h2>Flow</h2><div class="section-body">' + renderNextAction(detail.nextAction) + renderFlow(detail.flow || {}) + '</div>';
      } else if (state.tab === 'logs') {
        primary.innerHTML = '<h2>Logs</h2><div class="section-body">' + (detail.events || []).map(renderEvent).join('') + '</div>';
      } else if (state.tab === 'diff') {
        primary.className = 'section diff';
        primary.innerHTML = '<h2>Diff</h2><div class="section-body"><pre>' + esc(data.git?.diff || data.git?.diffStat || 'No diff') + '</pre></div>';
        return;
      } else if (state.tab === 'gates') {
        primary.className = 'section';
        primary.innerHTML = '<h2>Gates</h2><div class="section-body">' + renderGates(detail.gates || []) + '</div>';
      } else if (state.tab === 'interruptions') {
        primary.className = 'section';
        primary.innerHTML = '<h2>Interruptions</h2><div class="section-body">' + renderInterruptions(detail.interruptions || []) + '</div>';
      } else {
        primary.className = 'section';
        primary.innerHTML = '<h2>CLI Commands</h2><div class="section-body">' + (detail.cli || []).map((command) => '<div class="command"><pre>' + esc(command) + '</pre></div>').join('') + '</div>';
      }
      if (state.tab !== 'diff') primary.className = 'section';
    }
    function renderSecondary(data) {
      const detail = data.run;
      const lines = state.tab === 'flow' ? [
        'Mermaid:',
        detail?.flow?.mermaid || ''
      ] : [
        'Git status:',
        data.git?.status || 'clean',
        '',
        'Diff stat:',
        data.git?.diffStat || 'none',
        '',
        'Provider sessions:',
        ...(detail?.sessions || []).map((session) => session.step_id + ' attempt ' + session.attempt + ' ' + session.provider + ' ' + (session.raw_log_path || ''))
      ];
      document.getElementById('secondary').innerHTML = '<h2>Repository</h2><div class="section-body"><pre>' + esc(lines.join('\\n')) + '</pre></div>';
    }
    function renderFlow(flow) {
      const steps = flow.steps || [];
      if (!steps.length) return '<div class="empty">No flow</div>';
      return '<div class="flow-map">' + steps.map((step, index) => (
        '<div class="flow-card status-' + esc(step.progress?.status || 'pending') + ' ' + (step.current ? 'current' : '') + '">' +
        '<div class="flow-head"><span class="flow-id">' + esc(step.id) + '</span><span class="flow-label">' + esc(step.label || step.id) + '</span>' + badge(step.progress?.label || '-') + badge(step.provider + '/' + step.mode) + '</div>' +
        '<div class="flow-summary"><span class="flow-field">見るもの</span>' + esc(step.summary || '') + '</div>' +
        '<div class="flow-action"><span class="flow-field">次</span>' + esc(step.userAction || '') + '</div>' +
        '<div class="flow-progress-note">' + esc(step.progress?.note || '') + '</div>' +
        '</div>' + (index < steps.length - 1 ? '<div class="flow-arrow">↓</div>' : '')
      )).join('') + '</div>';
    }
    function renderNextAction(action) {
      if (!action) return '';
      const commands = action.commands || [];
      const commandHtml = commands.length
        ? commands.map((command) => '<div class="command"><pre>' + esc(command) + '</pre></div>').join('')
        : '';
      return '<div class="next-action status-' + esc(action.status || 'current') + '">' +
        '<div class="next-head">' + badge('Next') + '<span class="next-title">' + esc(action.title || '-') + '</span></div>' +
        '<div class="next-detail">' + esc(action.detail || '') + '</div>' +
        '<div class="next-target">見る場所: ' + esc(action.targetLabel || '-') + '</div>' +
        commandHtml +
        '</div>';
    }
    function renderEvent(event) {
      return '<div class="event"><div class="event-meta">#' + esc(event.id) + ' ' + esc(event.ts) + ' ' + esc(event.stepId || '-') + ' ' + esc(event.type) + ' ' + esc(event.provider || '') + '</div><div>' + esc(event.message || '') + '</div></div>';
    }
    function renderGates(gates) {
      if (!gates.length) return '<div class="empty">No gates</div>';
      return gates.map((gate) => '<div class="gate"><div class="event-meta">' + esc(gate.step_id) + ' ' + esc(gate.status) + ' ' + esc(gate.decision || '') + '</div><pre>' + esc(gate.summaryText || gate.summary || '') + '</pre></div>').join('');
    }
    function renderInterruptions(items) {
      if (!items.length) return '<div class="empty">No interruptions</div>';
      return items.map((item) => '<div class="interrupt"><div class="event-meta">' + esc(item.id) + ' ' + esc(item.status) + '</div><pre>' + esc(item.message || '') + '\\n\\n' + esc(item.answer?.message || '') + '</pre></div>').join('');
    }
    load();
    setInterval(load, 2000);
  </script>
</body>
</html>`;
}
