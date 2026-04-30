import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadFlow, getInitialStep, getStep } from "../core/flow.mjs";
import { createRedactor } from "../core/redaction.mjs";
import { stepRecoveryTag } from "./actions.mjs";
import {
  loadCurrentNote,
  saveCurrentNote,
  normalizePdh,
  serializePdh
} from "../core/note-state.mjs";

export function defaultStateDir(repoPath = process.cwd()) {
  return join(repoPath, ".pdh-flow");
}

export function runtimeMetaPath(repoPath) {
  return join(defaultStateDir(repoPath), "runtime.json");
}

export function loadPdhMeta(repoPath) {
  const path = runtimeMetaPath(repoPath);
  if (!existsSync(path)) {
    return normalizePdh({});
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) ?? {};
    return normalizePdh(data.pdh ?? data ?? {});
  } catch {
    return normalizePdh({});
  }
}

export function savePdhMeta(repoPath, pdh) {
  const path = runtimeMetaPath(repoPath);
  mkdirSync(defaultStateDir(repoPath), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ pdh: serializePdh(pdh) }, null, 2)}\n`);
  return path;
}

export function recoverRuntimeFromTags(repoPath, options = {}) {
  if (existsSync(runtimeMetaPath(repoPath))) {
    return { status: "skipped", reason: "runtime.yaml_already_exists" };
  }
  const tagResult = spawnSync(
    "git",
    [
      "for-each-ref",
      "--sort=-creatordate",
      "--format=%(refname:short)|%(objectname)|%(creatordate:iso8601-strict)",
      "refs/tags/pdh-flow/*/*"
    ],
    { cwd: repoPath, encoding: "utf8" }
  );
  if (tagResult.status !== 0) {
    return { status: "git_error", message: (tagResult.stderr || tagResult.stdout || "").trim() };
  }
  const lines = tagResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { status: "no_tags" };
  }
  const candidates = [];
  for (const line of lines) {
    const [ref, commit, createdAt] = line.split("|");
    const match = /^pdh-flow\/(.+)\/([^/]+)$/.exec(ref ?? "");
    if (!match) continue;
    candidates.push({ tag: ref, ticket: match[1], stepId: match[2], commit, createdAt: createdAt || null });
  }
  if (candidates.length === 0) {
    return { status: "no_tags" };
  }
  const preferredTicket = options.ticket || candidates[0].ticket;
  const filtered = candidates.filter((entry) => entry.ticket === preferredTicket);
  if (filtered.length === 0) {
    return { status: "no_tags_for_ticket", ticket: preferredTicket };
  }
  const latest = [...filtered].sort((a, b) => stepNumericOrder(b.stepId) - stepNumericOrder(a.stepId))[0];
  const runId = createRunId();
  const now = new Date().toISOString();
  savePdhMeta(repoPath, {
    ticket: latest.ticket,
    flow: options.flow || "pdh-ticket-core",
    variant: options.variant || "full",
    status: "running",
    current_step: latest.stepId,
    run_id: runId,
    started_at: latest.createdAt || now,
    updated_at: now,
    completed_at: null
  });
  const stateDir = defaultStateDir(repoPath);
  startRunSupervisor({ stateDir, repoPath, runId, stepId: latest.stepId, command: "recover-from-tags", pid: 0 });
  finishRunSupervisor({ stateDir, status: "stale", exitCode: null, signal: null });
  updateRunSupervisor({ stateDir, fields: { staleReason: "recovered_from_tags" } });
  mkdirSync(runDir(stateDir, runId), { recursive: true });
  appendProgressEvent({
    repoPath,
    runId,
    stepId: latest.stepId,
    type: "runtime_recovered",
    provider: "runtime",
    message: `Recovered runtime from ${stepRecoveryTag({ ticket: latest.ticket, stepId: latest.stepId })}`,
    payload: { commit: latest.commit, candidates: candidates.length }
  });
  return {
    status: "recovered",
    ticket: latest.ticket,
    stepId: latest.stepId,
    commit: latest.commit,
    runId,
    tag: latest.tag
  };
}

function stepNumericOrder(stepId) {
  const match = /^PD-[A-Z]-(\d+)$/.exec(String(stepId ?? ""));
  return match ? Number(match[1]) : -1;
}

export function ensureCanonicalFiles(repoPath, ticket = null) {
  const notePath = join(repoPath, "current-note.md");
  if (!existsSync(notePath)) {
    saveCurrentNote(repoPath, {
      body: [
        "# current-note.md",
        "",
        "## Status",
        "",
        "Idle.",
        "",
        "## Step History",
        "",
        "## Discoveries",
        "",
        "- None yet."
      ].join("\n")
    });
  }

  const ticketPath = join(repoPath, "current-ticket.md");
  if (!existsSync(ticketPath)) {
    const title = ticket ? `# ${ticket}\n` : "# current-ticket.md\n";
    writeFileSync(ticketPath, [
      title.trimEnd(),
      "",
      "## Why",
      "",
      "- TODO",
      "",
      "## What",
      "",
      "- TODO",
      "",
      "## Product AC",
      "",
      "- TODO",
      "",
      "## Implementation Notes",
      "",
      "- None yet.",
      "",
      "## Related Links",
      "",
      "- None"
    ].join("\n") + "\n");
  }
}

