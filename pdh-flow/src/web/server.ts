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
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getValidator, SCHEMA_IDS, formatErrors } from "../engine/validate.ts";

export interface ServeOptions {
  worktreePath: string;
  port: number;
  /**
   * Bind address. Default `127.0.0.1` (loopback only). Pass `0.0.0.0`
   * (or `::`) to accept connections from other machines on the LAN.
   */
  host?: string;
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
  const host = opts.host ?? "127.0.0.1";
  server.listen(opts.port, host, () => {
    const display = host === "0.0.0.0" || host === "::"
      ? `http://0.0.0.0:${opts.port} (reachable from any interface)`
      : `http://${host}:${opts.port}`;
    process.stderr.write(
      `[web] listening on ${display} (worktree=${opts.worktreePath})\n`,
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
  // F-011/H10-8: ticket-centric primary view. /api/tickets lists from
  // tickets/<slug>.md (durable). /api/runs is kept for engine-internal
  // debugging but the UI defaults to tickets.
  if (path === "/api/tickets" && req.method === "GET") {
    return sendJson(res, 200, listTickets(opts.worktreePath));
  }

  let m = path.match(/^\/api\/tickets\/([^/]+)$/);
  if (m && req.method === "GET") {
    const detail = getTicketDetail(opts.worktreePath, m[1]);
    if (!detail) return sendJson(res, 404, { error: "ticket not found" });
    return sendJson(res, 200, detail);
  }

  if (path === "/api/runs" && req.method === "GET") {
    return sendJson(res, 200, listRuns(opts.worktreePath));
  }

  m = path.match(/^\/api\/runs\/([^/]+)$/);
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

  m = path.match(/^\/api\/runs\/([^/]+)\/turns\/([^/]+)\/(\d+)$/);
  if (m && req.method === "POST") {
    return postTurn(
      req,
      res,
      opts.worktreePath,
      m[1],
      m[2],
      parseInt(m[3], 10),
    );
  }

  m = path.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (m && req.method === "GET") {
    return handleSSE(req, res, opts.worktreePath, m[1]);
  }

  m = path.match(/^\/api\/runs-events$/);
  if (m && req.method === "GET") {
    return handleRunsListSSE(req, res, opts.worktreePath);
  }

  // ── Static ────────────────────────────────────────────────────────────
  return serveStatic(res, opts.staticDir, path);
}

// ─── Ticket discovery (F-011/H10-8) ──────────────────────────────────────

interface TicketListItem {
  slug: string;
  title: string | null;
  status: string | null;
  opened_at: string | null;
  closed_at: string | null;
  /** Latest run for this ticket, when one exists. */
  latest_run_id: string | null;
  latest_run_state: string | null;
}

interface TicketDetail {
  slug: string;
  ticket_frontmatter: Record<string, unknown>;
  ticket_body: string;
  note_body: string | null;
  latest_run: RunSummary | null;
}

function listTickets(worktreePath: string): TicketListItem[] {
  const ticketsDir = join(worktreePath, "tickets");
  if (!existsSync(ticketsDir)) return [];
  const entries = readdirSync(ticketsDir).filter(
    (f) => f.endsWith(".md") && !f.endsWith("-note.md"),
  );
  // For each ticket, also look up the latest run (if any) sharing this ticket_id.
  const runs = listRuns(worktreePath);
  const out: TicketListItem[] = entries.map((file) => {
    const slug = file.replace(/\.md$/, "");
    const fm = readFrontmatter(join(ticketsDir, file));
    const matchingRun = runs.find((r) => r.ticket_id === slug);
    return {
      slug,
      title: typeof fm.title === "string" ? fm.title : null,
      status: typeof fm.status === "string" ? fm.status : null,
      opened_at:
        typeof fm.created_at === "string"
          ? fm.created_at
          : typeof fm.opened_at === "string"
            ? fm.opened_at
            : null,
      closed_at: typeof fm.closed_at === "string" ? fm.closed_at : null,
      latest_run_id: matchingRun?.run_id ?? null,
      latest_run_state: matchingRun?.current_state ?? null,
    };
  });
  // Sort: open tickets first, then by opened_at desc.
  out.sort((a, b) => {
    const aOpen = a.status !== "done" && a.status !== "cancelled";
    const bOpen = b.status !== "done" && b.status !== "cancelled";
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    return (b.opened_at ?? "").localeCompare(a.opened_at ?? "");
  });
  return out;
}

function getTicketDetail(
  worktreePath: string,
  slug: string,
): TicketDetail | null {
  const ticketPath = join(worktreePath, "tickets", `${slug}.md`);
  const notePath = join(worktreePath, "tickets", `${slug}-note.md`);
  if (!existsSync(ticketPath)) return null;
  const ticketFull = readFileSync(ticketPath, "utf8");
  const fm = readFrontmatter(ticketPath);
  const ticketBody = stripFrontmatter(ticketFull);
  const noteBody = existsSync(notePath)
    ? readFileSync(notePath, "utf8")
    : null;
  const runs = listRuns(worktreePath);
  const matching = runs.find((r) => r.ticket_id === slug);
  const latestRun = matching ? getRunSummary(worktreePath, matching.run_id) : null;
  return {
    slug,
    ticket_frontmatter: fm,
    ticket_body: ticketBody,
    note_body: noteBody,
    latest_run: latestRun,
  };
}

function readFrontmatter(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  // Minimal YAML parse: scalar key: value lines only. Sufficient for the
  // top-level frontmatter fields the UI needs.
  const out: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const lm = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!lm) continue;
    const key = lm[1];
    const raw = lm[2].trim();
    if (raw === "" || raw.startsWith("-")) continue;
    out[key] = raw.replace(/^['"]|['"]$/g, "");
  }
  return out;
}

function stripFrontmatter(text: string): string {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? text.slice(m[0].length) : text;
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
  /** F-012: pending in-step turn, when a provider_step is awaiting an answer. */
  active_turn: ActiveTurn | null;
  judgements: { node_id: string; round: number; decision: string }[];
  gate_decisions: { node_id: string; decision: string; decided_at: string }[];
  closed: boolean;
}

interface ActiveTurn {
  node_id: string;
  turn: number;
  round: number;
  asked_at: string | null;
  question: string;
  options: { label: string; description?: string }[];
  context: string | null;
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
  // F-011/H10-2: closed status lives in note frontmatter (durable), not in
  // `.pdh-flow/runs/<runId>/closed.json` (ephemeral, may be wiped).
  const closed = isTicketClosed(worktreePath, snap?.ticket_id ?? null);
  const activeTurn = findActiveTurn(worktreePath, runId);
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
    active_turn: activeTurn,
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
  if (v && typeof v === "object") {
    // parallel_group: XState value is `{ <group_id>: { region1: state1, ... } }`.
    // Collapse to "<group> (n active)" so the UI doesn't render a wall of JSON.
    const keys = Object.keys(v);
    if (keys.length === 1) {
      const group = keys[0];
      const inner = (v as Record<string, unknown>)[group];
      if (inner && typeof inner === "object") {
        const regions = Object.keys(inner as Record<string, unknown>);
        return `${group} (${regions.length} parallel)`;
      }
      return group;
    }
    return JSON.stringify(v);
  }
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

// True when the note frontmatter shows the run reached a terminal close
// state. Source of truth is tickets/<id>-note.md frontmatter.status; falls
// back to current-note.md when the ticketId is unknown (legacy path).
function isTicketClosed(
  worktreePath: string,
  ticketId: string | null,
): boolean {
  const candidate = ticketId
    ? join(worktreePath, "tickets", `${ticketId}-note.md`)
    : join(worktreePath, "current-note.md");
  if (!existsSync(candidate)) return false;
  try {
    const text = readFileSync(candidate, "utf8");
    const m = text.match(/^---\s*[\s\S]*?status:\s*(\w+)/m);
    return m?.[1] === "completed";
  } catch {
    return false;
  }
}

// ─── Active turn discovery (F-012) ───────────────────────────────────────

function findActiveTurn(
  worktreePath: string,
  runId: string,
): ActiveTurn | null {
  const turnsRoot = join(
    worktreePath,
    ".pdh-flow",
    "runs",
    runId,
    "turns",
  );
  if (!existsSync(turnsRoot)) return null;
  // Scan node-id directories for an unanswered question. Prefer the
  // lowest turn number in the most-recently-asked node (heuristic; in
  // practice only one turn is ever pending at once).
  const nodes = readdirSync(turnsRoot).filter((name) => {
    try {
      return statSync(join(turnsRoot, name)).isDirectory();
    } catch {
      return false;
    }
  });
  let best: { mtime: number; turn: ActiveTurn } | null = null;
  for (const nodeId of nodes) {
    const nodeDir = join(turnsRoot, nodeId);
    const files = readdirSync(nodeDir);
    const seqs = new Set<number>();
    const answered = new Set<number>();
    for (const f of files) {
      const qm = f.match(/^turn-(\d{3})-question\.json$/);
      const am = f.match(/^turn-(\d{3})-answer\.json$/);
      if (qm) seqs.add(parseInt(qm[1], 10));
      if (am) answered.add(parseInt(am[1], 10));
    }
    const open = [...seqs].filter((n) => !answered.has(n)).sort((a, b) => a - b);
    if (open.length === 0) continue;
    const turnNum = open[0];
    const seq = String(turnNum).padStart(3, "0");
    const qPath = join(nodeDir, `turn-${seq}-question.json`);
    let q: any;
    try {
      q = JSON.parse(readFileSync(qPath, "utf8"));
    } catch {
      continue;
    }
    const mtime = statSync(qPath).mtimeMs;
    const candidate: ActiveTurn = {
      node_id: nodeId,
      turn: turnNum,
      round: typeof q.round === "number" ? q.round : 1,
      asked_at: typeof q.asked_at === "string" ? q.asked_at : null,
      question: typeof q.ask?.question === "string" ? q.ask.question : "(no question)",
      options: Array.isArray(q.ask?.options)
        ? q.ask.options
            .filter((o: any) => o && typeof o.label === "string")
            .map((o: any) => ({
              label: o.label,
              ...(typeof o.description === "string" ? { description: o.description } : {}),
            }))
        : [],
      context: typeof q.ask?.context === "string" ? q.ask.context : null,
    };
    if (!best || mtime > best.mtime) {
      best = { mtime, turn: candidate };
    }
  }
  return best?.turn ?? null;
}

// ─── Turn answer post (F-012) ────────────────────────────────────────────

async function postTurn(
  req: IncomingMessage,
  res: ServerResponse,
  worktreePath: string,
  runId: string,
  nodeId: string,
  turnNum: number,
): Promise<void> {
  const body = await readBody(req);
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    return sendJson(res, 400, { error: "invalid JSON body" });
  }
  const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
  if (!text) {
    return sendJson(res, 400, { error: "text is required and must be non-empty" });
  }
  const responder = typeof parsed.responder === "string"
    ? parsed.responder.slice(0, 128)
    : "web-ui";
  const selectedOption =
    typeof parsed.selected_option === "number" && Number.isInteger(parsed.selected_option) && parsed.selected_option >= 0
      ? parsed.selected_option
      : undefined;

  // Read the matching question file to copy round (and confirm question exists).
  const seq = String(turnNum).padStart(3, "0");
  const qPath = join(
    worktreePath,
    ".pdh-flow",
    "runs",
    runId,
    "turns",
    nodeId,
    `turn-${seq}-question.json`,
  );
  if (!existsSync(qPath)) {
    return sendJson(res, 404, {
      error: "question file not found",
      path: qPath,
    });
  }
  const aPath = qPath.replace("-question.", "-answer.");
  if (existsSync(aPath)) {
    return sendJson(res, 409, {
      error: "turn already answered",
      existing: JSON.parse(readFileSync(aPath, "utf8")),
    });
  }
  let round = 1;
  try {
    const q = JSON.parse(readFileSync(qPath, "utf8"));
    if (typeof q.round === "number") round = q.round;
  } catch { /* ignore */ }

  const answer: Record<string, unknown> = {
    status: "completed",
    node_id: nodeId,
    round,
    turn: turnNum,
    answered_at: new Date().toISOString(),
    answer: {
      text,
      ...(selectedOption !== undefined ? { selected_option: selectedOption } : {}),
    },
    via: "web_ui",
    responder,
  };

  const v = getValidator();
  const result = v.validate(SCHEMA_IDS.turnAnswer, answer);
  if (result.ok === false) {
    return sendJson(res, 400, {
      error: "turn answer failed schema validation",
      details: formatErrors(result.errors),
    });
  }
  writeFileSync(aPath, JSON.stringify(answer, null, 2) + "\n");
  return sendJson(res, 200, { ok: true, written: aPath, answer });
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

// ─── SSE: per-run change stream ───────────────────────────────────────────

function handleSSE(
  req: IncomingMessage,
  res: ServerResponse,
  worktreePath: string,
  runId: string,
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`:connected ${runId}\n\n`);

  const runDir = join(worktreePath, ".pdh-flow", "runs", runId);
  const watchers: FSWatcher[] = [];
  let closed = false;
  let coalesce: NodeJS.Timeout | null = null;

  const emitChange = (): void => {
    if (closed || coalesce) return;
    coalesce = setTimeout(() => {
      coalesce = null;
      if (!closed) res.write("event: change\ndata: {}\n\n");
    }, 100);
  };

  const safeWatch = (dir: string): void => {
    if (!existsSync(dir)) return;
    try {
      const w = watch(dir, () => emitChange());
      watchers.push(w);
    } catch (e) {
      process.stderr.write(
        `[web] watch failed on ${dir}: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  };

  // Watch run dir + sub-dirs that already exist.
  safeWatch(runDir);
  safeWatch(join(runDir, "judgements"));
  safeWatch(join(runDir, "gates"));
  // F-012: turn question/answer files come and go inside per-node
  // dirs. Watch the parent so creation of those dirs surfaces, plus
  // each child dir if it already exists.
  safeWatch(join(runDir, "turns"));
  const turnsRoot = join(runDir, "turns");
  if (existsSync(turnsRoot)) {
    for (const name of readdirSync(turnsRoot)) {
      const sub = join(turnsRoot, name);
      try {
        if (statSync(sub).isDirectory()) safeWatch(sub);
      } catch { /* skip */ }
    }
  }

  // If sub-dirs are created later, the run-dir watcher fires and triggers a
  // refetch on the client; the missed sub-dir watcher only matters once for
  // the very first event in that sub-dir. Acceptable for MVP — the client
  // refetches the full summary on any change anyway.

  // Heartbeat keeps proxies / load balancers from killing idle conns.
  const hb = setInterval(() => {
    if (!closed) res.write(`:hb ${Date.now()}\n\n`);
  }, 15_000);

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(hb);
    if (coalesce) clearTimeout(coalesce);
    for (const w of watchers) {
      try { w.close(); } catch {}
    }
  };
  req.on("close", cleanup);
  req.on("error", cleanup);
}

// ─── SSE: home (runs list) change stream ──────────────────────────────────

function handleRunsListSSE(
  req: IncomingMessage,
  res: ServerResponse,
  worktreePath: string,
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(":connected runs\n\n");

  const runsDir = join(worktreePath, ".pdh-flow", "runs");
  const watchers: FSWatcher[] = [];
  let closed = false;
  let coalesce: NodeJS.Timeout | null = null;

  const emitChange = (): void => {
    if (closed || coalesce) return;
    coalesce = setTimeout(() => {
      coalesce = null;
      if (!closed) res.write("event: change\ndata: {}\n\n");
    }, 200);
  };

  if (existsSync(runsDir)) {
    try {
      // Watching the runs dir non-recursively catches new run dirs being
      // created. Per-run snapshot updates would require recursive watch
      // (Linux: not supported by fs.watch). For the home view, "a run
      // appeared / disappeared" is enough; intra-run state changes only
      // matter on the detail page (which uses /events).
      watchers.push(watch(runsDir, () => emitChange()));
    } catch {}
  }

  const hb = setInterval(() => {
    if (!closed) res.write(`:hb ${Date.now()}\n\n`);
  }, 15_000);

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(hb);
    if (coalesce) clearTimeout(coalesce);
    for (const w of watchers) {
      try { w.close(); } catch {}
    }
  };
  req.on("close", cleanup);
  req.on("error", cleanup);
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
