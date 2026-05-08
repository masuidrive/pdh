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
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
        return closeTicket({
          nodeId,
          worktreePath,
          runId: input.runId,
          ticketId: input.ticketId,
        });
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
  ticketId?: string;
}): SystemActorOutput {
  // F-011/H10-2: durable close lives in ticket + note frontmatter, not
  // in `.pdh-flow/runs/<runId>/closed.json`. The .pdh-flow tree is now
  // ephemeral — wiping it must not lose the "this ticket is closed" fact.
  const closedAt = new Date().toISOString();
  const updated: string[] = [];

  if (p.ticketId) {
    const ticketPath = join(p.worktreePath, "tickets", `${p.ticketId}.md`);
    if (
      mergeFrontmatter(ticketPath, { status: "done", closed_at: closedAt })
    ) {
      updated.push(`tickets/${p.ticketId}.md`);
    }
    const notePath = join(
      p.worktreePath,
      "tickets",
      `${p.ticketId}-note.md`,
    );
    if (
      mergeFrontmatter(notePath, {
        status: "completed",
        completed_at: closedAt,
      })
    ) {
      updated.push(`tickets/${p.ticketId}-note.md`);
    }

    // F-011/H10-7 (Gap C): append `# Resolution` to the ticket so a
    // future reader gets the ticket-level outcome (status, who closed,
    // when, and a pointer to known limitations) without diving into
    // the note prose. Best-effort — gate decisions live in
    // `.pdh-flow/runs/<runId>/gates/` while the run is in-flight.
    if (existsSync(ticketPath)) {
      const closeApprover = p.runId
        ? readGateApprover(p.worktreePath, p.runId, "close_gate")
        : null;
      const hasOutOfScope = readFileSync(ticketPath, "utf8").includes(
        "# Out of scope",
      );
      const lines: string[] = [];
      if (!readFileSync(ticketPath, "utf8").includes("# Resolution")) {
        lines.push("", "# Resolution", "");
      } else {
        lines.push("");
      }
      lines.push(`- **Status**: closed`);
      lines.push(`- **Closed_at**: ${closedAt}`);
      if (closeApprover) {
        lines.push(`- **Approved_by**: ${closeApprover}`);
      }
      if (p.runId) {
        lines.push(`- **Run_id**: ${p.runId}`);
      }
      if (hasOutOfScope) {
        lines.push(
          "- **Known limitations**: see `# Out of scope` section above.",
        );
      }
      lines.push(
        "- **Follow-ups**: see `tickets/` for any new tickets opened to address deferred items.",
      );
      appendFileSync(ticketPath, lines.join("\n") + "\n");
      updated.push(`tickets/${p.ticketId}.md (Resolution)`);
    }
  }

  return {
    status: "completed",
    nodeId: p.nodeId,
    action: "close_ticket",
    summary: `ticket closed (${updated.length} edit(s))`,
    details: {
      closed_at: closedAt,
      ticket_id: p.ticketId ?? null,
      updated,
    },
  };
}

function readGateApprover(
  worktreePath: string,
  runId: string,
  gateNodeId: string,
): string | null {
  const path = join(
    worktreePath,
    ".pdh-flow",
    "runs",
    runId,
    "gates",
    `${gateNodeId}.json`,
  );
  if (!existsSync(path)) return null;
  try {
    const obj = JSON.parse(readFileSync(path, "utf8"));
    return typeof obj.approver === "string" && obj.approver.trim().length > 0
      ? obj.approver.trim()
      : null;
  } catch {
    return null;
  }
}

// Merge `updates` into the YAML frontmatter of `path`. Existing keys are
// replaced in place; missing keys are appended at the end of the
// frontmatter block. Returns true on success, false if the file does not
// exist or has no frontmatter block.
function mergeFrontmatter(
  path: string,
  updates: Record<string, string>,
): boolean {
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf8");
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return false;
  let fm = m[1];
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}:.*$`, "m");
    const line = `${key}: ${value}`;
    if (re.test(fm)) {
      fm = fm.replace(re, line);
    } else {
      fm = fm.replace(/\s*$/, "") + `\n${line}`;
    }
  }
  const rest = content.slice(m[0].length);
  writeFileSync(path, `---\n${fm}\n---\n${rest}`);
  return true;
}