export function loadRuntime(repoPath, options = {}) {
  reconcileRunSupervisor({
    repoPath,
    staleAfterMs: options.staleAfterMs
  });
  if (options.normalizeStaleRunning === true) {
    normalizeStaleRunningRuntime(repoPath, options);
  }
  const repo = repoPath;
  const stateDir = defaultStateDir(repo);
  const pdh = loadPdhMeta(repo);
  const note = loadCurrentNote(repo);
  const run = pdh.current_step
    ? {
        id: pdh.run_id,
        flow_id: pdh.flow,
        flow_variant: pdh.variant,
        ticket_id: pdh.ticket,
        status: pdh.status,
        current_step_id: pdh.current_step,
        repo_path: repo,
        created_at: pdh.started_at,
        updated_at: pdh.updated_at,
        completed_at: pdh.completed_at
      }
    : null;
  const flow = run ? loadFlow(run.flow_id) : loadFlow(pdh.flow ?? "pdh-ticket-core");
  return {
    repoPath: repo,
    stateDir,
    note: { ...note, pdh },
    pdh,
    run,
    flow,
    supervisor: loadRunSupervisor({ stateDir })
  };
}

export function startRun({ repoPath, ticket = null, variant = "full", flowId = "pdh-ticket-core", startStep = null }) {
  ensureCanonicalFiles(repoPath, ticket);
  const flow = loadFlow(flowId);
  const runId = createRunId();
  const now = new Date().toISOString();
  const currentStepId = startStep ?? getInitialStep(flow, variant);
  const previous = loadPdhMeta(repoPath);
  savePdhMeta(repoPath, {
    ...previous,
    ticket,
    flow: flowId,
    variant,
    status: "running",
    current_step: currentStepId,
    run_id: runId,
    started_at: now,
    updated_at: now,
    completed_at: null
  });
  mkdirSync(runDir(defaultStateDir(repoPath), runId), { recursive: true });
  appendProgressEvent({
    repoPath,
    runId,
    stepId: currentStepId,
    type: "status",
    provider: "runtime",
    message: "run_created",
    payload: {
      flowId,
      variant,
      currentStepId,
      ticket
    }
  });
  return loadRuntime(repoPath);
}

export function saveRun(repoPath, run) {
  const existing = loadPdhMeta(repoPath);
  savePdhMeta(repoPath, {
    ...existing,
    ticket: run.ticket_id,
    flow: run.flow_id,
    variant: run.flow_variant,
    status: run.status,
    current_step: run.current_step_id,
    run_id: run.id,
    started_at: run.created_at,
    updated_at: run.updated_at ?? new Date().toISOString(),
    completed_at: run.completed_at
  });
}

