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
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getValidator, SCHEMA_IDS } from "../validate.ts";
import type { GateStepOutput } from "../../types/index.ts";
import type { FixtureMeta } from "./run-provider.ts";

export interface GateActorInput {
  nodeId: string;
  round: number;
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
    const { nodeId, round, worktreePath, runId } = input;
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

    // F-011/H10-4 (Gap B): echo the decision to current-note.md so the
    // approver / comment / decided_at survive `.pdh-flow/` being wiped.
    // Single-commit-owner: this is the gate's commit.
    echoGateToNote({
      nodeId,
      round,
      worktreePath,
      decision: validated,
    });

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

function echoGateToNote(p: {
  nodeId: string;
  round: number;
  worktreePath: string;
  decision: GateStepOutput;
}): void {
  const notePath = join(p.worktreePath, "current-note.md");
  if (!existsSync(notePath)) return;
  const d = p.decision;
  const lines = [
    `## ${p.nodeId} (round ${p.round})`,
    "",
    `**Decision**: ${d.decision}`,
    `**Approver**: ${d.approver ?? "(unknown)"}`,
    `**Decided_at**: ${d.decided_at ?? ""}`,
  ];
  if (d.via) lines.push(`**Via**: ${d.via}`);
  if (d.comment) {
    lines.push("", "**Comment**:", "", d.comment);
  }
  appendFileSync(notePath, "\n" + lines.join("\n") + "\n");

  // Stage and commit. Subject mirrors provider/guardian convention:
  //   [<nodeId>/round-N] gate: <decision> by <approver>
  spawnSync("git", ["add", "-A"], { cwd: p.worktreePath });
  const subject = `[${p.nodeId}/round-${p.round}] gate: ${d.decision}` +
    (d.approver ? ` by ${d.approver}` : "");
  const r = spawnSync(
    "git",
    [
      "-c",
      "user.email=engine@pdh-flow.local",
      "-c",
      "user.name=pdh-flow-engine",
      "commit",
      "-m",
      subject,
      "--allow-empty",
    ],
    { cwd: p.worktreePath, encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(
      `await-gate: git commit failed for ${p.nodeId} echo: ${r.stderr}`,
    );
  }
}

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
