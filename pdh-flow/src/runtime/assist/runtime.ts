import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { latestOpenInterruption } from "../interruptions.ts";
import { latestAttemptResult, latestHumanGate } from "../state.ts";
import { loadStepUiRuntime } from "../ui.ts";
import { renderTemplate } from "../../flow/prompts/template-engine.ts";

const RUNTIME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CLI_PATH = join(RUNTIME_ROOT, "src", "cli", "index.ts");
const NODE_PATH = process.execPath;

export function assistDir({ stateDir, runId, stepId }) {
  return join(stateDir, "runs", runId, "steps", stepId, "assist");
}

export function assistManifestPath({ stateDir, runId, stepId }) {
  return join(assistDir({ stateDir, runId, stepId }), "manifest.json");
}

export function assistPromptPath({ stateDir, runId, stepId }) {
  return join(assistDir({ stateDir, runId, stepId }), "prompt.md");
}

export function assistSystemPromptPath({ stateDir, runId, stepId }) {
  return join(assistDir({ stateDir, runId, stepId }), "system-prompt.txt");
}

export function assistSessionPath({ stateDir, runId, stepId }) {
  return join(assistDir({ stateDir, runId, stepId }), "session.json");
}

export function assistSignalsPath({ stateDir, runId, stepId }) {
  return join(assistDir({ stateDir, runId, stepId }), "signals.jsonl");
}

export function latestAssistSignalPath({ stateDir, runId, stepId }) {
  return join(assistDir({ stateDir, runId, stepId }), "latest-signal.json");
}

export function ticketAssistDir({ repoPath, ticketId }) {
  return join(repoPath, ".pdh-flow", "ticket-assist", ticketId);
}

export function ticketAssistManifestPath({ repoPath, ticketId }) {
  return join(ticketAssistDir({ repoPath, ticketId }), "manifest.json");
}

export function ticketAssistPromptPath({ repoPath, ticketId }) {
  return join(ticketAssistDir({ repoPath, ticketId }), "prompt.md");
}

export function ticketAssistSystemPromptPath({ repoPath, ticketId }) {
  return join(ticketAssistDir({ repoPath, ticketId }), "system-prompt.txt");
}

export function ticketAssistSessionPath({ repoPath, ticketId }) {
  return join(ticketAssistDir({ repoPath, ticketId }), "session.json");
}

export function repoAssistDir({ repoPath }) {
  return join(repoPath, ".pdh-flow", "repo-assist");
}

export function repoAssistManifestPath({ repoPath }) {
  return join(repoAssistDir({ repoPath }), "manifest.json");
}

export function repoAssistPromptPath({ repoPath }) {
  return join(repoAssistDir({ repoPath }), "prompt.md");
}

export function repoAssistSystemPromptPath({ repoPath }) {
  return join(repoAssistDir({ repoPath }), "system-prompt.txt");
}

export function repoAssistSessionPath({ repoPath }) {
  return join(repoAssistDir({ repoPath }), "session.json");
}

export function ticketStartRequestsDir({ repoPath }) {
  return join(repoPath, ".pdh-flow", "ticket-assist", "requests");
}

export function ticketStartRequestPath({ repoPath, ticketId }) {
  return join(ticketStartRequestsDir({ repoPath }), `${ticketId}.json`);
}

export function allowedAssistSignals({ runStatus, step, runtime = null, gate = null }) {
  if (runStatus === "needs_human" && isHumanGateStep(step)) {
    const hasRerunRequirement = Boolean(gate?.rerun_requirement?.target_step_id);
    if (hasRerunRequirement) {
      return ["propose-rerun-from", "propose-reject"];
    }
    if (step?.assistEscalation && step?.mode !== "human") {
      return ["propose-approve", "propose-rerun-from"];
    }
    return ["propose-approve", "propose-request-changes", "propose-reject", "propose-rerun-from"];
  }
  if (runStatus === "interrupted") {
    return ["answer"];
  }
  if (runStatus === "blocked") {
    return ["continue"];
  }
  if (runStatus === "failed") {
    return ["continue"];
  }
  if (runStatus === "running" && isAdvancePending({ runtime, step })) {
    return ["continue"];
  }
  return [];
}

