// system_step actor.
//
// Action dispatcher for deterministic runtime work. Each action is
// idempotent — re-invocation should produce the same result.
//
//   close_ticket      — write a "closed" marker; if ticket.sh exists,
//                       invoke it (best-effort). Real impl will move the
//                       ticket file from tickets/active/ → tickets/done/.
//   release_lease     — stub (lease integration lives in Phase H4)
//   cleanup_worktree  — stub (no-op success)
//   barrier           — no-op (real barrier is XState parallel.onDone)
//   noop              — no-op success

import { fromPromise } from "xstate";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  acquireForTicket,
  LeaseConfigError,
  LeaseExhaustedError,
  releaseForTicket,
} from "../leases/leases.ts";
import { writeEnvLease, removeEnvLease } from "../leases/env-lease.ts";

export interface SystemActorInput {
  nodeId: string;
  action: string;
  worktreePath: string;
  runId?: string;
  /** Required for acquire_lease / release_lease actions. */
  ticketId?: string;
  params?: Record<string, unknown>;
}

export interface SystemActorOutput {
  status: "completed" | "failed";
  nodeId: string;
  action: string;
  summary: string;
  details?: Record<string, unknown>;
}

export const runSystem = fromPromise<SystemActorOutput, SystemActorInput>(
  async ({ input }) => {
    const { nodeId, action, worktreePath } = input;
    switch (action) {
      case "close_ticket":
        return closeTicket({ nodeId, worktreePath, runId: input.runId });
      case "acquire_lease":
        return acquireLeaseAction({
          nodeId,
          worktreePath,
          ticketId: input.ticketId,
        });
      case "release_lease":
        return releaseLeaseAction({
          nodeId,
          worktreePath,
          ticketId: input.ticketId,
        });
      case "cleanup_worktree":
      case "barrier":
      case "noop":
        return {
          status: "completed",
          nodeId,
          action,
          summary: `system_step ${action} (stub)`,
        };
      default:
        throw new Error(`system_step unknown action: ${action}`);
    }
  },
);

async function acquireLeaseAction(p: {
  nodeId: string;
  worktreePath: string;
  ticketId?: string;
}): Promise<SystemActorOutput> {
  if (!p.ticketId) {
    throw new Error(
      "system_step acquire_lease requires ticketId in actor input (engine should derive from current-note frontmatter)",
    );
  }
  try {
    const result = await acquireForTicket({
      mainRepo: p.worktreePath,
      ticketId: p.ticketId,
      worktree: p.worktreePath,
    });
    if (result.leases.length > 0) {
      writeEnvLease(p.worktreePath, result.leases);
    }
    return {
      status: "completed",
      nodeId: p.nodeId,
      action: "acquire_lease",
      summary: `acquired ${result.leases.length} lease(s)`,
      details: {
        leases: result.leases.map((l) => ({
          pool: l.pool,
          kind: l.kind,
          value: l.value,
          env: l.env,
        })),
        reclaimed_count: result.reclaimed.length,
      },
    };
  } catch (e) {
    if (e instanceof LeaseConfigError || e instanceof LeaseExhaustedError) {
      return {
        status: "failed",
        nodeId: p.nodeId,
        action: "acquire_lease",
        summary: `lease acquire failed: ${e.message}`,
      };
    }
    throw e;
  }
}

async function releaseLeaseAction(p: {
  nodeId: string;
  worktreePath: string;
  ticketId?: string;
}): Promise<SystemActorOutput> {
  if (!p.ticketId) {
    throw new Error("system_step release_lease requires ticketId");
  }
  const result = await releaseForTicket({
    mainRepo: p.worktreePath,
    ticketId: p.ticketId,
  });
  removeEnvLease(p.worktreePath);
  return {
    status: "completed",
    nodeId: p.nodeId,
    action: "release_lease",
    summary: `released ${result.released.length} lease(s)`,
    details: {
      released: result.released.map((l) => ({
        pool: l.pool,
        kind: l.kind,
        value: l.value,
      })),
    },
  };
}

function closeTicket(p: {
  nodeId: string;
  worktreePath: string;
  runId?: string;
}): SystemActorOutput {
  // Minimal: write a close-marker under .pdh-flow/runs/<runId>/closed.json.
  // Real impl (deferred) would: invoke ticket.sh close (or v1 close path),
  // move tickets/active/<id>.md → tickets/done/<id>.md, run preflight.
  const dir = p.runId
    ? join(p.worktreePath, ".pdh-flow", "runs", p.runId)
    : join(p.worktreePath, ".pdh-flow");
  mkdirSync(dir, { recursive: true });
  const marker = join(dir, "closed.json");
  if (!existsSync(marker)) {
    writeFileSync(
      marker,
      JSON.stringify(
        {
          version: 1,
          closed_at: new Date().toISOString(),
          node_id: p.nodeId,
          run_id: p.runId ?? null,
        },
        null,
        2,
      ),
    );
  }
  return {
    status: "completed",
    nodeId: p.nodeId,
    action: "close_ticket",
    summary: "ticket marker written (full close logic deferred)",
    details: { marker_path: marker },
  };
}
