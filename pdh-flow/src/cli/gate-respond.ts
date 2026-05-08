// `pdh-flow gate-respond` — write a gate decision file from the CLI.
//
// Symmetric with the existing turn-respond shape. Writes
// `<worktree>/.pdh-flow/runs/<runId>/gates/<nodeId>.json` validated
// against gate-output.schema.json. The engine's await-gate poller
// picks it up within ~1 s and routes the flow according to the
// gate node's `outputs` map.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseSubcommandArgs } from "./index.ts";
import {
  getValidator,
  SCHEMA_IDS,
  SchemaViolation,
} from "../engine/validate.ts";

export async function cmdGateRespond(argv: string[]): Promise<void> {
  const { values } = parseSubcommandArgs(argv, {
    "run-id":  { type: "string" },
    "node-id": { type: "string" },
    worktree:  { type: "string" },
    decision:  { type: "string" },
    approver:  { type: "string" },
    comment:   { type: "string" },
    via:       { type: "string" },
  });

  const runId = values["run-id"] as string | undefined;
  const nodeId = values["node-id"] as string | undefined;
  const worktreePath = (values.worktree as string | undefined)
    ? resolve(values.worktree as string)
    : process.cwd();
  if (!runId) throw new Error("--run-id <id> is required");
  if (!nodeId) throw new Error("--node-id <node> is required");

  const decision = values.decision as string | undefined;
  if (!decision || !["approved", "rejected", "cancelled"].includes(decision)) {
    throw new Error(`--decision must be one of approved|rejected|cancelled; got ${decision ?? "(none)"}`);
  }

  const viaRaw = (values.via as string | undefined) ?? "cli";
  if (viaRaw !== "cli" && viaRaw !== "web_ui" && viaRaw !== "api" && viaRaw !== "assist") {
    throw new Error(`--via must be one of cli|web_ui|api|assist; got ${viaRaw}`);
  }

  const approver = ((values.approver as string | undefined) ?? "").trim() || "cli-user";
  const comment = (values.comment as string | undefined)?.trim();

  const decided: Record<string, unknown> = {
    status: "completed",
    node_id: nodeId,
    decision,
    approver,
    decided_at: new Date().toISOString(),
    via: viaRaw,
  };
  if (comment) decided.comment = comment;

  const v = getValidator();
  const r = v.validate(SCHEMA_IDS.gateOutput, decided);
  if (r.ok === false) {
    throw new SchemaViolation(SCHEMA_IDS.gateOutput, r.errors);
  }

  const dir = join(worktreePath, ".pdh-flow", "runs", runId, "gates");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${nodeId}.json`);
  if (existsSync(path)) {
    const existing = JSON.parse(readFileSync(path, "utf8"));
    process.stderr.write(
      `gate already decided at ${path} — refusing to overwrite\n`,
    );
    process.stdout.write(
      JSON.stringify({ ok: false, error: "already_decided", existing }, null, 2) + "\n",
    );
    process.exitCode = 2;
    return;
  }
  writeFileSync(path, JSON.stringify(decided, null, 2) + "\n");
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        run_id: runId,
        node_id: nodeId,
        decision,
        wrote: path,
      },
      null,
      2,
    ) + "\n",
  );
  // Sentinel: lets the assist-terminal backend trigger a "close modal?"
  // prompt on the attached browser tab.
  process.stdout.write("[pdh-flow:submitted:gate]\n");
}