export function prepareAssistSession({ repoPath, runtime, step, bare = false, model = null }) {
  const runId = runtime.run.id;
  const stepId = step.id;
  const dir = assistDir({ stateDir: runtime.stateDir, runId, stepId });
  mkdirSync(dir, { recursive: true });

  const sessionId = createAssistSessionId();
  const gate = latestHumanGate({ stateDir: runtime.stateDir, runId, stepId });
  const interruption = latestOpenInterruption({ stateDir: runtime.stateDir, runId, stepId });
  const uiRuntime = loadStepUiRuntime({ stateDir: runtime.stateDir, runId, stepId });
  const allowedSignals = allowedAssistSignals({ runStatus: runtime.run.status, step, runtime, gate });
  const wrappers = ensureAssistWrappers(repoPath);
  const readFirst = [
    "./current-ticket.md",
    "./current-note.md",
    interruption?.artifactPath ? repoRelativePath(repoPath, interruption.artifactPath) : null,
    uiRuntime?.artifactPath ? repoRelativePath(repoPath, uiRuntime.artifactPath) : null
  ].filter(Boolean);
  const blockedGuards = Array.isArray(uiRuntime?.guards)
    ? uiRuntime.guards.filter((guard) => guard.status === "failed").map((guard) => ({
        id: guard.id || guard.guardId || "",
        evidence: guard.evidence || ""
      }))
    : [];
  const signalExamples = buildSignalExamples(stepId, allowedSignals);
  const systemPrompt = buildAssistSystemPrompt();
  const prompt = buildAssistPrompt({
    runtime,
    step,
    gate,
    interruption,
    blockedGuards,
    readFirst,
    wrappers,
    allowedSignals,
    signalExamples
  });

  const manifest = {
    generated_at: new Date().toISOString(),
    session_id: sessionId,
    repo_path: repoPath,
    run_id: runId,
    ticket: runtime.run.ticket_id || null,
    flow: runtime.run.flow_id,
    variant: runtime.run.flow_variant,
    run_status: runtime.run.status,
    step: {
      id: step.id,
      label: step.label || null,
      provider: step.provider,
      mode: step.mode
    },
    read_first: readFirst,
    canonical_files: {
      ticket: "./current-ticket.md",
      note: "./current-note.md"
    },
    assist_commands: {
      signal: repoRelativePath(repoPath, wrappers.signalScriptPath),
      test: `${repoRelativePath(repoPath, wrappers.testScriptPath)} -- <command>`
    },
    allowed_signals: allowedSignals,
    signal_examples: signalExamples,
    open_interruption: interruption?.artifactPath ? repoRelativePath(repoPath, interruption.artifactPath) : null,
    blocked_guards: blockedGuards,
    launch: {
      provider: "claude",
      bare,
      model: model || null
    }
  };

  const manifestPath = assistManifestPath({ stateDir: runtime.stateDir, runId, stepId });
  const promptPath = assistPromptPath({ stateDir: runtime.stateDir, runId, stepId });
  const systemPromptPath = assistSystemPromptPath({ stateDir: runtime.stateDir, runId, stepId });
  const sessionPath = assistSessionPath({ stateDir: runtime.stateDir, runId, stepId });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(promptPath, prompt);
  writeFileSync(systemPromptPath, `${systemPrompt.trimEnd()}\n`);
  writeFileSync(sessionPath, JSON.stringify({
    id: sessionId,
    provider: "claude",
    status: "prepared",
    run_id: runId,
    step_id: stepId,
    repo_path: repoPath,
    bare,
    model: model || null,
    manifest_path: manifestPath,
    prompt_path: promptPath,
    system_prompt_path: systemPromptPath,
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    exit_code: null,
    signal: null
  }, null, 2) + "\n");

  return {
    sessionId,
    manifest,
    manifestPath,
    prompt,
    promptPath,
    systemPrompt,
    systemPromptPath,
    sessionPath,
    wrappers,
    allowedSignals
  };
}