export function updateRun(repoPath, fields) {
  const runtime = loadRuntime(repoPath);
  if (!runtime.run) {
    throw new Error("No active run in .pdh-flow/runtime.json");
  }
  const now = new Date().toISOString();
  const next = {
    ...runtime.run,
    ...fields,
    updated_at: fields.updated_at ?? now
  };
  if (next.status !== "completed" && fields.completed_at === undefined) {
    next.completed_at = null;
  }
  saveRun(repoPath, next);
  return loadRuntime(repoPath);
}

export function appendProgressEvent({ repoPath, runId, stepId = null, attempt = null, type, provider = "runtime", message = null, payload = null }) {
  if (!runId) {
    return null;
  }
  const path = progressPath(defaultStateDir(repoPath), runId);
  mkdirSync(join(path, ".."), { recursive: true });
  const redactor = createRedactor({ repoPath });
  const entry = {
    id: `${Date.now()}-${randomBytes(4).toString("hex")}`,
    ts: new Date().toISOString(),
    runId,
    stepId,
    attempt,
    type,
    provider,
    message,
    payload
  };
  writeFileSync(path, `${redactor(JSON.stringify(entry))}\n`, { flag: "a" });
  return entry;
}

export function readProgressEvents({ repoPath, runId, limit = 50 }) {
  if (!runId) {
    return [];
  }
  const path = progressPath(defaultStateDir(repoPath), runId);
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(-limit);
}

export function nextStepAttempt({ stateDir, runId, stepId }) {
  const stepPath = stepDir(stateDir, runId, stepId);
  if (!existsSync(stepPath)) {
    return 1;
  }
  const attempts = readdirSync(stepPath)
    .map((entry) => {
      const match = entry.match(/^attempt-(\d+)$/);
      return match ? Number(match[1]) : null;
    })
    .filter((value) => Number.isInteger(value));
  return attempts.length > 0 ? Math.max(...attempts) + 1 : 1;
}

export function writeAttemptResult({ stateDir, runId, stepId, attempt, result }) {
  const path = join(attemptDir(stateDir, runId, stepId, attempt), "result.json");
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ ...result, attempt, stepId, runId }, null, 2));
  return path;
}

