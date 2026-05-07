// XState snapshot persistence for the v2 engine.
//
// Saves actor.getPersistedSnapshot() to runs/<id>/snapshot.json wrapped
// with engine identity + machine_hash so a stale snapshot from a previous
// flow definition won't be re-used. On engine startup, restoreSnapshot
// tries the cached snapshot first; if missing or hash-mismatched, the
// engine falls through to a fresh start from variant.initial (which is
// rebuilt-from-canonical-state by definition because the durable state
// — current-note.md frontmatter, judgements/, git history — is the
// authoritative source per D-008).
//
// Atomicity: write to a same-directory tmp file then renameSync — POSIX
// atomic for single-filesystem moves. Single-machine assumption per
// CLAUDE.md means cross-process locking is unnecessary (one engine per
// worktree).

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getValidator, SCHEMA_IDS } from "./validate.ts";
import type { CompiledFlatFlow, EngineSnapshot } from "../types/index.ts";

const ENGINE_NAME = "pdh-flow";
const ENGINE_VERSION = "0.2.0-pre";

export interface SaveSnapshotOptions {
  worktreePath: string;
  runId: string;
  ticketId: string;
  flow: string;
  variant: string;
  machineHash: string;
  /** Whatever XState v5 actor.getPersistedSnapshot() returns. */
  xstateSnapshot: unknown;
}

/** Serialize flat-flow deterministically + hash → 16 hex chars. */
export function computeMachineHash(flat: CompiledFlatFlow): string {
  const stable = JSON.stringify(stableify(flat));
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

function stableify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableify);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      // Skip volatile fields that don't affect engine behaviour.
      if (k === "compiled_at" || k === "source_path") continue;
      out[k] = stableify(obj[k]);
    }
    return out;
  }
  return value;
}

export function snapshotPath(worktreePath: string, runId: string): string {
  return join(worktreePath, ".pdh-flow", "runs", runId, "snapshot.json");
}

export function saveSnapshot(opts: SaveSnapshotOptions): void {
  const path = snapshotPath(opts.worktreePath, opts.runId);
  mkdirSync(join(path, ".."), { recursive: true });

  const wrapped: EngineSnapshot = {
    version: 1,
    engine: {
      name: ENGINE_NAME,
      version: ENGINE_VERSION,
      machine_hash: opts.machineHash,
    },
    saved_at: new Date().toISOString(),
    run_id: opts.runId,
    ticket_id: opts.ticketId,
    flow: opts.flow,
    variant: opts.variant,
    xstate_snapshot: (opts.xstateSnapshot ?? {}) as Record<string, unknown>,
  };

  // Validate against the schema before writing — guards against engine
  // bugs that would corrupt the snapshot file.
  getValidator().validateOrThrow<EngineSnapshot>(SCHEMA_IDS.snapshot, wrapped);

  const json = JSON.stringify(wrapped, null, 2);
  const tmp = `${path}.tmp.${randomBytes(4).toString("hex")}`;
  writeFileSync(tmp, json);
  try {
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch {}
    throw err;
  }
}

export interface RestoreSnapshotResult {
  ok: true;
  snapshot: EngineSnapshot;
}
export interface RestoreSnapshotMismatch {
  ok: false;
  reason:
    | "missing"
    | "machine_hash_mismatch"
    | "schema_violation"
    | "unreadable";
  details?: string;
}

export function restoreSnapshot(opts: {
  worktreePath: string;
  runId: string;
  expectedMachineHash: string;
}): RestoreSnapshotResult | RestoreSnapshotMismatch {
  const path = snapshotPath(opts.worktreePath, opts.runId);
  if (!existsSync(path)) return { ok: false, reason: "missing" };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return {
      ok: false,
      reason: "unreadable",
      details: e instanceof Error ? e.message : String(e),
    };
  }

  const validation = getValidator().validate<EngineSnapshot>(
    SCHEMA_IDS.snapshot,
    raw,
  );
  if (validation.ok === false) {
    return {
      ok: false,
      reason: "schema_violation",
      details: validation.errors
        .map((e) => `${e.instancePath} ${e.message}`)
        .join("; "),
    };
  }

  if (validation.data.engine.machine_hash !== opts.expectedMachineHash) {
    return {
      ok: false,
      reason: "machine_hash_mismatch",
      details: `expected ${opts.expectedMachineHash}, got ${validation.data.engine.machine_hash}`,
    };
  }

  return { ok: true, snapshot: validation.data };
}

export function deleteSnapshot(worktreePath: string, runId: string): void {
  const path = snapshotPath(worktreePath, runId);
  if (existsSync(path)) {
    try { unlinkSync(path); } catch {}
  }
}