export function prepareTicketAssistSession({ repoPath, ticketId, bare = false, model = null, variant = "full" }) {
  const ticketPaths = resolveTicketPaths({ repoPath, ticketId });
  const dir = ticketAssistDir({ repoPath, ticketId });
  mkdirSync(dir, { recursive: true });

  const sessionId = createAssistSessionId();
  const wrappers = ensureAssistWrappers(repoPath);
  const readFirst = [
    ticketPaths.ticketPath ? repoRelativePath(repoPath, ticketPaths.ticketPath) : null,
    ticketPaths.notePath ? repoRelativePath(repoPath, ticketPaths.notePath) : null,
    existsSync(join(repoPath, "product-brief.md")) ? "./product-brief.md" : null,
    existsSync(join(repoPath, "AGENTS.md")) ? "./AGENTS.md" : null
  ].filter(Boolean);
  const ticketUsage = captureTicketScriptUsage(repoPath);
  const systemPrompt = buildTicketAssistSystemPrompt();
  const prompt = buildTicketAssistPrompt({
    repoPath,
    ticketId,
    ticketPaths,
    readFirst,
    ticketUsage,
    wrappers,
    variant
  });

  const manifest = {
    generated_at: new Date().toISOString(),
    session_id: sessionId,
    kind: "ticket",
    repo_path: repoPath,
    ticket_id: ticketId,
    variant,
    read_first: readFirst,
    canonical_files: {
      ticket: ticketPaths.ticketPath ? repoRelativePath(repoPath, ticketPaths.ticketPath) : null,
      note: ticketPaths.notePath ? repoRelativePath(repoPath, ticketPaths.notePath) : null
    },
    assist_commands: {
      ticket_start_request: repoRelativePath(repoPath, wrappers.ticketStartRequestScriptPath),
      test: `${repoRelativePath(repoPath, wrappers.testScriptPath)} -- <command>`
    },
    launch: {
      provider: "claude",
      bare,
      model: model || null
    }
  };

  const manifestPath = ticketAssistManifestPath({ repoPath, ticketId });
  const promptPath = ticketAssistPromptPath({ repoPath, ticketId });
  const systemPromptPath = ticketAssistSystemPromptPath({ repoPath, ticketId });
  const sessionPath = ticketAssistSessionPath({ repoPath, ticketId });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(promptPath, prompt);
  writeFileSync(systemPromptPath, `${systemPrompt.trimEnd()}\n`);
  writeFileSync(sessionPath, JSON.stringify({
    id: sessionId,
    kind: "ticket",
    provider: "claude",
    status: "prepared",
    repo_path: repoPath,
    ticket_id: ticketId,
    bare,
    model: model || null,
    manifest_path: manifestPath,
    prompt_path: promptPath,
    system_prompt_path: systemPromptPath,
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    exit_code: null,
    signal: null
  }, null, 2) + "\n");

  return {
    sessionId,
    manifest,
    manifestPath,
    prompt,
    promptPath,
    systemPrompt,
    systemPromptPath,
    sessionPath,
    wrappers,
    allowedSignals: []
  };
}

export function prepareRepoAssistSession({ repoPath, bare = false, model = null }) {
  const dir = repoAssistDir({ repoPath });
  mkdirSync(dir, { recursive: true });

  const sessionId = createAssistSessionId();
  const readFirst = [
    existsSync(join(repoPath, "product-brief.md")) ? "./product-brief.md" : null,
    existsSync(join(repoPath, "AGENTS.md")) ? "./AGENTS.md" : null,
    existsSync(join(repoPath, "docs/product-delivery-hierarchy.md")) ? "./docs/product-delivery-hierarchy.md" : null
  ].filter(Boolean);
  const ticketUsage = captureTicketScriptUsage(repoPath);
  const epicsList = listEpics(repoPath);
  const ticketsList = listActiveTickets(repoPath);

  const systemPrompt = renderTemplate("shared/repo_assist_system.j2").replace(/\n+$/, "");
  const prompt = renderTemplate("shared/repo_assist_body.j2", {
    repoPath,
    readFirst,
    ticketUsage,
    epicsList,
    ticketsList
  });

  const manifest = {
    generated_at: new Date().toISOString(),
    session_id: sessionId,
    kind: "repo",
    repo_path: repoPath,
    read_first: readFirst,
    launch: {
      provider: "claude",
      bare,
      model: model || null
    }
  };

  const manifestPath = repoAssistManifestPath({ repoPath });
  const promptPath = repoAssistPromptPath({ repoPath });
  const systemPromptPath = repoAssistSystemPromptPath({ repoPath });
  const sessionPath = repoAssistSessionPath({ repoPath });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(promptPath, prompt);
  writeFileSync(systemPromptPath, `${systemPrompt.trimEnd()}\n`);
  writeFileSync(sessionPath, JSON.stringify({
    id: sessionId,
    kind: "repo",
    provider: "claude",
    status: "prepared",
    repo_path: repoPath,
    bare,
    model: model || null,
    manifest_path: manifestPath,
    prompt_path: promptPath,
    system_prompt_path: systemPromptPath,
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    exit_code: null,
    signal: null
  }, null, 2) + "\n");

  return {
    sessionId,
    manifest,
    manifestPath,
    prompt,
    promptPath,
    systemPrompt,
    systemPromptPath,
    sessionPath,
    wrappers: {},
    allowedSignals: []
  };
}

