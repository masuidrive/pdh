// Diagnose watchdog.
//
// Fires `pdh-flow diagnose` in the background when a run lands on a
// stuck status (blocked / failed / needs_human / interrupted). Opt-in
// via PDH_AUTO_DIAGNOSE=1 or --auto-diagnose=true. Loop suppression
// keeps us from chewing through claude calls when diagnose can't make
// progress on the same failure context.
//
// Persistence layout (under <stateDir>/runs/<runId>/diagnose/):
//   state.json   — { contextKey, attempts, lastAttemptAt, history: [...] }
// The contextKey is a hash of (status + stepId + latest attempt
// startedAt + the failed_guards list, when present). When that key
// changes (a new run-next attempt was made, or a different guard
// failed), we reset the counter.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { AnyRecord, CliOptions } from "../types.ts";

import {
  runDir,
  loadRuntime,
  latestAttemptResult,
  latestHumanGate
} from "./state.ts";

const DIAGNOSABLE_STATUSES = new Set(["blocked", "failed", "needs_human", "interrupted"]);
const DEFAULT_MAX_ATTEMPTS = 3;
const CLI_EXT = import.meta.url.endsWith(".js") ? ".js" : ".ts";
const CLI_PATH = fileURLToPath(new URL(`../cli/index${CLI_EXT}`, import.meta.url));

export function isDiagnoseWatchdogEnabled({ options = {}, env = process.env }: { options?: CliOptions; env?: NodeJS.ProcessEnv } = {}) {
  if (options["auto-diagnose"] === "true") return true;
  if (options["auto-diagnose"] === "false") return false;
  if (env.PDH_AUTO_DIAGNOSE === "1") return true;
  if (env.PDH_AUTO_DIAGNOSE === "0") return false;
  return false;
}

function diagnoseDir(stateDir, runId) {
  return join(runDir(stateDir, runId), "diagnose");
}

function statePath(stateDir, runId) {
  return join(diagnoseDir(stateDir, runId), "state.json");
}

function loadDiagnoseState({ stateDir, runId }) {
  try {
    const raw = readFileSync(statePath(stateDir, runId), "utf8");
    return JSON.parse(raw);
  } catch {
    return { contextKey: null, attempts: 0, history: [] };
  }
}

function saveDiagnoseState({ stateDir, runId, state }) {
  const target = statePath(stateDir, runId);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function deriveContextKey({ runtime, stepId }) {
  const run = runtime.run;
  const status = run?.status ?? "unknown";
  const latest = latestAttemptResult({
    stateDir: runtime.stateDir,
    runId: run.id,
    stepId
  });
  const gate = latestHumanGate({
    stateDir: runtime.stateDir,
    runId: run.id,
    stepId
  });
  const failedGuardIds = (gate?.failed_guards ?? gate?.failedGuards ?? [])
    .map((g) => (typeof g === "string" ? g : g?.guardId ?? ""))
    .sort()
    .join(",");
  const fingerprint = [
    status,
    stepId,
    latest?.attempt ?? "",
    latest?.startedAt ?? "",
    failedGuardIds
  ].join("|");
  return createHash("sha1").update(fingerprint).digest("hex").slice(0, 16);
}

export function recordDiagnoseAttempt({
  stateDir,
  runId,
  stepId,
  contextKey,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
}) {
  const state = loadDiagnoseState({ stateDir, runId });
  if (state.contextKey !== contextKey) {
    state.contextKey = contextKey;
    state.attempts = 0;
    state.history = state.history ?? [];
  }
  if (state.attempts >= maxAttempts) {
    return { allowed: false, attempts: state.attempts, maxAttempts };
  }
  state.attempts += 1;
  state.lastAttemptAt = new Date().toISOString();
  state.history = [
    ...(state.history ?? []),
    { contextKey, stepId, ts: state.lastAttemptAt }
  ].slice(-20);
  saveDiagnoseState({ stateDir, runId, state });
  return { allowed: true, attempts: state.attempts, maxAttempts };
}

export function maybeFireDiagnoseWatchdog({
  repo,
  options = {},
  env = process.env,
  log = () => {}
}: {
  repo: string;
  options?: CliOptions;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}) {
  if (!isDiagnoseWatchdogEnabled({ options, env })) return null;

  let runtime;
  try {
    runtime = loadRuntime(repo, { normalizeStaleRunning: false });
  } catch {
    return null;
  }
  const run = runtime.run;
  const stepId = run?.current_step_id;
  if (!run?.id || !stepId) return null;
  if (!DIAGNOSABLE_STATUSES.has(run.status)) return null;

  const contextKey = deriveContextKey({ runtime, stepId });
  const max = parseMaxAttempts(options, env);
  const decision = recordDiagnoseAttempt({
    stateDir: runtime.stateDir,
    runId: run.id,
    stepId,
    contextKey,
    maxAttempts: max
  });
  if (!decision.allowed) {
    log(`auto-diagnose suppressed: attempts=${decision.attempts} max=${decision.maxAttempts} contextKey=${contextKey}`);
    return { spawned: false, reason: "loop_suppressed", contextKey, attempts: decision.attempts };
  }

  const args = ["diagnose", "--repo", repo, "--step", stepId];
  if (options.model) args.push("--model", options.model);

  const child = spawn(process.execPath, [CLI_PATH, ...args], {
    cwd: repo,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: process.env
  });
  child.unref();
  log(`auto-diagnose spawned pid=${child.pid} step=${stepId} status=${run.status} contextKey=${contextKey} attempt=${decision.attempts}/${decision.maxAttempts}`);
  return {
    spawned: true,
    pid: child.pid ?? null,
    contextKey,
    attempts: decision.attempts,
    maxAttempts: decision.maxAttempts,
    stepId,
    status: run.status
  };
}

function parseMaxAttempts(options: CliOptions = {}, env: NodeJS.ProcessEnv = process.env) {
  const raw = options["auto-diagnose-max"] ?? env.PDH_AUTO_DIAGNOSE_MAX;
  if (raw === undefined || raw === null || raw === "") return DEFAULT_MAX_ATTEMPTS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_MAX_ATTEMPTS;
  return n;
}
