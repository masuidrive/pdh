// F-011/H10-5: section enforce — actor → ticket section whitelist.
//
// The ticket file (`tickets/<slug>.md` via the `current-ticket.md` symlink)
// is the canonical mutable contract. Only specific actor roles are
// permitted to edit it:
//
//   - guardian aggregator (nodeId ending in `.aggregate`) → may append to
//     `# Out of scope` (H10-6)
//   - system_step close_ticket → may append to `# Resolution` and write
//     frontmatter status/closed_at (H10-2 + H10-7)
//
// Every other actor (reviewer / implementer / repair / final_verifier /
// gate / non-close system_step) MUST leave the ticket untouched. We
// detect violations by hashing the ticket file before and after the
// actor's work. The check is intentionally coarse (file-level, not
// section-level) — it guarantees no actor can stomp on the ticket
// silently. Section-level enforcement (only Out-of-scope vs only
// Resolution etc.) is layered on top via prompts + post-commit diff
// inspection in H10-6 / H10-7.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ActorIdentity {
  /** Which actor kind invoked this. */
  kind: "provider" | "guardian" | "gate" | "system";
  nodeId: string;
  /** provider role / guardian role (string from flow YAML). */
  role?: string;
  /** system_step action (only set when kind === "system"). */
  action?: string;
}

/** Returns the SHA-256 of `current-ticket.md` (resolved through the symlink), or null when the file does not exist. */
export function hashTicket(worktreePath: string): string | null {
  const path = join(worktreePath, "current-ticket.md");
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Whitelist gate: which actors may edit the ticket file at all. */
export function mayEditTicket(actor: ActorIdentity): boolean {
  if (actor.kind === "guardian" && actor.nodeId.endsWith(".aggregate")) {
    return true;
  }
  if (actor.kind === "system" && actor.action === "close_ticket") {
    return true;
  }
  return false;
}

/**
 * Throws when the ticket hash changed across the actor's work and the
 * actor is not on the whitelist. No-op when the ticket is missing,
 * unchanged, or the actor is allowed to edit it.
 */
export function assertTicketUnmodified(opts: {
  worktreePath: string;
  preHash: string | null;
  actor: ActorIdentity;
}): void {
  if (mayEditTicket(opts.actor)) return;
  const post = hashTicket(opts.worktreePath);
  if (post === null || opts.preHash === null) return;
  if (post === opts.preHash) return;
  throw new Error(
    `[ticket-guard] ${opts.actor.kind}/${opts.actor.nodeId} modified current-ticket.md without authorization. ` +
      `Only aggregator nodes (.aggregate) and close_ticket system_steps may edit the ticket. ` +
      `If this actor genuinely needs ticket-write access, extend mayEditTicket() in src/engine/ticket-guard.ts.`,
  );
}