function listEpics(repoPath) {
  const dir = join(repoPath, "epics");
  if (!existsSync(dir)) return "";
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => `  - epics/${e.name}`)
      .sort();
    return entries.join("\n");
  } catch {
    return "";
  }
}

function listActiveTickets(repoPath) {
  const dir = join(repoPath, "tickets");
  if (!existsSync(dir)) return "";
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md") && !e.name.endsWith("-note.md"))
      .map((e) => `  - tickets/${e.name}`)
      .sort();
    return entries.join("\n");
  } catch {
    return "";
  }
}

export function markAssistSessionStarted({ stateDir, runId, stepId, sessionId, command }) {
  writeSession({
    stateDir,
    runId,
    stepId,
    sessionId,
    mutator(session) {
      return {
        ...session,
        status: "running",
        command,
        started_at: new Date().toISOString()
      };
    }
  });
}

export function markAssistSessionFinished({ stateDir, runId, stepId, sessionId, exitCode, signal = null }) {
  writeSession({
    stateDir,
    runId,
    stepId,
    sessionId,
    mutator(session) {
      return {
        ...session,
        status: exitCode === 0 ? "completed" : "failed",
        exit_code: exitCode,
        signal,
        finished_at: new Date().toISOString()
      };
    }
  });
}

export function appendAssistSignal({ stateDir, runId, stepId, signal, reason = null, message = null, runNext = true, source = "assist" }) {
  const entry = {
    id: `assist-signal-${Date.now()}-${randomBytes(3).toString("hex")}`,
    ts: new Date().toISOString(),
    run_id: runId,
    step_id: stepId,
    signal,
    reason,
    message,
    run_next: runNext,
    source
  };
  const path = assistSignalsPath({ stateDir, runId, stepId });
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(entry)}\n`, { flag: "a" });
  writeFileSync(latestAssistSignalPath({ stateDir, runId, stepId }), `${JSON.stringify(entry, null, 2)}\n`);
  return entry;
}

export function loadLatestAssistSignal({ stateDir, runId, stepId }) {
  const path = latestAssistSignalPath({ stateDir, runId, stepId });
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function appendTicketStartRequest({ repoPath, ticketId, variant = "full", reason = null, source = "assist" }) {
  const entry = {
    id: `ticket-start-request-${Date.now()}-${randomBytes(3).toString("hex")}`,
    ts: new Date().toISOString(),
    ticket_id: ticketId,
    variant,
    reason,
    source,
    status: "pending"
  };
  const path = ticketStartRequestPath({ repoPath, ticketId });
  mkdirSync(ticketStartRequestsDir({ repoPath }), { recursive: true });
  writeFileSync(path, `${JSON.stringify(entry, null, 2)}\n`);
  return entry;
}

export function loadPendingTicketStartRequests({ repoPath }) {
  const dir = ticketStartRequestsDir({ repoPath });
  if (!existsSync(dir)) {
    return [];
  }
  const items = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(join(dir, entry.name), "utf8"));
      if (parsed?.status === "pending" && parsed?.ticket_id) {
        items.push(parsed);
      }
    } catch {
      // Ignore malformed request artifacts.
    }
  }
  items.sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")));
  return items;
}

export function clearTicketStartRequest({ repoPath, ticketId }) {
  const path = ticketStartRequestPath({ repoPath, ticketId });
  try {
    rmSync(path, { force: true });
  } catch {
    // Ignore cleanup races.
  }
}

export function updateLatestAssistSignal({ stateDir, runId, stepId, mutator }) {
  const current = loadLatestAssistSignal({ stateDir, runId, stepId });
  if (!current) {
    return null;
  }
  const updated = mutator(current);
  if (!updated) {
    return current;
  }
  writeFileSync(latestAssistSignalPath({ stateDir, runId, stepId }), `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}

