// Minimal HTTP server for the v2 Web UI MVP.
//
// Reads engine state from `<worktreePath>/.pdh-flow/runs/<runId>/` (snapshot
// + frozen judgements + gate decisions) and exposes:
//
//   GET  /api/runs                     → list runs (run-id + saved_at + ticket)
//   GET  /api/runs/:runId              → snapshot summary + judgement list +
//                                         active-gate hint
//   GET  /api/runs/:runId/note         → raw current-note.md
//   POST /api/runs/:runId/gates/:node  → write gate decision file (the
//                                         engine's await-gate actor polls this)
//   GET  /                             → static frontend (web/index.html etc.)
//
// No external deps. Polling-driven on the frontend; no SSE/WebSocket.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getValidator, SCHEMA_IDS, formatErrors } from "../engine/validate.ts";

export interface ServeOptions {
  worktreePath: string;
  port: number;
  /** Path to static frontend assets. Defaults to ../../web relative to this file. */
  staticDir?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_STATIC_DIR = resolve(__dirname, "..", "..", "web");

export function startWebServer(opts: ServeOptions): Server {
  const staticDir = opts.staticDir ?? DEFAULT_STATIC_DIR;
  const server = createServer((req, res) => {
    handleRequest(req, res, { ...opts, staticDir }).catch((err) => {
      process.stderr.write(`[web] handler error: ${err instanceof Error ? err.message : String(err)}\n`);
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });
  server.listen(opts.port, () => {
    process.stderr.write(
      `[web] listening on http://localhost:${opts.port} (worktree=${opts.worktreePath})\n`,
    );
  });
  return server;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: Required<Pick<ServeOptions, "worktreePath" | "port" | "staticDir">>,
): Promise<void> {
  const path = (req.url ?? "/").split("?")[0];

  // ── API ───────────────────────────────────────────────────────────────
  if (path === "/api/runs" && req.method === "GET") {
    return sendJson(res, 200, listRuns(opts.worktreePath));
  }

  let m = path.match(/^\/api\/runs\/([^/]+)$/);
  if (m && req.method === "GET") {
    const summary = getRunSummary(opts.worktreePath, m[1]);
    if (!summary) return sendJson(res, 404, { error: "run not found" });
    return sendJson(res, 200, summary);
  }

  m = path.match(/^\/api\/runs\/([^/]+)\/note$/);
  if (m && req.method === "GET") {
    const note = readNote(opts.worktreePath);
    if (note === null) return sendJson(res, 404, { error: "current-note.md not found" });
    res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
    res.end(note);
    return;
  }

  m = path.match(/^\/api\/runs\/([^/]+)\/gates\/([^/]+)$/);
  if (m && req.method === "POST") {
    return postGate(req, res, opts.worktreePath, m[1], m[2]);
  }

  // ── Static ────────────────────────────────────────────────────────────
  return serveStatic(res, opts.staticDir, path);
}

// ─── Run discovery ────────────────────────────────────────────────────────

interface RunListItem {
  run_id: string;
  saved_at: string | null;
  ticket_id: string | null;
  current_state: string | null;
}

function listRuns(worktreePath: string): RunListItem[] {
  const runsDir = join(worktreePath, ".pdh-flow", "runs");
  if (!existsSync(runsDir)) return [];
  const entries = readdirSync(runsDir).filter((name) => {
    try {
      return statSync(join(runsDir, name)).isDirectory();
    } catch {
      return false;
    }
  });
  const items: RunListItem[] = entries.map((runId) => {
    const snap = readSnapshot(worktreePath, runId);
    return {
      run_id: runId,
      saved_at: snap?.saved_at ?? null,
      ticket_id: snap?.ticket_id ?? null,
      current_state: snap ? extractState(snap) : null,
    };
  });
  // Newest first.
  items.sort((a, b) => (b.saved_at ?? "").localeCompare(a.saved_at ?? ""));
  return items;
}

interface RunSummary {
  run_id: string;
  ticket_id: string | null;
  flow: string | null;
  variant: string | null;
  saved_at: string | null;
  current_state: string;
  round: number;
  last_guardian_decision: string | null;
  active_gate: string | null;
  judgements: { node_id: string; round: number; decision: string }[];
  gate_decisions: { node_id: string; decision: string; decided_at: string }[];
  closed: boolean;
}

function getRunSummary(worktreePath: string, runId: string): RunSummary | null {
  const runDir = join(worktreePath, ".pdh-flow", "runs", runId);
  if (!existsSync(runDir)) return null;
  const snap = readSnapshot(worktreePath, runId);
  const currentState = snap ? extractState(snap) : "<unknown>";
  const judgements = readJudgements(worktreePath, runId);
  const gateDecisions = readGateDecisions(worktreePath, runId);
  // active_gate: heuristic — if currentState matches a gate-shaped name, flag.
  // A gate node id by convention is `<name>_gate` or `<name>.gate`.
  const isGate =
    /(^|_|\.)gate$/.test(currentState) ||
    currentState === "plan_gate" ||
    currentState === "close_gate" ||
    currentState === "review_gate";
  const alreadyDecided = gateDecisions.some((g) => g.node_id === currentState);
  const closed = existsSync(join(runDir, "closed.json"));
  return {
    run_id: runId,
    ticket_id: snap?.ticket_id ?? null,
    flow: snap?.flow ?? null,
    variant: snap?.variant ?? null,
    saved_at: snap?.saved_at ?? null,
    current_state: currentState,
    round: typeof snap?.xstate_snapshot?.context?.round === "number"
      ? snap.xstate_snapshot.context.round
      : 0,
    last_guardian_decision: snap?.xstate_snapshot?.context?.lastGuardianDecision ?? null,
    active_gate: isGate && !alreadyDecided ? currentState : null,
    judgements,
    gate_decisions: gateDecisions,
    closed,
  };
}

function readSnapshot(worktreePath: string, runId: string): any | null {
  const path = join(worktreePath, ".pdh-flow", "runs", runId, "snapshot.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function extractState(snap: any): string {
  const v = snap?.xstate_snapshot?.value;
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return JSON.stringify(v);
  return "<unknown>";
}

function readJudgements(
  worktreePath: string,
  runId: string,
): { node_id: string; round: number; decision: string }[] {
  const dir = join(worktreePath, ".pdh-flow", "runs", runId, "judgements");
  if (!existsSync(dir)) return [];
  const out: { node_id: string; round: number; decision: string }[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const obj = JSON.parse(readFileSync(join(dir, f), "utf8"));
      out.push({
        node_id: obj.frozen_by_node_id ?? f.replace(/__round-.*$/, ""),
        round: obj.round ?? 1,
        decision: obj.guardian_output?.decision ?? "<unknown>",
      });
    } catch {
      // skip malformed
    }
  }
  return out.sort((a, b) =>
    a.node_id === b.node_id ? a.round - b.round : a.node_id.localeCompare(b.node_id),
  );
}

function readGateDecisions(
  worktreePath: string,
  runId: string,
): { node_id: string; decision: string; decided_at: string }[] {
  const dir = join(worktreePath, ".pdh-flow", "runs", runId, "gates");
  if (!existsSync(dir)) return [];
  const out: { node_id: string; decision: string; decided_at: string }[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const obj = JSON.parse(readFileSync(join(dir, f), "utf8"));
      out.push({
        node_id: obj.node_id ?? f.replace(/\.json$/, ""),
        decision: obj.decision ?? "<unknown>",
        decided_at: obj.decided_at ?? "",
      });
    } catch {
      // skip malformed
    }
  }
  return out.sort((a, b) => a.decided_at.localeCompare(b.decided_at));
}

function readNote(worktreePath: string): string | null {
  const path = join(worktreePath, "current-note.md");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

// ─── Gate post ────────────────────────────────────────────────────────────

async function postGate(
  req: IncomingMessage,
  res: ServerResponse,
  worktreePath: string,
  runId: string,
  nodeId: string,
): Promise<void> {
  const body = await readBody(req);
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    return sendJson(res, 400, { error: "invalid JSON body" });
  }
  const decision = parsed.decision;
  if (!["approved", "rejected", "cancelled"].includes(decision)) {
    return sendJson(res, 400, {
      error: "decision must be one of approved/rejected/cancelled",
    });
  }
  const approver = String(parsed.approver ?? "").slice(0, 128) || "web-ui";
  const comment = parsed.comment ? String(parsed.comment).slice(0, 4000) : undefined;

  const decided: any = {
    status: "completed",
    node_id: nodeId,
    round: parsed.round ?? 1,
    decision,
    approver,
    decided_at: new Date().toISOString(),
    via: "web_ui",
  };
  if (comment) decided.comment = comment;
  if (parsed.form_data && typeof parsed.form_data === "object") {
    decided.form_data = parsed.form_data;
  }

  // Validate against gate-output.schema.json before writing.
  const v = getValidator();
  const result = v.validate(SCHEMA_IDS.gateOutput, decided);
  if (result.ok === false) {
    return sendJson(res, 400, {
      error: "gate decision failed schema validation",
      details: formatErrors(result.errors),
    });
  }

  const dir = join(worktreePath, ".pdh-flow", "runs", runId, "gates");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${nodeId}.json`);
  if (existsSync(path)) {
    return sendJson(res, 409, {
      error: "gate already decided",
      existing: JSON.parse(readFileSync(path, "utf8")),
    });
  }
  writeFileSync(path, JSON.stringify(decided, null, 2));
  return sendJson(res, 200, { ok: true, written: path, decision: decided });
}

// ─── Static files ─────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(res: ServerResponse, staticDir: string, urlPath: string): void {
  // Default to index.html for `/`.
  const safe = urlPath === "/" ? "/index.html" : urlPath;
  // Prevent path traversal.
  const target = resolve(staticDir, "." + safe);
  if (!target.startsWith(resolve(staticDir))) {
    return sendJson(res, 403, { error: "forbidden" });
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    return sendJson(res, 404, { error: "not found", path: urlPath });
  }
  const mime = MIME[extname(target)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  res.end(readFileSync(target));
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
