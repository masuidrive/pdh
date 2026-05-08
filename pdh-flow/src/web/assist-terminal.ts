// Assist terminal manager (v2 port of v1's src/runtime/assist/terminal.ts).
//
// Spawns claude / codex as a PTY child process, streams I/O over a
// WebSocket so the user can chat interactively in a browser-embedded
// xterm. Sessions are keyed by `<runId>:<nodeId>` and resume the
// recorded provider session captured during the engine's prior run
// (sessions/<nodeId>.json from F-001/J3).
//
// Per-session state:
//   - PTY process (claude/codex with --resume / resume)
//   - rolling output buffer (300 KB cap, replayed on reconnect)
//   - clients set (multi-tab attach via the same sessionId broadcast)
//   - status (running / exited)
//
// Exited sessions are retained for RETAIN_EXITED_MS so a brief tab
// reload still sees the final output before the GC runs.

import { spawn as spawnPty } from "@lydell/node-pty";
import type { IPty } from "@lydell/node-pty";
import { WebSocket, WebSocketServer } from "ws";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const MAX_BUFFER = 300_000;
const RETAIN_EXITED_MS = 30 * 60 * 1000;

interface AssistSession {
  id: string;
  key: string;
  title: string;
  command: string;
  args: string[];
  cwd: string;
  pty: IPty;
  buffer: string;
  status: "running" | "exited";
  exitCode: number | null;
  signal: number | null;
  createdAt: number;
  updatedAt: number;
  clients: Set<WebSocket>;
}

export interface OpenResult {
  sessionId: string;
  status: string;
  reused: boolean;
  title: string;
  command: string;
}

export interface AssistManager {
  /** Spawn (or reuse) an assist session for a recorded provider session. */
  openForNode(opts: {
    runId: string;
    nodeId: string;
    /** "resume" (default) requires sessions/<nodeId>.json; "fresh" spawns
     *  plain claude in the worktree (no resume), useful for gate cards
     *  where no provider session was captured. */
    mode?: "resume" | "fresh";
    force?: boolean;
  }): OpenResult | { error: string };
  /** WebSocket upgrade handler for /api/assist/ws?session=<id>. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  /** Tear down all sessions on server shutdown. */
  closeAll(): void;
}