function ensureAssistWrappers(repoPath) {
  const binDir = join(repoPath, ".pdh-flow", "bin");
  mkdirSync(binDir, { recursive: true });
  const signalScriptPath = join(binDir, "assist-signal");
  const testScriptPath = join(binDir, "assist-test");
  const ticketStartRequestScriptPath = join(binDir, "ticket-start-request");
  writeFileSync(signalScriptPath, renderSignalScript(repoPath));
  writeFileSync(testScriptPath, renderTestScript(repoPath));
  writeFileSync(ticketStartRequestScriptPath, renderTicketStartRequestScript(repoPath));
  chmodSync(signalScriptPath, 0o755);
  chmodSync(testScriptPath, 0o755);
  chmodSync(ticketStartRequestScriptPath, 0o755);
  return {
    binDir,
    signalScriptPath,
    testScriptPath,
    ticketStartRequestScriptPath
  };
}

function renderSignalScript(repoPath) {
  const repo = shellQuote(repoPath);
  const cli = shellQuote(CLI_PATH);
  const node = shellQuote(NODE_PATH);
  return `#!/usr/bin/env bash
set -euo pipefail
ROOT=${repo}
cd "$ROOT"
exec ${node} ${cli} assist-signal --repo "$ROOT" "$@"
`;
}

function renderTestScript(repoPath) {
  const repo = shellQuote(repoPath);
  return `#!/usr/bin/env bash
set -euo pipefail
ROOT=${repo}
cd "$ROOT"
if [ "$#" -gt 0 ] && [ "$1" = "--" ]; then
  shift
fi
if [ "$#" -eq 0 ]; then
  echo "usage: ./.pdh-flow/bin/assist-test -- <command>" >&2
  exit 2
fi
exec "$@"
`;
}

function renderTicketStartRequestScript(repoPath) {
  const repo = shellQuote(repoPath);
  const cli = shellQuote(CLI_PATH);
  const node = shellQuote(NODE_PATH);
  return `#!/usr/bin/env bash
set -euo pipefail
ROOT=${repo}
cd "$ROOT"
exec ${node} ${cli} ticket-start-request --repo "$ROOT" "$@"
`;
}

function buildAssistSystemPrompt() {
  return renderTemplate("shared/assist_system.j2").replace(/\n+$/, "");
}

function buildTicketAssistSystemPrompt() {
  return renderTemplate("shared/ticket_assist_system.j2").replace(/\n+$/, "");
}

function buildAssistPrompt({ runtime, step, gate, interruption, blockedGuards, readFirst, wrappers, allowedSignals, signalExamples }) {
  // step.prompt.assistCheckpoints is the canonical source (see flows/steps/<id>.yaml).
  // Fall back to the legacy hardcoded map only if the step yaml didn't define any.
  const stepCheckpoints = Array.isArray(step?.prompt?.assistCheckpoints) && step.prompt.assistCheckpoints.length > 0
    ? step.prompt.assistCheckpoints
    : assistCheckpoints(step.id);
  const statusGuidance = assistStatusGuidance({ status: runtime.run.status, stepId: step.id, hasBlockedGuards: blockedGuards.length > 0 });
  const isStopState = ["needs_human", "interrupted", "blocked", "failed"].includes(runtime.run.status);
  const noSignalGuidance = runtime.run.status === "running"
    ? "runtime が進行中の間は、この terminal を調査、相談、検証に使ってください。step 完了後は web UI か CLI に戻り、flow 遷移待ちなら `run-next` を使います。"
    : "編集の準備ができたら web UI か CLI に戻り、そこで Resume / retry を使ってください。";
  return renderTemplate("shared/assist_body.j2", {
    runtime,
    step,
    gate,
    interruption,
    interruptionRelPath: interruption?.artifactPath ? repoRelativePath(runtime.repoPath, interruption.artifactPath) : "",
    blockedGuards,
    readFirst,
    statusGuidance,
    stepCheckpoints,
    isStopState,
    signalScriptRelPath: repoRelativePath(runtime.repoPath, wrappers.signalScriptPath),
    testScriptRelPath: repoRelativePath(runtime.repoPath, wrappers.testScriptPath),
    allowedSignalsText: allowedSignals.join(", ") || "(なし)",
    signalExamples,
    noSignalGuidance
  });
}

