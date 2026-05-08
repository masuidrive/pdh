// `pdh-flow assist` — drop into the provider's interactive session at a
// pause point.
//
// F-009 v1. The simplest useful shape: read
// `runs/<runId>/sessions/<nodeId>.json`, then exec
//   `claude --resume <session_id>`  or
//   `codex resume <session_id>`
// so the user lands inside the same conversation the engine was driving.
// No special command syntax inside the session — when the user is done
// thinking, they exit normally and follow up with `pdh-flow turn-respond`
// (or whatever workflow fits) to deliver an answer back to the engine.
//
// This is a thin wrapper, not a tool; assist's job is to put the user
// in the right room, not to mediate the answer. Keeping it simple keeps
// the determinism boundary intact: the engine still only sees the
// structured turn-answer file, never the assist transcript.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseSubcommandArgs } from "./index.ts";

interface SessionRecord {
  provider: "claude" | "codex";
  sessionId: string;
  nodeId: string;
  round: number;
  recordedAt: string;
}

export async function cmdAssist(argv: string[]): Promise<void> {
  const { values } = parseSubcommandArgs(argv, {
    "run-id":  { type: "string" },
    "node-id": { type: "string" },
    worktree:  { type: "string" },
    "dry-run": { type: "boolean" },
  });
  const runId = values["run-id"] as string | undefined;
  const nodeId = values["node-id"] as string | undefined;
  const worktreePath = (values.worktree as string | undefined)
    ? resolve(values.worktree as string)
    : process.cwd();
  if (!runId) throw new Error("--run-id <id> is required");
  if (!nodeId) throw new Error("--node-id <node> is required");

  const sessionPath = join(
    worktreePath,
    ".pdh-flow",
    "runs",
    runId,
    "sessions",
    `${nodeId}.json`,
  );
  if (!existsSync(sessionPath)) {
    throw new Error(
      `no session record at ${sessionPath} — has the engine run this node yet?`,
    );
  }
  let rec: SessionRecord;
  try {
    rec = JSON.parse(readFileSync(sessionPath, "utf8"));
  } catch (e) {
    throw new Error(
      `could not parse session record at ${sessionPath}: ${(e as Error).message}`,
    );
  }
  if (
    !rec ||
    typeof rec.sessionId !== "string" ||
    (rec.provider !== "claude" && rec.provider !== "codex")
  ) {
    throw new Error(
      `session record at ${sessionPath} is malformed (missing provider/sessionId)`,
    );
  }

  const cmd = rec.provider;
  // claude uses --resume <id>; codex uses `codex resume <id>` (the
  // subcommand without `exec` is the interactive one — `codex exec` is
  // strictly non-interactive).
  const args = cmd === "claude"
    ? ["--resume", rec.sessionId]
    : ["resume", rec.sessionId];

  process.stderr.write(
    `[assist] ${cmd} session ${rec.sessionId} (node=${rec.nodeId} round=${rec.round})\n` +
    `[assist] starting interactive session — exit normally when done.\n` +
    `[assist] to deliver an answer to the engine afterwards, run:\n` +
    `         pdh-flow turn-respond --run-id ${runId} --node-id ${nodeId} --worktree ${worktreePath} --text "..."\n\n`,
  );

  if (values["dry-run"]) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          dry_run: true,
          would_exec: { cmd, args, cwd: worktreePath },
          session: rec,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const child = spawn(cmd, args, {
    cwd: worktreePath,
    stdio: "inherit",
  });
  await new Promise<void>((res, rej) => {
    child.on("error", rej);
    child.on("close", (code) => {
      if (code !== 0 && code !== null) {
        process.stderr.write(`[assist] ${cmd} exited with code ${code}\n`);
        process.exitCode = code;
      }
      res();
    });
  });
}