export function latestAttemptResult({ stateDir, runId, stepId, provider = null }) {
  const stepPath = stepDir(stateDir, runId, stepId);
  if (!existsSync(stepPath)) {
    return null;
  }
  const attempts = readdirSync(stepPath)
    .map((entry) => {
      const match = entry.match(/^attempt-(\d+)$/);
      return match ? { attempt: Number(match[1]), path: join(stepPath, entry, "result.json") } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.attempt - a.attempt);
  for (const item of attempts) {
    if (!existsSync(item.path)) {
      continue;
    }
    const parsed = readJson(item.path);
    if (!parsed) {
      continue;
    }
    if (provider && parsed.provider !== provider) {
      continue;
    }
    return parsed;
  }
  return null;
}

export function hasCompletedProviderAttempt({ stateDir, runId, stepId, provider }) {
  const stepPath = stepDir(stateDir, runId, stepId);
  if (!existsSync(stepPath)) {
    return false;
  }
  for (const entry of readdirSync(stepPath)) {
    const resultPath = join(stepPath, entry, "result.json");
    if (!existsSync(resultPath)) {
      continue;
    }
    const result = readJson(resultPath);
    if (result?.provider === provider && result?.status === "completed") {
      return true;
    }
  }
  return false;
}

export function latestProviderSession({ stateDir, runId, stepId, provider }) {
  const result = latestAttemptResult({ stateDir, runId, stepId, provider });
  if (!result) {
    return null;
  }
  return {
    session_id: result.sessionId ?? null,
    resume_token: result.resumeToken ?? null,
    raw_log_path: result.rawLogPath ?? null,
    attempt: result.attempt ?? null
  };
}

export function latestHumanGate({ stateDir, runId, stepId }) {
  return readJson(humanGatePath(stateDir, runId, stepId));
}

export function openHumanGate({ stateDir, runId, stepId, baseline = null, rerunRequirement = null }) {
  return updateHumanGate({
    stateDir,
    runId,
    stepId,
    mutator(existingGate = null) {
      return {
        runId,
        stepId,
        status: "needs_human",
        decision: existingGate?.decision ?? null,
        recommendation: existingGate?.recommendation ?? null,
        baseline: baseline ?? existingGate?.baseline ?? null,
        rerun_requirement: rerunRequirement,
        created_at: existingGate?.created_at ?? new Date().toISOString(),
        resolved_at: null
      };
    }
  });
}

export function resolveHumanGate({ stateDir, runId, stepId, decision }) {
  return updateHumanGate({
    stateDir,
    runId,
    stepId,
    mutator(existing = null) {
      return {
        ...(existing ?? {
          runId,
          stepId,
          created_at: new Date().toISOString()
        }),
        status: "resolved",
        decision,
        baseline: existing?.baseline ?? null,
        rerun_requirement: existing?.rerun_requirement ?? null,
        resolved_at: new Date().toISOString(),
        recommendation: existing?.recommendation
          ? {
              ...existing.recommendation,
              status: "accepted",
              responded_at: new Date().toISOString()
            }
          : null
      };
    }
  });
}

export function updateHumanGateRecommendation({
  stateDir,
  runId,
  stepId,
  action,
  reason = null,
  target_step_id = null
}) {
  return updateHumanGate({
    stateDir,
    runId,
    stepId,
    mutator(existing = null) {
      return {
        ...(existing ?? {
          runId,
          stepId,
          status: "needs_human",
          decision: null,
          created_at: new Date().toISOString(),
          resolved_at: null
        }),
        status: "needs_human",
        baseline: existing?.baseline ?? null,
        rerun_requirement: existing?.rerun_requirement ?? null,
        recommendation: {
          id: `gate-rec-${Date.now()}-${randomBytes(3).toString("hex")}`,
          action,
          reason,
          target_step_id,
          status: "pending",
          updated_at: new Date().toISOString()
        }
      };
    }
  });
}

export function clearHumanGateRecommendation({ stateDir, runId, stepId }) {
  return updateHumanGate({
    stateDir,
    runId,
    stepId,
    mutator(existing = null) {
      if (!existing) {
        return null;
      }
      return {
        ...existing,
        baseline: existing.baseline ?? null,
        rerun_requirement: existing.rerun_requirement ?? null,
        recommendation: null
      };
    }
  });
}

export function resetStepArtifacts({ stateDir, runId, stepId }) {
  rmSync(stepDir(stateDir, runId, stepId), { recursive: true, force: true });
  clearTrackedProcesses({ stateDir, runId, stepId });
}

export function cleanupRunArtifacts({ repoPath, runId }) {
  if (!runId) {
    return null;
  }
  const path = runDir(defaultStateDir(repoPath), runId);
  rmSync(path, { recursive: true, force: true });
  return path;
}

export function collectStepArtifacts({ stateDir, runId, stepId }) {
  const dir = stepDir(stateDir, runId, stepId);
  if (!existsSync(dir)) {
    return [];
  }
  const artifacts = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    artifacts.push({ name: entry, path: fullPath });
  }
  return artifacts.sort((a, b) => a.name.localeCompare(b.name));
}

export function currentRunSummary(repoPath) {
  const runtime = loadRuntime(repoPath);
  return {
    repoPath,
    stateDir: runtime.stateDir,
    run: runtime.run,
    flow: runtime.flow,
    note: runtime.note,
    events: runtime.run ? readProgressEvents({ repoPath, runId: runtime.run.id, limit: 120 }) : []
  };
}

export function progressPath(stateDir, runId) {
  return join(runDir(stateDir, runId), "progress.jsonl");
}

export function processRegistryPath(stateDir, runId) {
  return join(runDir(stateDir, runId), "process-registry.json");
}

export function runtimeSupervisorPath(stateDir) {
  return join(stateDir, "runtime-supervisor.json");
}