function buildTicketAssistPrompt({ repoPath, ticketId, ticketPaths, readFirst, ticketUsage, wrappers, variant }) {
  return renderTemplate("shared/ticket_assist_body.j2", {
    ticketId,
    variant,
    ticketPathRel: ticketPaths.ticketPath ? repoRelativePath(repoPath, ticketPaths.ticketPath) : "",
    notePathRel: ticketPaths.notePath ? repoRelativePath(repoPath, ticketPaths.notePath) : "",
    readFirst,
    ticketUsage,
    ticketStartRequestScriptRelPath: repoRelativePath(repoPath, wrappers.ticketStartRequestScriptPath),
    testScriptRelPath: repoRelativePath(repoPath, wrappers.testScriptPath)
  });
}

function isAdvancePending({ runtime, step }) {
  if (!runtime?.run?.id || runtime.run.status !== "running" || !step || step.provider === "runtime") {
    return false;
  }
  const latest = latestAttemptResult({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    provider: step.provider
  });
  return latest?.status === "completed";
}

function buildSignalExamples(stepId, allowedSignals) {
  const path = "./.pdh-flow/bin/assist-signal";
  const examples = [];
  for (const signal of allowedSignals) {
    if (signal === "propose-approve") {
      examples.push(`${path} --step ${stepId} --signal propose-approve --reason "この編集を踏まえると gate を受け入れてよい"`);
    } else if (signal === "propose-request-changes") {
      examples.push(`${path} --step ${stepId} --signal propose-request-changes --reason "この gate は開いたままにして変更依頼を出すべき"`);
    } else if (signal === "propose-reject") {
      examples.push(`${path} --step ${stepId} --signal propose-reject --reason "この計画は進めるべきではない"`);
    } else if (signal === "propose-rerun-from") {
      examples.push(`${path} --step ${stepId} --signal propose-rerun-from --target-step ${defaultRerunTarget(stepId)} --reason "この変更で後段 review が無効になるため、ここから rerun すべき"`);
    } else if (signal === "answer") {
      examples.push(`${path} --step ${stepId} --signal answer --message "..."`);
    } else if (signal === "continue") {
      examples.push(`${path} --step ${stepId} --signal continue --reason "blocker に対処したので再評価して先へ進める"`);
    }
  }
  return examples;
}

function assistStatusGuidance({ status, stepId, hasBlockedGuards }) {
  if (status === "needs_human") {
    return [
      "これは human gate です。調査、編集、テストはできますが、最終遷移は引き続き runtime が管理します。",
      "編集が同じ gate 資料の明確化だけなら approve か request-changes を提案します。以前の計画や review 作業を無効にするなら rerun target を 1 つ提案します。"
    ];
  }
  if (status === "failed") {
    return [
      "この step はすでに実行されて失敗しています。failure summary、reviewer 出力、ログを使って、環境問題と本質的な finding を切り分けてください。",
      `blocker に対処できたら \`continue\` を送り、runtime に ${stepId} を現在の step から再実行させます。`
    ];
  }
  if (status === "blocked") {
    return [
      "まだ証跡が欠けている guard があります。欠けている note、ticket、judgement、検証証跡が実際に揃うまで `continue` は送らないでください。",
      hasBlockedGuards
        ? "上に出ている blocked-guard の証跡を、rerun 前に直すべき項目のチェックリストとして使ってください。"
        : "rerun 前に足りない証跡を特定するため、ui-runtime と failure artifact を確認してください。"
    ];
  }
  if (status === "interrupted") {
    return [
      "runtime は割り込みに対する明示的な回答を待っています。",
      "未回答の質問に絞って答え、その後 `answer` を送って runtime がその新しい指示で再開できるようにしてください。"
    ];
  }
  return [];
}

