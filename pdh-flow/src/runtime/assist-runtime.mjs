import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { latestOpenInterruption } from "./interruptions.mjs";
import { latestAttemptResult, latestHumanGate } from "./runtime-state.mjs";
import { loadStepUiRuntime } from "./step-ui.mjs";
import { renderTemplate } from "./template-engine.mjs";

const RUNTIME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_PATH = join(RUNTIME_ROOT, "src", "cli", "index.mjs");
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

export function ticketStartRequestsDir({ repoPath }) {
  return join(repoPath, ".pdh-flow", "ticket-assist", "requests");
}

export function ticketStartRequestPath({ repoPath, ticketId }) {
  return join(ticketStartRequestsDir({ repoPath }), `${ticketId}.json`);
}

export function allowedAssistSignals({ runStatus, step, runtime = null }) {
  if (runStatus === "needs_human" && isHumanGateStep(step)) {
    if (step?.assistEscalation && step?.mode !== "human") {
      return ["recommend-approve", "recommend-rerun-from"];
    }
    return ["recommend-approve", "recommend-request-changes", "recommend-reject", "recommend-rerun-from"];
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
  const allowedSignals = allowedAssistSignals({ runStatus: runtime.run.status, step, runtime });
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
  return renderTemplate("assist-system.j2").replace(/\n+$/, "");
}

function buildTicketAssistSystemPrompt() {
  return renderTemplate("ticket-assist-system.j2").replace(/\n+$/, "");
}

function buildAssistPrompt({ runtime, step, gate, interruption, blockedGuards, readFirst, wrappers, allowedSignals, signalExamples }) {
  const stepCheckpoints = assistCheckpoints(step.id);
  const statusGuidance = assistStatusGuidance({ status: runtime.run.status, stepId: step.id, hasBlockedGuards: blockedGuards.length > 0 });
  const isStopState = ["needs_human", "interrupted", "blocked", "failed"].includes(runtime.run.status);
  const noSignalGuidance = runtime.run.status === "running"
    ? "Use this terminal for inspection, discussion, or verification while the runtime continues. When the step completes, return to the web UI or CLI and use `run-next` if a flow transition is waiting."
    : "When your edits are ready, return to the web UI or CLI and use Resume / retry there.";
  return renderTemplate("assist-body.j2", {
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
    allowedSignalsText: allowedSignals.join(", ") || "(none)",
    signalExamples,
    noSignalGuidance
  });
}

function buildTicketAssistPrompt({ repoPath, ticketId, ticketPaths, readFirst, ticketUsage, wrappers, variant }) {
  return renderTemplate("ticket-assist-body.j2", {
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
    if (signal === "recommend-approve") {
      examples.push(`${path} --step ${stepId} --signal recommend-approve --reason "the gate can be accepted after these edits"`);
    } else if (signal === "recommend-request-changes") {
      examples.push(`${path} --step ${stepId} --signal recommend-request-changes --reason "the user should keep this gate open and ask for changes"`);
    } else if (signal === "recommend-reject") {
      examples.push(`${path} --step ${stepId} --signal recommend-reject --reason "this plan should not proceed"`);
    } else if (signal === "recommend-rerun-from") {
      examples.push(`${path} --step ${stepId} --signal recommend-rerun-from --target-step ${defaultRerunTarget(stepId)} --reason "the changes invalidate later review and should rerun from here"`);
    } else if (signal === "answer") {
      examples.push(`${path} --step ${stepId} --signal answer --message "..."`);
    } else if (signal === "continue") {
      examples.push(`${path} --step ${stepId} --signal continue --reason "the blocker is addressed; re-evaluate and advance"`);
    }
  }
  return examples;
}

function assistStatusGuidance({ status, stepId, hasBlockedGuards }) {
  if (status === "needs_human") {
    return [
      "This is a human gate. You may inspect, edit, and test, but the runtime still owns the final transition.",
      "If your edits only clarify the same gate materials, recommend approve or request-changes. If they invalidate earlier plan or review work, recommend one rerun target."
    ];
  }
  if (status === "failed") {
    return [
      "This step already ran and failed. Use the failure summary, reviewer outputs, and logs to separate environment problems from substantive findings.",
      `When the blocker is addressed, send \`continue\` so the runtime reruns ${stepId} from the current step.`
    ];
  }
  if (status === "blocked") {
    return [
      "A guard is still missing evidence. Do not send `continue` until the missing note, ticket, judgement, or verification evidence actually exists.",
      hasBlockedGuards
        ? "Use the blocked-guard evidence above as the checklist for what must be fixed before rerunning."
        : "Inspect ui-runtime and failure artifacts to identify the missing evidence before rerunning."
    ];
  }
  if (status === "interrupted") {
    return [
      "The runtime is waiting for an explicit answer to an interruption.",
      "Answer the open question narrowly, then send `answer` so the runtime can resume with that new instruction."
    ];
  }
  return [];
}

function assistCheckpoints(stepId) {
  const checkpoints = {
    "PD-C-2": [
      "Confirm blast radius across code, tests, external surfaces, docs, and examples before closing the investigation.",
      "Record concrete findings and risks so PD-C-3 can plan without repeating the same repository walk."
    ],
    "PD-C-3": [
      "Check that the plan names concrete files, file-specific context, design decisions, tests, and real-environment verification steps.",
      "Make sure PD-C-2 concerns are addressed explicitly, not left as vague caveats."
    ],
    "PD-C-4": [
      "Verify the plan solves the ticket purpose, follows local patterns, and has a credible verification path.",
      "If the plan changed materially, prefer rerunning PD-C-3 and then PD-C-4 over forcing this review to pass."
    ],
    "PD-C-5": [
      "Before recommending implementation, confirm the plan, design decisions, test strategy, real-environment checks, and open concerns are all represented in current-note and current-ticket.",
      "If plan or ticket intent changed during the gate, prefer a rerun recommendation instead of approve."
    ],
    "PD-C-6": [
      "Keep code, tests, current-note, and current-ticket aligned with the approved plan.",
      "Do not treat failed or skipped verification as acceptable completion."
    ],
    "PD-C-7": [
      "Resolve critical and major findings with code or verification evidence, then rerun the same quality step.",
      "Do not clear a serious finding just because notes say it is fixed; verify the latest repo state."
    ],
    "PD-C-8": [
      "Look for missing outcomes, missing coverage, and reasons the ticket still should not close.",
      "If the implementation or scope must change, expect to route back through PD-C-6 or earlier review."
    ],
    "PD-C-9": [
      "Every Acceptance Criteria item needs explicit evidence in `AC 裏取り結果`.",
      "Check changed user-facing surfaces as a consumer, not only through unit-style evidence."
    ],
    "PD-C-10": [
      "Only recommend close when AC evidence, user verification guidance, and residual risks are all explicit.",
      "If code or AC evidence changed during the gate, expect a rerun recommendation instead of close."
    ]
  };
  return checkpoints[stepId] ?? [];
}

function writeSession({ stateDir, runId, stepId, sessionId, mutator }) {
  const path = assistSessionPath({ stateDir, runId, stepId });
  mkdirSync(join(path, ".."), { recursive: true });
  let session = {};
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
  if (step?.provider === "runtime" && step?.mode === "human" && Boolean(step?.human_gate)) {
    return true;
  }
  if (step?.assistEscalation) {
    return true;
  }
  return false;
}
