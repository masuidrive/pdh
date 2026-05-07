// gate_step actor — waits for a human (or fixture) decision and returns it.
//
// Two modes:
//
//   1. Fixture replay — when fixtureMeta.gate_decisions[nodeId] is present,
//      auto-respond immediately. Used by tests.
//
//   2. Real (file-poll) — looks for a gate-decision file at
//      `<worktree>/.pdh-flow/runs/<runId>/gates/<nodeId>.json`. The file
//      shape matches gate-output.schema.json. Polls until the file exists
//      or the actor is aborted.
//
// External delivery (CLI / Web UI / API) writes that file. The engine
// reads it and resolves; XState branches on `decision`.

import { fromPromise } from "xstate";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getValidator, SCHEMA_IDS } from "../validate.ts";
import type { GateStepOutput } from "../../types/index.ts";
import type { FixtureMeta } from "./run-provider.ts";

export interface GateActorInput {
  nodeId: string;
  worktreePath: string;
  runId: string;
  fixtureMeta?: FixtureMeta;
  /** Polling interval in ms when in real mode. Defaults to 1000. */
  pollIntervalMs?: number;
}

export interface GateActorOutput {
  status: "completed";
  nodeId: string;
  decision: GateStepOutput["decision"];
  approver: string;
  comment?: string;
  fromFixture: boolean;
}

export const awaitGate = fromPromise<GateActorOutput, GateActorInput>(
  async ({ input, signal }) => {
    const { nodeId, worktreePath, runId } = input;
    const fixture = (input.fixtureMeta as
      | (FixtureMeta & { gate_decisions?: Record<string, GateStepOutput> })
      | undefined)?.gate_decisions?.[nodeId];

    let output: GateStepOutput;
    let fromFixture: boolean;

    if (fixture) {
      output = fixture;
      fromFixture = true;
    } else {
      output = await pollForGateFile({
        worktreePath,
        runId,
        nodeId,
        pollIntervalMs: input.pollIntervalMs ?? 1000,
        signal,
      });
      fromFixture = false;
    }

    // Validate.
    const v = getValidator();
    const validated = v.validateOrThrow<GateStepOutput>(
      SCHEMA_IDS.gateOutput,
      output,
    );

    // Persist the decision file (if real mode it's already there; in
    // fixture mode we write it for audit symmetry).
    if (fromFixture) {
      const dir = join(worktreePath, ".pdh-flow", "runs", runId, "gates");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${nodeId}.json`),
        JSON.stringify(validated, null, 2),
      );
    }

    return {
      status: "completed",
      nodeId,
      decision: validated.decision,
      approver: validated.approver ?? "(unknown)",
      comment: validated.comment,
      fromFixture,
    };
  },
);

async function pollForGateFile(opts: {
  worktreePath: string;
  runId: string;
  nodeId: string;
  pollIntervalMs: number;
  signal?: AbortSignal;
}): Promise<GateStepOutput> {
  const path = join(
    opts.worktreePath,
    ".pdh-flow",
    "runs",
    opts.runId,
    "gates",
    `${opts.nodeId}.json`,
  );
  while (true) {
    if (opts.signal?.aborted) {
      throw new Error(`gate poll aborted for ${opts.nodeId}`);
    }
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf8")) as GateStepOutput;
    }
    await sleep(opts.pollIntervalMs, opts.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      };
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new Error("aborted"));
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
  });
}
