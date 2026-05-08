// `pdh-flow turn respond` — deliver an answer for an in-step turn question.
//
// F-012/K4. Symmetric with the existing gate-respond shape. Writes a
// `turn-NNN-answer.json` file under
// `<worktree>/.pdh-flow/runs/<runId>/turns/<nodeId>/`. The engine's
// awaitTurnAnswer poller picks it up and resumes the provider.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseSubcommandArgs } from "./index.ts";
import { writeTurnAnswer } from "../engine/turn-store.ts";
import type { TurnAnswer } from "../types/index.ts";

export async function cmdTurnRespond(argv: string[]): Promise<void> {
  const { values } = parseSubcommandArgs(argv, {
    "run-id":   { type: "string" },
    "node-id":  { type: "string" },
    worktree:   { type: "string" },
    turn:       { type: "string" },
    text:       { type: "string" },
    option:     { type: "string" },
    via:        { type: "string" },
    responder:  { type: "string" },
    list:       { type: "boolean" },
  });

  const runId = values["run-id"] as string | undefined;
  const nodeId = values["node-id"] as string | undefined;
  const worktreePath = (values.worktree as string | undefined)
    ? resolve(values.worktree as string)
    : process.cwd();
  if (!runId) throw new Error("--run-id <id> is required");
  if (!nodeId) throw new Error("--node-id <node> is required");

  const turnsDir = join(
    worktreePath,
    ".pdh-flow",
    "runs",
    runId,
    "turns",
    nodeId,
  );

  // `--list` shows pending question files. Useful when you don't know
  // the turn number off-hand.
  if (values.list) {
    listPending(turnsDir);
    return;
  }

  const turnNum = pickTurnNumber(values.turn as string | undefined, turnsDir);

  const text = values.text as string | undefined;
  if (!text) {
    throw new Error("--text \"...\" is required (free-form answer body)");
  }
  if (text.trim().length === 0) {
    throw new Error("--text must be non-empty");
  }

  const optionRaw = values.option as string | undefined;
  let selectedOption: number | undefined;
  if (optionRaw !== undefined) {
    const n = Number(optionRaw);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`--option must be a non-negative integer; got ${optionRaw}`);
    }
    selectedOption = n;
  }

  const viaRaw = (values.via as string | undefined) ?? "cli";
  if (viaRaw !== "cli" && viaRaw !== "web_ui" && viaRaw !== "assist") {
    throw new Error(`--via must be one of cli|web_ui|assist; got ${viaRaw}`);
  }

  const answer: TurnAnswer = {
    status: "completed",
    node_id: nodeId,
    round: readQuestionRound(turnsDir, turnNum) ?? 1,
    turn: turnNum,
    answered_at: new Date().toISOString(),
    answer: {
      text,
      ...(selectedOption !== undefined ? { selected_option: selectedOption } : {}),
    },
    via: viaRaw as TurnAnswer["via"],
    ...(values.responder ? { responder: values.responder as string } : {}),
  };

  const path = writeTurnAnswer({ worktreePath, runId, answer });
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        run_id: runId,
        node_id: nodeId,
        turn: turnNum,
        wrote: path,
      },
      null,
      2,
    ) + "\n",
  );
}

function listPending(turnsDir: string): void {
  if (!existsSync(turnsDir)) {
    process.stdout.write(JSON.stringify({ ok: true, pending: [] }, null, 2) + "\n");
    return;
  }
  const files = readdirSync(turnsDir);
  const pending: Array<{ turn: number; question: unknown; answered: boolean }> = [];
  for (const name of files) {
    const m = name.match(/^turn-(\d{3})-question\.json$/);
    if (!m) continue;
    const turn = parseInt(m[1], 10);
    const qPath = join(turnsDir, name);
    const aPath = join(turnsDir, name.replace("-question.", "-answer."));
    let q: unknown;
    try {
      q = JSON.parse(readFileSync(qPath, "utf8"));
    } catch {
      q = { error: "could not parse question file" };
    }
    pending.push({ turn, question: q, answered: existsSync(aPath) });
  }
  pending.sort((a, b) => a.turn - b.turn);
  process.stdout.write(
    JSON.stringify({ ok: true, pending }, null, 2) + "\n",
  );
}

function pickTurnNumber(turnArg: string | undefined, turnsDir: string): number {
  if (turnArg !== undefined) {
    const n = Number(turnArg);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`--turn must be a positive integer; got ${turnArg}`);
    }
    return n;
  }
  // Auto-pick: lowest unanswered question turn number.
  if (!existsSync(turnsDir)) {
    throw new Error(
      `no turns directory at ${turnsDir} — is the engine actually waiting on a question?`,
    );
  }
  const seqs = new Set<number>();
  const answered = new Set<number>();
  for (const name of readdirSync(turnsDir)) {
    const qm = name.match(/^turn-(\d{3})-question\.json$/);
    const am = name.match(/^turn-(\d{3})-answer\.json$/);
    if (qm) seqs.add(parseInt(qm[1], 10));
    if (am) answered.add(parseInt(am[1], 10));
  }
  const open = [...seqs].filter((n) => !answered.has(n)).sort((a, b) => a - b);
  if (open.length === 0) {
    throw new Error(
      `no unanswered question files under ${turnsDir} (use --list to inspect)`,
    );
  }
  if (open.length > 1) {
    throw new Error(
      `multiple unanswered turns ${JSON.stringify(open)}; specify --turn explicitly`,
    );
  }
  return open[0];
}

function readQuestionRound(turnsDir: string, turn: number): number | undefined {
  const seq = String(turn).padStart(3, "0");
  const qPath = join(turnsDir, `turn-${seq}-question.json`);
  if (!existsSync(qPath)) return undefined;
  try {
    const obj = JSON.parse(readFileSync(qPath, "utf8")) as Record<string, unknown>;
    const r = obj.round;
    return typeof r === "number" && Number.isInteger(r) && r >= 1 ? r : undefined;
  } catch {
    return undefined;
  }
}
