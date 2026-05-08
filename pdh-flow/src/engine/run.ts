// v2 engine entrypoint.
//
// Loads + validates the flow YAML, expands macros to flat-flow, compiles to
// an XState v5 machine, runs the actor to completion (or stop point), and
// returns a summary of what happened.
//
// For the prototype, the input is a fixture meta blob; the real engine will
// drive provider invocations directly.

import "dotenv/config";
import { createActor, type AnyActorRef, waitFor } from "xstate";
import { compileFlow } from "./compile-machine.ts";
import { loadFlow } from "./load-flow.ts";
import { expandFlow } from "./expand-macro.ts";
import {
  computeMachineHash,
  restoreSnapshot,
  saveSnapshot,
} from "./persist.ts";
import type { FixtureMeta } from "./actors/run-provider.ts";
import { detectJudgeConfig } from "./judge/api-judge.ts";
import {
  acquireForTicket,
  loadLeasesConfig,
  releaseForTicket,
  resolveLeaseRepo,
} from "./leases/leases.ts";
import {
  removeEnvLease,
  writeEnvLease,
} from "./leases/env-lease.ts";

export interface RunEngineOptions {
  repoPath: string;     // pdh-flow repo (where flows/ lives)
  flowId: string;       // e.g. "pdh-c-v2"
  variant: string;      // e.g. "full"
  worktreePath: string; // git repo where commits land
  runId: string;
  /** Optional fixture replay. When omitted, actors invoke real providers. */
  fixtureMeta?: FixtureMeta;
  startAtNodeId?: string;   // override the variant initial
  stopAtNodeId?: string;    // engine exits when entering this node
  /** Hard wall-clock cap; defaults to 30s for fixture, 20m for real. */
  timeoutMs?: number;
}

export interface RunEngineResult {
  finalState: string;
  stoppedAt?: string;
  context: { round: number; lastGuardianDecision?: string };
  restoredFromSnapshot: boolean;
}

