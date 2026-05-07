// Minimal system actor for the v2 prototype.
//
// Real flows use system_step for close_ticket, lease release, etc. The
// prototype only proves the actor wiring; each action just resolves to a
// success record. Real implementations will replace these stubs.

import { fromPromise } from "xstate";

export interface SystemActorInput {
  nodeId: string;
  action: string;
  worktreePath: string;
  params?: Record<string, unknown>;
}

export interface SystemActorOutput {
  status: "completed" | "failed";
  nodeId: string;
  action: string;
  summary: string;
}

export const runSystem = fromPromise<
  SystemActorOutput,
  SystemActorInput
>(async ({ input }) => {
  // Prototype: every action is a no-op success.
  return {
    status: "completed",
    nodeId: input.nodeId,
    action: input.action,
    summary: `system_step ${input.action} (stub)`,
  };
});