export function loadRunSupervisor({ stateDir }) {
  const supervisor = readJson(runtimeSupervisorPath(stateDir));
  if (!supervisor || typeof supervisor !== "object") {
    return null;
  }
  return {
    command: supervisor.command ?? null,
    repoPath: supervisor.repoPath ?? null,
    runId: supervisor.runId ?? null,
    stepId: supervisor.stepId ?? null,
    pid: supervisor.pid ?? null,
    status: supervisor.status ?? null,
    startedAt: supervisor.startedAt ?? null,
    finishedAt: supervisor.finishedAt ?? null,
    exitCode: supervisor.exitCode ?? null,
    signal: supervisor.signal ?? null,
    staleReason: supervisor.staleReason ?? null
  };
}

export function startRunSupervisor({ stateDir, repoPath, runId = null, stepId = null, command, pid }) {
  const next = {
    command,
    repoPath,
    runId,
    stepId,
    pid,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    signal: null,
    staleReason: null
  };
  writeJson(runtimeSupervisorPath(stateDir), next);
  return next;
}

export function updateRunSupervisor({ stateDir, fields = {} }) {
  const current = loadRunSupervisor({ stateDir });
  if (!current) {
    return null;
  }
  const next = {
    ...current,
    ...fields
  };
  writeJson(runtimeSupervisorPath(stateDir), next);
  return next;
}

export function finishRunSupervisor({ stateDir, status = "exited", exitCode = null, signal = null }) {
  const current = loadRunSupervisor({ stateDir });
  if (!current) {
    return null;
  }
  const next = {
    ...current,
    status,
    finishedAt: new Date().toISOString(),
    exitCode,
    signal
  };
  writeJson(runtimeSupervisorPath(stateDir), next);
  return next;
}

export function reconcileRunSupervisor({ repoPath, staleAfterMs = 15000 }) {
  const stateDir = defaultStateDir(repoPath);
  const current = loadRunSupervisor({ stateDir });
  if (!current || current.status !== "running") {
    return current;
  }
  const pid = Number(current.pid);
  if (Number.isInteger(pid) && pid > 0 && pidIsAlive(pid)) {
    return current;
  }
  const referenceIso = current.startedAt ?? null;
  const referenceMs = referenceIso ? Date.parse(referenceIso) : NaN;
  if (Number.isFinite(referenceMs) && Date.now() - referenceMs < staleAfterMs) {
    return current;
  }
  const next = {
    ...current,
    status: "stale",
    finishedAt: new Date().toISOString(),
    staleReason: current.staleReason || "top-level runtime process is no longer alive"
  };
  writeJson(runtimeSupervisorPath(stateDir), next);
  return next;
}

export function loadProcessRegistry({ stateDir, runId }) {
  const registry = readJson(processRegistryPath(stateDir, runId));
  if (!registry || !Array.isArray(registry.entries)) {
    return {
      runId,
      updated_at: null,
      entries: []
    };
  }
  return {
    runId,
    updated_at: registry.updated_at ?? null,
    entries: registry.entries.filter((entry) => entry && typeof entry === "object")
  };
}

export function listTrackedProcesses({ stateDir, runId, stepId = null }) {
  const registry = loadProcessRegistry({ stateDir, runId });
  const entries = registry.entries.map((entry) => ({
    id: entry.id ?? null,
    kind: entry.kind ?? null,
    stepId: entry.stepId ?? null,
    attempt: entry.attempt ?? null,
    round: entry.round ?? null,
    reviewerId: entry.reviewerId ?? null,
    provider: entry.provider ?? null,
    label: entry.label ?? null,
    pid: entry.pid ?? null,
    status: entry.status ?? null,
    startedAt: entry.startedAt ?? null,
    finishedAt: entry.finishedAt ?? null,
    exitCode: entry.exitCode ?? null
  }));
  return stepId ? entries.filter((entry) => entry.stepId === stepId) : entries;
}

