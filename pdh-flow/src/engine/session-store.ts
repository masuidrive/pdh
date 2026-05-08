// Provider session persistence (ephemeral, per-run).
//
// Captures `claude --resume` / `codex exec resume` session ids so a later
// node — most prominently `<review_loop>.repair` configured with
// `via: resume_implement` (F-001), or a `request_human_input` turn loop
// (F-012) — can re-invoke the same provider conversation.
//
// Files live under `.pdh-flow/runs/<runId>/sessions/<nodeId>.json` and are
// purely engine bookkeeping: the source of truth for "did this node run"
// is the git history + frozen judgement files. Wiping `.pdh-flow/` simply
// means the next resume falls back to a fresh provider invocation.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SessionRecord {
  provider: "claude" | "codex";
  sessionId: string;
  recordedAt: string;
  nodeId: string;
  round: number;
}

function sessionPath(worktreePath: string, runId: string, nodeId: string): string {
  return join(
    worktreePath,
    ".pdh-flow",
    "runs",
    runId,
    "sessions",
    `${nodeId}.json`,
  );
}

export function saveProviderSession(opts: {
  worktreePath: string;
  runId: string;
  nodeId: string;
  round: number;
  provider: "claude" | "codex";
  sessionId: string;
}): void {
  const path = sessionPath(opts.worktreePath, opts.runId, opts.nodeId);
  mkdirSync(dirname(path), { recursive: true });
  const rec: SessionRecord = {
    provider: opts.provider,
    sessionId: opts.sessionId,
    recordedAt: new Date().toISOString(),
    nodeId: opts.nodeId,
    round: opts.round,
  };
  writeFileSync(path, JSON.stringify(rec, null, 2));
}

export function readProviderSession(opts: {
  worktreePath: string;
  runId: string;
  nodeId: string;
}): SessionRecord | null {
  const path = sessionPath(opts.worktreePath, opts.runId, opts.nodeId);
  if (!existsSync(path)) return null;
  try {
    const obj = JSON.parse(readFileSync(path, "utf8"));
    if (
      obj &&
      typeof obj === "object" &&
      typeof (obj as Record<string, unknown>).sessionId === "string" &&
      ((obj as Record<string, unknown>).provider === "claude" ||
        (obj as Record<string, unknown>).provider === "codex")
    ) {
      return obj as SessionRecord;
    }
    return null;
  } catch {
    return null;
  }
}
