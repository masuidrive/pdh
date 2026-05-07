// v2 engine entrypoint.
//
// Loads + validates the flow YAML, expands macros to flat-flow, compiles to
// an XState v5 machine, runs the actor to completion (or stop point), and
// returns a summary of what happened.
//
// For the prototype, the input is a fixture meta blob; the real engine will
// drive provider invocations directly.

import { createActor, type AnyActorRef, waitFor } from "xstate";
import { compileFlow } from "./compile-machine.ts";
import { loadFlow } from "./load-flow.ts";
import { expandFlow } from "./expand-macro.ts";
import type { FixtureMeta } from "./actors/run-provider.ts";

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
}

export async function runEngine(
  opts: RunEngineOptions,
): Promise<RunEngineResult> {
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
  const machine = compileFlow(flat, {
    variant: opts.variant,
    worktreePath: opts.worktreePath,
    runId: opts.runId,
    fixtureMeta: opts.fixtureMeta,
    stopAtNodeId: opts.stopAtNodeId,
  });

  const actor: AnyActorRef = createActor(machine);

  // Surface actor / invocation errors to stderr so the CLI smoke can see
  // why a transition failed (otherwise XState routes silently to __failed__).
  actor.subscribe({
    next: (state: any) => {
      // Capture .error fields from invoke results.
      if (state.context?.__lastError) {
        process.stderr.write(`[engine] context error: ${state.context.__lastError}\n`);
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
  };
}