export function registerTrackedProcess({ stateDir, runId, entry }) {
  const registry = loadProcessRegistry({ stateDir, runId });
  const id = String(entry?.id ?? "").trim();
  if (!id) {
    throw new Error("Tracked process entry id is required");
  }
  const nextEntry = {
    id,
    kind: entry.kind ?? null,
    stepId: entry.stepId ?? null,
    attempt: entry.attempt ?? null,
    round: entry.round ?? null,
    reviewerId: entry.reviewerId ?? null,
    provider: entry.provider ?? null,
    label: entry.label ?? null,
    pid: entry.pid ?? null,
    status: entry.status ?? "running",
    startedAt: entry.startedAt ?? new Date().toISOString(),
    finishedAt: entry.finishedAt ?? null,
    exitCode: entry.exitCode ?? null
  };
  const entries = registry.entries.filter((item) => item?.id !== id);
  entries.push(nextEntry);
  writeJson(processRegistryPath(stateDir, runId), {
    runId,
    updated_at: new Date().toISOString(),
    entries
  });
  return nextEntry;
}

export function finishTrackedProcess({ stateDir, runId, entryId, status, pid = null, finishedAt = null, exitCode = null }) {
  const registry = loadProcessRegistry({ stateDir, runId });
  const id = String(entryId ?? "").trim();
  if (!id) {
    return null;
  }
  const entries = registry.entries.map((entry) => {
    if (entry?.id !== id) {
      return entry;
    }
    return {
      ...entry,
      status,
      pid: pid ?? entry.pid ?? null,
      finishedAt: finishedAt ?? new Date().toISOString(),
      exitCode: exitCode ?? entry.exitCode ?? null
    };
  });
  writeJson(processRegistryPath(stateDir, runId), {
    runId,
    updated_at: new Date().toISOString(),
    entries
  });
  return entries.find((entry) => entry?.id === id) ?? null;
}

export function clearTrackedProcesses({ stateDir, runId, stepId = null }) {
  const path = processRegistryPath(stateDir, runId);
  if (!existsSync(path)) {
    return null;
  }
  if (!stepId) {
    rmSync(path, { force: true });
    return path;
  }
  const registry = loadProcessRegistry({ stateDir, runId });
  const entries = registry.entries.filter((entry) => entry?.stepId !== stepId);
  writeJson(path, {
    runId,
    updated_at: new Date().toISOString(),
    entries
  });
  return path;
}

export function runDir(stateDir, runId) {
  return join(stateDir, "runs", runId);
}

export function stepDir(stateDir, runId, stepId) {
  return join(runDir(stateDir, runId), "steps", stepId);
}

export function attemptDir(stateDir, runId, stepId, attempt) {
  return join(stepDir(stateDir, runId, stepId), `attempt-${attempt}`);
}

function humanGatePath(stateDir, runId, stepId) {
  return join(stepDir(stateDir, runId, stepId), "human-gate.json");
}

