import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { loadFlow, getInitialStep, getStep } from "./flow.mjs";
import { createRedactor } from "./redaction.mjs";
import { loadCurrentNote, saveCurrentNote } from "./note-state.mjs";

export function defaultStateDir(repoPath = process.cwd()) {
  return join(repoPath, ".pdh-flowchart");
}

export function ensureCanonicalFiles(repoPath, ticket = null) {
  const notePath = join(repoPath, "current-note.md");
  if (!existsSync(notePath)) {
    saveCurrentNote(repoPath, {
      pdh: {},
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
  if (options.normalizeStaleRunning === true) {
    normalizeStaleRunningRuntime(repoPath, options);
  }
  const repo = repoPath;
  const note = loadCurrentNote(repo);
  const run = note.pdh.current_step
    ? {
        id: note.pdh.run_id,
        flow_id: note.pdh.flow,
        flow_variant: note.pdh.variant,
        ticket_id: note.pdh.ticket,
        status: note.pdh.status,
        current_step_id: note.pdh.current_step,
        repo_path: repo,
        created_at: note.pdh.started_at,
        updated_at: note.pdh.updated_at,
        completed_at: note.pdh.completed_at
      }
    : null;
  const flow = run ? loadFlow(run.flow_id) : loadFlow(note.pdh.flow ?? "pdh-ticket-core");
  return {
    repoPath: repo,
    stateDir: defaultStateDir(repo),
    note,
    run,
    flow
  };
}

export function startRun({ repoPath, ticket = null, variant = "full", flowId = "pdh-ticket-core", startStep = null }) {
  ensureCanonicalFiles(repoPath, ticket);
  const flow = loadFlow(flowId);
  const runId = createRunId();
  const now = new Date().toISOString();
  const currentStepId = startStep ?? getInitialStep(flow, variant);
  const note = loadCurrentNote(repoPath);
  saveCurrentNote(repoPath, {
    pdh: {
      ...note.pdh,
      ticket,
      flow: flowId,
      variant,
      status: "running",
      current_step: currentStepId,
      run_id: runId,
      started_at: now,
      updated_at: now,
      completed_at: null
    },
    body: note.body,
    extraFrontmatter: note.extraFrontmatter
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

export function saveRun(repoPath, run, note = null) {
  const existing = note ?? loadCurrentNote(repoPath);
  saveCurrentNote(repoPath, {
    pdh: {
      ...existing.pdh,
      ticket: run.ticket_id,
      flow: run.flow_id,
      variant: run.flow_variant,
      status: run.status,
      current_step: run.current_step_id,
      run_id: run.id,
      started_at: run.created_at,
      updated_at: run.updated_at ?? new Date().toISOString(),
      completed_at: run.completed_at
    },
    body: existing.body,
    extraFrontmatter: existing.extraFrontmatter
  });
}

export function updateRun(repoPath, fields) {
  const runtime = loadRuntime(repoPath);
  if (!runtime.run) {
    throw new Error("No active run in current-note.md");
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
  saveRun(repoPath, next, runtime.note);
  return { ...runtime, run: next, note: loadCurrentNote(repoPath) };
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

export function openHumanGate({ stateDir, runId, stepId, prompt, summary, baseline = null, rerunRequirement = null }) {
  return updateHumanGate({
    stateDir,
    runId,
    stepId,
    mutator(existingGate = null) {
      return {
        runId,
        stepId,
        status: "needs_human",
        prompt,
        summary,
        decision: existingGate?.decision ?? null,
        reason: existingGate?.reason ?? null,
        recommendation: existingGate?.recommendation ?? null,
        baseline: baseline ?? existingGate?.baseline ?? null,
        rerun_requirement: rerunRequirement,
        created_at: existingGate?.created_at ?? new Date().toISOString(),
        resolved_at: null
      };
    }
  });
}

export function resolveHumanGate({ stateDir, runId, stepId, decision, reason = null }) {
  return updateHumanGate({
    stateDir,
    runId,
    stepId,
    mutator(existing = null) {
      return {
        ...(existing ?? {
          runId,
          stepId,
          prompt: `${stepId} human gate`,
          summary: null,
          created_at: new Date().toISOString()
        }),
        status: "resolved",
        decision,
        reason,
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
  target_step_id = null,
  source = "assist"
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
          prompt: `${stepId} human gate`,
          summary: null,
          decision: null,
          reason: null,
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
          source,
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