export function createAssistManager(opts: { worktreePath: string }): AssistManager {
  const sessions = new Map<string, AssistSession>();
  const activeByKey = new Map<string, string>();
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (socket: WebSocket, _req, session: AssistSession) => {
    attachSocket(socket, session);
  });

  function attachSocket(socket: WebSocket, session: AssistSession): void {
    session.clients.add(socket);
    send(socket, {
      type: "snapshot",
      sessionId: session.id,
      title: session.title,
      status: session.status,
      data: session.buffer,
    });
    socket.on("message", (message) => {
      let payload: { type?: string; data?: string; cols?: number; rows?: number } | null = null;
      try {
        payload = JSON.parse(String(message));
      } catch {
        return;
      }
      if (!payload) return;
      if (payload.type === "input" && session.status === "running" && typeof payload.data === "string" && payload.data.length > 0) {
        try { session.pty.write(payload.data); } catch { /* pty may have exited */ }
      } else if (payload.type === "resize") {
        const cols = Number(payload.cols) || DEFAULT_COLS;
        const rows = Number(payload.rows) || DEFAULT_ROWS;
        if (session.status === "running") {
          try { session.pty.resize(Math.max(20, cols), Math.max(8, rows)); } catch {}
        }
      } else if (payload.type === "ping") {
        send(socket, { type: "pong" });
      }
    });
    socket.on("close", () => {
      session.clients.delete(socket);
    });
  }

  function send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try { socket.send(JSON.stringify(payload)); } catch { /* dead socket */ }
  }

  function broadcast(session: AssistSession, payload: unknown): void {
    for (const sock of session.clients) send(sock, payload);
  }

  function trimBuffer(text: string): string {
    return text.length <= MAX_BUFFER ? text : text.slice(text.length - MAX_BUFFER);
  }

  function pruneSessions(): void {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (s.status === "running") continue;
      if (now - s.updatedAt > RETAIN_EXITED_MS) {
        for (const sock of s.clients) sock.close(1001, "session_expired");
        sessions.delete(id);
      }
    }
  }

  function openForNode(p: {
    runId: string;
    nodeId: string;
    mode?: "resume" | "fresh";
    force?: boolean;
  }): OpenResult | { error: string } {
    if (p.mode === "fresh") {
      // Plain claude in the worktree, no --resume. For gate cards
      // (no provider session captured) or general worktree exploration.
      return openManagedSession({
        key: `${p.runId}:${p.nodeId}:fresh`,
        title: `claude (fresh) — ${p.nodeId}`,
        command: "claude",
        args: [],
        cwd: opts.worktreePath,
        force: p.force,
      });
    }
    const sessionPath = join(
      opts.worktreePath,
      ".pdh-flow",
      "runs",
      p.runId,
      "sessions",
      `${p.nodeId}.json`,
    );
    if (!existsSync(sessionPath)) {
      return { error: `no session record at ${sessionPath} — has the engine run this node yet?` };
    }
    let rec: { provider?: string; sessionId?: string } = {};
    try {
      rec = JSON.parse(readFileSync(sessionPath, "utf8"));
    } catch (e) {
      return { error: `could not parse session record: ${(e as Error).message}` };
    }
    if (!rec || typeof rec.sessionId !== "string" || (rec.provider !== "claude" && rec.provider !== "codex")) {
      return { error: "session record malformed (missing provider/sessionId)" };
    }
    const command = rec.provider;
    const args = rec.provider === "claude"
      ? ["--resume", rec.sessionId]
      : ["resume", rec.sessionId];
    const title = `${command} — ${p.nodeId}`;
    return openManagedSession({
      key: `${p.runId}:${p.nodeId}`,
      title,
      command,
      args,
      cwd: opts.worktreePath,
      force: p.force,
    });
  }

  function openManagedSession(p: {
    key: string;
    title: string;
    command: string;
    args: string[];
    cwd: string;
    force?: boolean;
  }): OpenResult {
    pruneSessions();
    const existingId = activeByKey.get(p.key);
    if (existingId && p.force) {
      const existing = sessions.get(existingId);
      if (existing) {
        try { existing.pty.kill(); } catch {}
        for (const sock of existing.clients) {
          try { sock.close(1000, "force_reprompt"); } catch {}
        }
        existing.status = "exited";
        sessions.delete(existingId);
      }
      activeByKey.delete(p.key);
    } else if (existingId) {
      const existing = sessions.get(existingId);
      if (existing && existing.status === "running") {
        return {
          sessionId: existing.id,
          status: existing.status,
          reused: true,
          title: existing.title,
          command: existing.command,
        };
      }
      activeByKey.delete(p.key);
    }

    const id = `assist-${Date.now()}-${randomBytes(3).toString("hex")}`;
    const pty = spawnPty(p.command, p.args, {
      name: "xterm-color",
      cwd: p.cwd,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      env: { ...process.env, TERM: process.env.TERM || "xterm-256color" },
    });
    const session: AssistSession = {
      id,
      key: p.key,
      title: p.title,
      command: p.command,
      args: p.args,
      cwd: p.cwd,
      pty,
      buffer: "",
      status: "running",
      exitCode: null,
      signal: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      clients: new Set(),
    };
    sessions.set(id, session);
    activeByKey.set(p.key, id);

    pty.onData((data) => {
      session.buffer = trimBuffer(session.buffer + data);
      session.updatedAt = Date.now();
      broadcast(session, { type: "output", data });
    });
    pty.onExit((event) => {
      session.status = "exited";
      session.exitCode = event.exitCode ?? 0;
      session.signal = event.signal ?? null;
      session.updatedAt = Date.now();
      if (activeByKey.get(p.key) === id) activeByKey.delete(p.key);
      broadcast(session, {
        type: "exit",
        exitCode: session.exitCode,
        signal: session.signal,
      });
    });

    return {
      sessionId: id,
      status: "running",
      reused: false,
      title: p.title,
      command: p.command,
    };
  }

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/assist/ws") return false;
    const sessionId = url.searchParams.get("session");
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return true;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, session);
    });
    return true;
  }

  function closeAll(): void {
    for (const s of sessions.values()) {
      if (s.status === "running") {
        try { s.pty.kill(); } catch {}
      }
      for (const sock of s.clients) {
        try { sock.close(1001, "server_shutdown"); } catch {}
      }
    }
    sessions.clear();
    activeByKey.clear();
    try { wss.close(); } catch {}
  }

  return { openForNode, handleUpgrade, closeAll };
}
