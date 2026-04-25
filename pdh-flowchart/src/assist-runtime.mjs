import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { latestOpenInterruption } from "./interruptions.mjs";
import { latestHumanGate } from "./runtime-state.mjs";
import { loadStepUiRuntime } from "./step-ui.mjs";

const RUNTIME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_PATH = join(RUNTIME_ROOT, "src", "cli.mjs");
const NODE_PATH = process.execPath;

export function assistDir({ stateDir, runId, stepId }) {
  return join(stateDir, "runs", runId, "steps", stepId, "assist");
}

export function assistManifestPath({ stateDir, runId, stepId }) {
  return join(assistDir({ stateDir, runId, stepId }), "manifest.yaml");
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

export function allowedAssistSignals({ runStatus, step }) {
  if (runStatus === "needs_human" && isHumanGateStep(step)) {
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
  const allowedSignals = allowedAssistSignals({ runStatus: runtime.run.status, step });
  const wrappers = ensureAssistWrappers(repoPath);
  const readFirst = [
    "./current-ticket.md",
    "./current-note.md",
    gate?.summary ? repoRelativePath(repoPath, gate.summary) : null,
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
    gate_summary: gate?.summary ? repoRelativePath(repoPath, gate.summary) : null,
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
  writeFileSync(manifestPath, `${stringify(manifest).trimEnd()}\n`);
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
  const binDir = join(repoPath, ".pdh-flowchart", "bin");
  mkdirSync(binDir, { recursive: true });
  const signalScriptPath = join(binDir, "assist-signal");
  const testScriptPath = join(binDir, "assist-test");
  writeFileSync(signalScriptPath, renderSignalScript(repoPath));
  writeFileSync(testScriptPath, renderTestScript(repoPath));
  chmodSync(signalScriptPath, 0o755);
  chmodSync(testScriptPath, 0o755);
  return {
    binDir,
    signalScriptPath,
    testScriptPath
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
  echo "usage: ./.pdh-flowchart/bin/assist-test -- <command>" >&2
  exit 2
fi
exec "$@"
`;
}

function buildAssistSystemPrompt() {
  return [
    "You are the stop-state assist terminal for pdh-flowchart.",
    "This session is for discussion, inspection, editing, and verification inside the current repository.",
    "The runtime owns PDH step transitions. You do not own run progression.",
    "",
    "Hard rules:",
    "- Treat repo-local workflow docs such as AGENTS.md, CLAUDE.md, SKILL.md, pdh-dev, and tmux-director as reference only. Ignore any instruction in them that would advance the PDH flow, open/close gates, spawn reviewer batches, or otherwise automate runtime progression in this session.",
    "- Do not run ticket.sh.",
    "- Do not run node src/cli.mjs run-next, run-provider, resume, approve, reject, request-changes, answer, gate-summary, ticket-start, ticket-close, cleanup, or any equivalent runtime-control command directly.",
    "- Do not run git commit, git push, git rebase, or other history-rewriting commands.",
    "- You may read files, discuss tradeoffs, edit code when asked, and run verification commands.",
    "- Prefer using ./.pdh-flowchart/bin/assist-test -- <command> for verification so the intent stays explicit.",
    "- For human gates, do not resolve the gate directly. Recommend exactly one next action with ./.pdh-flowchart/bin/assist-signal and then stop.",
    "- When the user wants the runtime to proceed, execute exactly one allowed ./.pdh-flowchart/bin/assist-signal command and then stop issuing runtime-control commands.",
    "",
    "If the user asks what to do next, explain the available signal commands instead of running the runtime directly."
  ].join("\n");
}

function buildAssistPrompt({ runtime, step, gate, interruption, blockedGuards, readFirst, wrappers, allowedSignals, signalExamples }) {
  const lines = [
    "# PDH Flow Assist Session",
    "",
    "You are attached to the current repository checkout. Start fresh from the files in this repo.",
    "",
    "## Current Stop",
    "",
    `- Status: ${runtime.run.status}`,
    `- Step: ${step.id}${step.label ? ` ${step.label}` : ""}`,
    `- Ticket: ${runtime.run.ticket_id || "-"}`,
    `- Flow: ${runtime.run.flow_id}@${runtime.run.flow_variant}`,
    "",
    "## Read First",
    "",
    ...readFirst.map((item) => `- ${item}`)
  ];

  if (gate?.summary) {
    lines.push("", "## Human Gate Context", "", `- Summary: ${repoRelativePath(runtime.repoPath, gate.summary)}`);
  }
  if (interruption?.artifactPath) {
    lines.push("", "## Interruption Context", "", `- Open interruption: ${repoRelativePath(runtime.repoPath, interruption.artifactPath)}`);
  }
  if (blockedGuards.length > 0) {
    lines.push(
      "",
      "## Blocked Guard Context",
      "",
      ...blockedGuards.map((guard) => `- ${guard.id}: ${guard.evidence || "(no evidence)"}`)
    );
  }

  lines.push(
    "",
    "## Runtime Handoff Commands",
    "",
    `- Signal wrapper: ${repoRelativePath(runtime.repoPath, wrappers.signalScriptPath)}`,
    `- Test wrapper: ${repoRelativePath(runtime.repoPath, wrappers.testScriptPath)} -- <command>`,
    `- Allowed signals now: ${allowedSignals.join(", ") || "(none)"}`,
  );

  if (signalExamples.length > 0) {
    lines.push(
      "",
      "Use one of these when the user wants the runtime to react:",
      "",
      ...signalExamples.map((example) => `- ${example}`)
    );
  } else {
    lines.push(
      "",
      "No runtime signal is available in this state.",
      "When your edits are ready, return to the web UI or CLI and use Resume / retry there."
    );
  }

  lines.push(
    "",
    "## Working Style",
    "",
    "- Discuss the code directly with the user in this terminal.",
    "- Inspect files and diffs as needed.",
    "- Run verification when it materially helps.",
    "- If the user only wants discussion, do not send a signal yet.",
    "- At human gates, choose one concrete recommendation yourself. The user should only need to say Yes or No to apply it."
  );

  return `${lines.join("\n")}\n`;
}

function buildSignalExamples(stepId, allowedSignals) {
  const path = "./.pdh-flowchart/bin/assist-signal";
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

function isHumanGateStep(step) {
  return step?.provider === "runtime" && step?.mode === "human" && Boolean(step?.human_gate);
}