function updateHumanGate({ stateDir, runId, stepId, mutator }) {
  const next = mutator(latestHumanGate({ stateDir, runId, stepId }));
  if (!next) {
    return null;
  }
  writeJson(humanGatePath(stateDir, runId, stepId), next);
  return next;
}

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function readJson(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function normalizeStaleRunningRuntime(repoPath, options = {}) {
  const staleAfterMs = Number.isFinite(Number(options.staleAfterMs)) ? Number(options.staleAfterMs) : 15000;
  const runtime = loadRuntime(repoPath);
  const run = runtime.run;
  if (!run?.id || run.status !== "running" || !run.current_step_id) {
    return runtime;
  }
  const supervisor = reconcileRunSupervisor({ repoPath, staleAfterMs });
  const supervisorPid = Number(supervisor?.pid);
  if (supervisor?.status === "running" && Number.isInteger(supervisorPid) && supervisorPid > 0 && pidIsAlive(supervisorPid)) {
    return runtime;
  }
  const step = getStep(runtime.flow, run.current_step_id);
  if (!step) {
    return runtime;
  }
  const latestAttempt = latestAttemptResult({
    stateDir: runtime.stateDir,
    runId: run.id,
    stepId: step.id,
    provider: step.mode === "review" ? null : step.provider
  });
  if (!latestAttempt || latestAttempt.status !== "running") {
    if (supervisor?.status === "stale") {
      const reason = `${step.id} stayed running after ${supervisor.command || "runtime"} exited.`;
      updateRun(repoPath, {
        status: "failed",
        current_step_id: step.id
      });
      appendProgressEvent({
        repoPath,
        runId: run.id,
        stepId: step.id,
        type: "runtime_stale",
        provider: "runtime",
        message: `${step.id} stale running normalized to failed`,
        payload: {
          reason,
          staleAfterMs
        }
      });
      return loadRuntime(repoPath);
    }
    return runtime;
  }
  const finishedEvent = latestFinishedStepEvent({
    repoPath,
    runId: run.id,
    stepId: step.id,
    attempt: latestAttempt.attempt
  });
  const finishedStatus = statusFromStepFinishedEvent(finishedEvent);
  if (finishedStatus) {
    writeAttemptResult({
      stateDir: runtime.stateDir,
      runId: run.id,
      stepId: step.id,
      attempt: latestAttempt.attempt,
      result: {
        ...latestAttempt,
        status: finishedStatus,
        finalMessage: latestAttempt.finalMessage || finishedEvent.payload?.finalMessage || latestAttempt.stderr || null,
        stderr: latestAttempt.stderr || "",
        finishedAt: finishedEvent.ts || new Date().toISOString(),
        lastEventAt: finishedEvent.ts || latestAttempt.lastEventAt || latestAttempt.startedAt || null
      }
    });
    if (finishedStatus !== "completed") {
      updateRun(repoPath, {
        status: finishedStatus,
        current_step_id: step.id
      });
    }
    return loadRuntime(repoPath);
  }
  const activeProcesses = listTrackedProcesses({ stateDir: runtime.stateDir, runId: run.id, stepId: step.id })
    .filter((entry) => entry.status === "running" && Number.isInteger(Number(entry.pid)) && pidIsAlive(Number(entry.pid)));
  if (activeProcesses.length > 0) {
    return runtime;
  }
  const referenceIso = latestAttempt.lastEventAt ?? latestAttempt.startedAt ?? run.updated_at ?? run.created_at ?? null;
  const referenceMs = referenceIso ? Date.parse(referenceIso) : NaN;
  if (Number.isFinite(referenceMs) && Date.now() - referenceMs < staleAfterMs) {
    return runtime;
  }
  const staleEntries = listTrackedProcesses({ stateDir: runtime.stateDir, runId: run.id, stepId: step.id })
    .filter((entry) => entry.status === "running");
  const detail = staleEntries.length > 0
    ? staleEntries.slice(0, 3).map((entry) => entry.label || entry.kind || "process").join(", ")
    : "no active tracked processes";
  const reason = `${step.id} stayed running without a live process (${detail}).`;
  writeAttemptResult({
    stateDir: runtime.stateDir,
    runId: run.id,
    stepId: step.id,
    attempt: latestAttempt.attempt,
    result: {
      ...latestAttempt,
      status: "failed",
      finalMessage: reason,
      stderr: latestAttempt.stderr || reason,
      finishedAt: new Date().toISOString()
    }
  });
  updateRun(repoPath, {
    status: "failed",
    current_step_id: step.id
  });
  appendProgressEvent({
    repoPath,
    runId: run.id,
    stepId: step.id,
    attempt: latestAttempt.attempt ?? null,
    type: "runtime_stale",
    provider: "runtime",
    message: `${step.id} stale running normalized to failed`,
    payload: {
      reason,
      staleAfterMs
    }
  });
  return loadRuntime(repoPath);
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `run-${stamp}-${randomBytes(3).toString("hex")}`;
}

function latestFinishedStepEvent({ repoPath, runId, stepId, attempt }) {
  const events = readProgressEvents({ repoPath, runId, limit: 200 });
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.stepId !== stepId || event?.type !== "step_finished") {
      continue;
    }
    if (attempt !== undefined && event.attempt !== null && event.attempt !== undefined && Number(event.attempt) !== Number(attempt)) {
      continue;
    }
    return event;
  }
  return null;
}

function statusFromStepFinishedEvent(event) {
  const message = String(event?.message ?? "");
  const match = message.match(/\s(completed|failed|blocked)$/);
  return match?.[1] ?? null;
}