function assistCheckpoints(stepId) {
  const checkpoints = {
    "PD-C-2": [
      "調査を閉じる前に、コード、テスト、外部 surface、docs、example をまたいだ blast radius を確認する。",
      "PD-C-3 が同じ repository walk を繰り返さずに計画できるよう、具体的な finding と risk を記録する。"
    ],
    "PD-C-3": [
      "計画に具体的なファイル、ファイル別コンテキスト、設計判断、テスト、実環境検証手順が書かれているか確認する。",
      "PD-C-2 の懸念が曖昧な注意書きのまま残らず、明示的に扱われていることを確認する。"
    ],
    "PD-C-4": [
      "その計画が ticket の目的を満たし、ローカルパターンに従い、信頼できる検証経路を持つか確認する。",
      "計画が実質的に変わったら、この review を無理に通すより PD-C-3 と PD-C-4 をやり直す方を優先する。"
    ],
    "PD-C-5": [
      "実装提案の前に、計画、設計判断、テスト戦略、実環境確認、未解消懸念が `current-note` と `current-ticket` に揃っているか確認する。",
      "gate 中に計画や ticket intent が変わったなら、approve ではなく rerun 提案を優先する。"
    ],
    "PD-C-6": [
      "コード、テスト、`current-note`、`current-ticket` を承認済み計画に揃え続ける。",
      "失敗した検証やスキップした検証を、受け入れ可能な完了として扱わない。"
    ],
    "PD-C-7": [
      "critical / major finding はコード修正か検証証跡で解消し、その後で同じ品質 step を再実行する。",
      "notes に直したと書いてあるだけで重大 finding を閉じず、最新の repo 状態で確認する。"
    ],
    "PD-C-8": [
      "足りていない outcome、足りていない coverage、まだ ticket を close すべきでない理由を探す。",
      "実装や scope を変える必要があるなら、PD-C-6 かそれ以前の review へ戻る前提で考える。"
    ],
    "PD-C-9": [
      "`Acceptance Criteria` の各項目には `AC 裏取り結果` で明示的な証拠が必要。",
      "変わった user-facing surface は、unit-style の証拠だけでなく consumer 視点でも確認する。"
    ],
    "PD-C-10": [
      "AC 証跡、ユーザ向け確認案内、残リスクがすべて明示できる時だけ close を提案する。",
      "gate 中にコードや AC 証跡が変わったなら、close ではなく rerun 提案になる前提で考える。"
    ]
  };
  return checkpoints[stepId] ?? [];
}

function writeSession({ stateDir, runId, stepId, sessionId, mutator }) {
  const path = assistSessionPath({ stateDir, runId, stepId });
  mkdirSync(join(path, ".."), { recursive: true });
  let session: any = {};
  try {
    session = JSON.parse(String(readFileSafe(path) || "{}"));
  } catch {
    session = {};
  }
  if (sessionId && session.id && session.id !== sessionId) {
    return;
  }
  writeFileSync(path, `${JSON.stringify(mutator(session), null, 2)}\n`);
}

function readFileSafe(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function repoRelativePath(repoPath, fullPath) {
  if (!fullPath) {
    return null;
  }
  const rel = relative(repoPath, fullPath) || ".";
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function createAssistSessionId() {
  return `assist-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
}

function resolveTicketPaths({ repoPath, ticketId }) {
  const candidates = [
    join(repoPath, "tickets", `${ticketId}.md`),
    join(repoPath, "tickets", "done", `${ticketId}.md`)
  ];
  const ticketPath = candidates.find((path) => existsSync(path)) || null;
  const notePath = ticketPath ? ticketPath.replace(/\.md$/u, "-note.md") : null;
  return {
    ticketPath,
    notePath: notePath && existsSync(notePath) ? notePath : null
  };
}

function captureTicketScriptUsage(repoPath) {
  const scriptPath = join(repoPath, "ticket.sh");
  if (!existsSync(scriptPath)) {
    return "ticket.sh not found";
  }
  const result = spawnSync(scriptPath, [], {
    cwd: repoPath,
    encoding: "utf8",
    timeout: 5000,
    env: process.env
  });
  const output = [String(result.stdout || "").trim(), String(result.stderr || "").trim()].filter(Boolean).join("\n");
  return clampText(output || "ticket.sh returned no output", 6000);
}

function defaultRerunTarget(stepId) {
  if (stepId === "PD-C-5") {
    return "PD-C-4";
  }
  if (stepId === "PD-C-10") {
    return "PD-C-7";
  }
  return "PD-C-3";
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function clampText(text, maxChars) {
  const value = String(text ?? "");
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n…`;
}

function isHumanGateStep(step) {
  return Boolean(step?.humanGate);
}