export async function runEngine(
  opts: RunEngineOptions,
): Promise<RunEngineResult> {
  // Surface the judge transport so the user can confirm which path is live
  // before running ~15 LLM calls.
  const judgeCfg = detectJudgeConfig();
  if (judgeCfg) {
    process.stderr.write(
      `[engine] judge transport = ${judgeCfg.provider} (${judgeCfg.model})\n`,
    );
  } else {
    process.stderr.write(
      `[engine] judge transport = claude-cli (no API key in env; consider setting ANTHROPIC_API_KEY for deterministic structured output)\n`,
    );
  }

  const flow = loadFlow({ repoPath: opts.repoPath, flowId: opts.flowId });
  if (opts.startAtNodeId) {
    // Mutate the variant's initial node for this run only — the engine reads
    // the variant.initial when constructing the machine.
    const v = flow.variants[opts.variant];
    if (v) {
      (v as { initial: string }).initial = opts.startAtNodeId;
    }
  }
  const flat = expandFlow(flow);
  const ticketIdForContext = deriveTicketId(opts);

  // ── Auto lease acquire (F-008) ───────────────────────────────────────
  // If pdh-flow.config.yaml declares pools, acquire them at engine start so
  // flow YAMLs don't need to wire explicit acquire_lease nodes. Idempotent
  // with system_step.acquire_lease nodes (acquireForTicket reuses an
  // existing lease keyed by ticketId+pool). Released in `finally` below.
  const leaseRepo = resolveLeaseRepo(opts.worktreePath);
  const leaseConfig = loadLeasesConfig(leaseRepo);
  const leasePoolNames = Object.keys(leaseConfig.pools);
  let autoLeaseAcquired = false;
  if (leasePoolNames.length > 0) {
    try {
      const result = await acquireForTicket({
        mainRepo: leaseRepo,
        ticketId: ticketIdForContext,
        worktree: opts.worktreePath,
      });
      if (result.leases.length > 0) {
        writeEnvLease(opts.worktreePath, result.leases);
        autoLeaseAcquired = true;
        process.stderr.write(
          `[engine] auto-acquired ${result.leases.length} lease(s) ` +
            `(pools: ${result.leases.map((l) => l.pool).join(", ")}) ` +
            `for ticket ${ticketIdForContext}\n`,
        );
      }
    } catch (e) {
      // Hard fail: if config is broken or pool exhausted, the run can't
      // proceed safely. Surface the cause and abort before spawning LLMs.
      throw new Error(
        `[engine] auto-acquire lease failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  const machine = compileFlow(flat, {
    variant: opts.variant,
    worktreePath: opts.worktreePath,
    runId: opts.runId,
    ticketId: ticketIdForContext,
    fixtureMeta: opts.fixtureMeta,
    stopAtNodeId: opts.stopAtNodeId,
  });

  // ── Snapshot restore (best-effort) ───────────────────────────────────
  const machineHash = computeMachineHash(flat);
  const restore = restoreSnapshot({
    worktreePath: opts.worktreePath,
    runId: opts.runId,
    expectedMachineHash: machineHash,
  });

  let restoredFromSnapshot = false;
  let actor: AnyActorRef;
  if (restore.ok) {
    try {
      actor = createActor(machine, {
        snapshot: restore.snapshot.xstate_snapshot as never,
      });
      restoredFromSnapshot = true;
      process.stderr.write(
        `[engine] restored from snapshot (saved_at=${restore.snapshot.saved_at})\n`,
      );
    } catch (err) {
      process.stderr.write(
        `[engine] snapshot restore failed (${err instanceof Error ? err.message : String(err)}); starting fresh\n`,
      );
      actor = createActor(machine);
    }
  } else {
    const miss = restore as { ok: false; reason: string; details?: string };
    if (miss.reason !== "missing") {
      process.stderr.write(
        `[engine] snapshot ignored: ${miss.reason}${miss.details ? " (" + miss.details + ")" : ""}\n`,
      );
    }
    actor = createActor(machine);
  }

  // ── Persist snapshot on every transition + surface errors ────────────
  // ticketId is needed for the snapshot wrapper; loadFlow doesn't carry it,
  // so the engine derives it from a small heuristic (note frontmatter or
  // run-id pattern). For Phase H1 simplicity, we accept it via context-
  // derived fallback: if the runId encodes ticket info, use it; else
  // default to runId.
  const ticketIdForSnapshot = ticketIdForContext;
  let snapshotSeq = 0;

  actor.subscribe({
    next: (state: any) => {
      if (state.context?.__lastError) {
        process.stderr.write(
          `[engine] context error: ${state.context.__lastError}\n`,
        );
      }
      // Best-effort: skip persistence errors so a snapshot bug doesn't
      // abort a real run.
      try {
        saveSnapshot({
          worktreePath: opts.worktreePath,
          runId: opts.runId,
          ticketId: ticketIdForSnapshot,
          flow: opts.flowId,
          variant: opts.variant,
          machineHash,
          xstateSnapshot: actor.getPersistedSnapshot(),
        });
        snapshotSeq++;
      } catch (e) {
        process.stderr.write(
          `[engine] snapshot save failed (#${snapshotSeq}): ${e instanceof Error ? e.message : String(e)}\n`,
        );
      }
    },
    error: (err: unknown) => {
      process.stderr.write(
        `[engine] actor error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    },
  });

  actor.start();

  const timeoutMs =
    opts.timeoutMs ?? (opts.fixtureMeta ? 30_000 : 20 * 60_000);

  try {
    await waitFor(actor, (state: any) => state.status === "done", {
      timeout: timeoutMs,
    });

    const snapshot: any = actor.getSnapshot();
    actor.stop();

    return {
      finalState: typeof snapshot.value === "string"
        ? snapshot.value
        : JSON.stringify(snapshot.value),
      stoppedAt: snapshot.context?.stoppedAt,
      context: {
        round: snapshot.context?.round ?? 0,
        lastGuardianDecision: snapshot.context?.lastGuardianDecision,
      },
      restoredFromSnapshot,
    };
  } finally {
    // Auto-release if we auto-acquired. Runs on success, failure, and
    // timeout — leases must always come back to the pool. If the user
    // wired explicit release_lease nodes, those already returned the
    // leases; releaseForTicket here becomes a no-op (idempotent).
    if (autoLeaseAcquired) {
      try {
        const { released } = await releaseForTicket({
          mainRepo: leaseRepo,
          ticketId: ticketIdForContext,
        });
        removeEnvLease(opts.worktreePath);
        process.stderr.write(
          `[engine] auto-released ${released.length} lease(s) for ticket ${ticketIdForContext}\n`,
        );
      } catch (e) {
        process.stderr.write(
          `[engine] auto-release failed (lease may need manual reclaim): ${e instanceof Error ? e.message : String(e)}\n`,
        );
      }
    }
  }
}

function deriveTicketId(opts: RunEngineOptions): string {
  // Best-effort: read current-note.md frontmatter ticket_id if present.
  // Falls back to "unknown-<runId>" when the frontmatter is missing —
  // snapshot validation will flag the schema violation if the value
  // doesn't match TicketId pattern, in which case we sanitize.
  try {
    // Lazy import to avoid pulling fs at module top.
    const { existsSync, readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const path = join(opts.worktreePath, "current-note.md");
    if (existsSync(path)) {
      const text: string = readFileSync(path, "utf8");
      const m = text.match(/^---\s*[\s\S]*?ticket_id:\s*([0-9]{6}-[0-9]{6}-[a-z0-9-]+)/m);
      if (m) return m[1];
    }
  } catch {
    // ignore
  }
  // Synthesize a TicketId-shaped fallback that satisfies the schema
  // pattern. Used only when frontmatter is missing (e.g. brand-new run).
  const stamp = new Date()
    .toISOString()
    .replace(/[-T:Z.]/g, "")
    .slice(2, 14);
  return `${stamp.slice(0, 6)}-${stamp.slice(6, 12)}-engine`;
}
