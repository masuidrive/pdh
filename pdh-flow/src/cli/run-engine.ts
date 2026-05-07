// `pdh-flow run-engine` — drive the v2 engine end-to-end on a worktree.
//
// Currently fixture-driven only (matches the prototype's testing path).
// Real provider invocation requires a fixture-less path that calls
// claude/codex CLI subprocess; that wiring is part of the next phase.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSubcommandArgs } from "./index.ts";
import { runEngine } from "../engine/run.ts";
import type { FixtureMeta } from "../engine/actors/run-provider.ts";

export async function cmdRunEngine(argv: string[]): Promise<void> {
  const { values } = parseSubcommandArgs(argv, {
    ticket: { type: "string" },
    flow: { type: "string" },
    variant: { type: "string" },
    repo: { type: "string" },
    worktree: { type: "string" },
    "start-at": { type: "string" },
    "stop-at": { type: "string" },
    fixture: { type: "string" },
    "run-id": { type: "string" },
  });

  const ticket = values.ticket as string | undefined;
  const flowId = values.flow as string | undefined;
  const variant = (values.variant as string | undefined) ?? "full";
  const repoPath = (values.repo as string | undefined)
    ? resolve(values.repo as string)
    : process.cwd();
  const worktreePath = (values.worktree as string | undefined)
    ? resolve(values.worktree as string)
    : repoPath;
  const fixtureDir = values.fixture as string | undefined;
  const runId =
    (values["run-id"] as string | undefined) ??
    `run-${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}-cli`;

  if (!ticket) throw new Error("--ticket <id> is required");
  if (!flowId) throw new Error("--flow <id> is required");

  let fixtureMeta: FixtureMeta | undefined;
  if (fixtureDir) {
    const path = resolve(fixtureDir, "meta.json");
    fixtureMeta = JSON.parse(readFileSync(path, "utf8"));
  }

  const result = await runEngine({
    repoPath,
    flowId,
    variant,
    worktreePath,
    runId,
    fixtureMeta,
    startAtNodeId: values["start-at"] as string | undefined,
    stopAtNodeId: values["stop-at"] as string | undefined,
  });

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        ticket,
        flow: flowId,
        variant,
        run_id: runId,
        final_state: result.finalState,
        stopped_at: result.stoppedAt ?? null,
        round: result.context.round,
        last_guardian_decision: result.context.lastGuardianDecision ?? null,
      },
      null,
      2,
    ) + "\n",
  );
}
