// In-step turn persistence (F-012).
//
// `provider_step` runs with `enable_user_input: true` can interleave 1+
// `request_human_input` turns between the initial provider call and the
// final answer. Each turn round-trips through these files:
//
//   .pdh-flow/runs/<runId>/turns/<nodeId>/turn-NNN-question.json   (engine writes)
//   .pdh-flow/runs/<runId>/turns/<nodeId>/turn-NNN-answer.json     (responder writes)
//
// Files are ephemeral in the same sense as the rest of `.pdh-flow/`:
// the durable record of "this step asked these questions" lives in the
// note section the step ultimately commits. Cleanup at the end of the
// step is the engine's responsibility (best-effort).
//
// The polling shape mirrors `await-gate.ts` so the await semantics stay
// uniform across gates and turns.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getValidator, SCHEMA_IDS, SchemaViolation } from "./validate.ts";
import type {
  TurnAnswer,
  TurnQuestion,
} from "../types/index.ts";

function turnsDir(worktreePath: string, runId: string, nodeId: string): string {
  return join(worktreePath, ".pdh-flow", "runs", runId, "turns", nodeId);
}

function questionPath(
  worktreePath: string,
  runId: string,
  nodeId: string,
  turn: number,
): string {
  const seq = String(turn).padStart(3, "0");
  return join(turnsDir(worktreePath, runId, nodeId), `turn-${seq}-question.json`);
}

function answerPath(
  worktreePath: string,
  runId: string,
  nodeId: string,
  turn: number,
): string {
  const seq = String(turn).padStart(3, "0");
  return join(turnsDir(worktreePath, runId, nodeId), `turn-${seq}-answer.json`);
}

/** Persist a question file, validated against turn-question.schema.json. */
export function writeTurnQuestion(opts: {
  worktreePath: string;
  runId: string;
  question: TurnQuestion;
}): string {
  const v = getValidator();
  const r = v.validate<TurnQuestion>(SCHEMA_IDS.turnQuestion, opts.question);
  if (r.ok === false) throw new SchemaViolation(SCHEMA_IDS.turnQuestion, r.errors);
  const path = questionPath(
    opts.worktreePath,
    opts.runId,
    opts.question.node_id,
    opts.question.turn,
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(opts.question, null, 2) + "\n");
  return path;
}

/** Read + validate an answer file. Returns null when not yet present. */
export function readTurnAnswer(opts: {
  worktreePath: string;
  runId: string;
  nodeId: string;
  turn: number;
}): TurnAnswer | null {
  const path = answerPath(
    opts.worktreePath,
    opts.runId,
    opts.nodeId,
    opts.turn,
  );
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `[turn-store] corrupt answer file at ${path}: ${(e as Error).message}`,
    );
  }
  const v = getValidator();
  const r = v.validate<TurnAnswer>(SCHEMA_IDS.turnAnswer, obj);
  if (r.ok === false) throw new SchemaViolation(SCHEMA_IDS.turnAnswer, r.errors);
  return r.data;
}

/** Persist an answer file (used by CLI / Web UI / fixture replay). */
export function writeTurnAnswer(opts: {
  worktreePath: string;
  runId: string;
  answer: TurnAnswer;
}): string {
  const v = getValidator();
  const r = v.validate<TurnAnswer>(SCHEMA_IDS.turnAnswer, opts.answer);
  if (r.ok === false) throw new SchemaViolation(SCHEMA_IDS.turnAnswer, r.errors);
  const path = answerPath(
    opts.worktreePath,
    opts.runId,
    opts.answer.node_id,
    opts.answer.turn,
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(opts.answer, null, 2) + "\n");
  return path;
}

export interface AwaitTurnAnswerOptions {
  worktreePath: string;
  runId: string;
  nodeId: string;
  turn: number;
  /** Polling interval in ms. Default 1000. */
  pollIntervalMs?: number;
  /** Hard timeout in ms. Default 1 hour. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Poll for the answer file. Returns the validated TurnAnswer, or throws. */
export async function awaitTurnAnswer(
  opts: AwaitTurnAnswerOptions,
): Promise<TurnAnswer> {
  const interval = opts.pollIntervalMs ?? 1000;
  const timeout = opts.timeoutMs ?? 60 * 60 * 1000;
  const start = Date.now();
  while (true) {
    if (opts.signal?.aborted) {
      throw new Error(
        `[turn-store] awaitTurnAnswer aborted for ${opts.nodeId} turn=${opts.turn}`,
      );
    }
    const ans = readTurnAnswer({
      worktreePath: opts.worktreePath,
      runId: opts.runId,
      nodeId: opts.nodeId,
      turn: opts.turn,
    });
    if (ans) return ans;
    if (Date.now() - start > timeout) {
      throw new Error(
        `[turn-store] timed out waiting for answer at ${answerPath(
          opts.worktreePath,
          opts.runId,
          opts.nodeId,
          opts.turn,
        )} (${timeout}ms)`,
      );
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Clean up the per-step turns directory after the step completes. */
export function clearTurnsDir(opts: {
  worktreePath: string;
  runId: string;
  nodeId: string;
}): void {
  const dir = turnsDir(opts.worktreePath, opts.runId, opts.nodeId);
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup; ephemeral state will be wiped with .pdh-flow/ anyway
  }
}

/** List existing turn numbers under a node's turns dir (e.g. for resume). */
export function listExistingTurns(opts: {
  worktreePath: string;
  runId: string;
  nodeId: string;
}): number[] {
  const dir = turnsDir(opts.worktreePath, opts.runId, opts.nodeId);
  if (!existsSync(dir)) return [];
  const seqs = new Set<number>();
  for (const name of readdirSync(dir)) {
    const m = name.match(/^turn-(\d{3})-(question|answer)\.json$/);
    if (m) seqs.add(parseInt(m[1], 10));
  }
  return [...seqs].sort((a, b) => a - b);
}
