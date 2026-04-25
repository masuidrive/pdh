import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn as spawnPty } from "node-pty";
import { WebSocket, WebSocketServer } from "ws";

const CLI_PATH = fileURLToPath(new URL("./cli.mjs", import.meta.url));
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const MAX_BUFFER = 300000;
const RETAIN_EXITED_MS = 30 * 60 * 1000;

export function createAssistTerminalManager({ repoPath }) {
  const sessions = new Map();
  const activeByStep = new Map();
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (socket, request, session) => {
    attachSocket({ socket, session });
  });

  function attachSocket({ socket, session }) {
    session.clients.add(socket);
    send(socket, {
      type: "snapshot",
      sessionId: session.id,
      stepId: session.stepId,
      status: session.status,
      exitCode: session.exitCode,
      signal: session.signal,
      data: session.buffer
    });
    socket.on("message", (message) => {
      handleSocketMessage({ session, socket, message });
    });
    socket.on("close", () => {
      session.clients.delete(socket);
    });
  }

  function handleSocketMessage({ session, socket, message }) {
    let payload = null;
    try {
      payload = JSON.parse(String(message));
    } catch {
      send(socket, { type: "error", message: "invalid_message" });
      return;
    }
    if (payload.type === "input") {
      if (session.status === "running" && typeof payload.data === "string" && payload.data.length) {
        session.pty.write(payload.data);
      }
      return;
    }
    if (payload.type === "resize") {
      const cols = Number(payload.cols) || DEFAULT_COLS;
      const rows = Number(payload.rows) || DEFAULT_ROWS;
      if (session.status === "running") {
        session.pty.resize(Math.max(20, cols), Math.max(8, rows));
      }
      return;
    }
    if (payload.type === "ping") {
      send(socket, { type: "pong" });
    }
  }

  function send(socket, payload) {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  function broadcast(session, payload) {
    for (const socket of session.clients) {
      send(socket, payload);
    }
  }

  function trimBuffer(text) {
    if (text.length <= MAX_BUFFER) {
      return text;
    }
    return text.slice(text.length - MAX_BUFFER);
  }

  function pruneSessions() {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
      if (session.status === "running") {
        continue;
      }
      if (now - session.updatedAt > RETAIN_EXITED_MS) {
        for (const socket of session.clients) {
          socket.close(1001, "session_expired");
        }
        sessions.delete(id);
      }
    }
  }

  function openSession({ stepId }) {
    pruneSessions();
    const existingId = activeByStep.get(stepId);
    if (existingId) {
      const existing = sessions.get(existingId);
      if (existing && existing.status === "running") {
        return {
          sessionId: existing.id,
          stepId,
          status: existing.status,
          reused: true
        };
      }
      activeByStep.delete(stepId);
    }

    const id = `assist-term-${Date.now()}-${randomBytes(3).toString("hex")}`;
    const command = process.execPath;
    const args = [CLI_PATH, "assist-open", "--repo", repoPath, "--step", stepId];
    const pty = spawnPty(command, args, {
      name: "xterm-color",
      cwd: repoPath,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      env: {
        ...process.env,
        TERM: process.env.TERM || "xterm-256color"
      }
    });
    const session = {
      id,
      stepId,
      command,
      args,
      pty,
      buffer: "",
      status: "running",
      exitCode: null,
      signal: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      clients: new Set()
    };
    sessions.set(id, session);
    activeByStep.set(stepId, id);

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
      if (activeByStep.get(stepId) === id) {
        activeByStep.delete(stepId);
      }
      broadcast(session, {
        type: "exit",
        exitCode: session.exitCode,
        signal: session.signal
      });
    });

    return {
      sessionId: id,
      stepId,
      status: session.status,
      reused: false
    };
  }

  function handleUpgrade(request, socket, head) {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/assist/ws") {
      return false;
    }
    const sessionId = url.searchParams.get("session");
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return true;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, session);
    });
    return true;
  }

  function closeAll() {
    for (const session of sessions.values()) {
      if (session.status === "running") {
        try {
          session.pty.kill();
        } catch {
          // Ignore PTY shutdown errors during server close.
        }
      }
      for (const socket of session.clients) {
        socket.close(1001, "server_shutdown");
      }
    }
    sessions.clear();
    activeByStep.clear();
    wss.clients.forEach((socket) => socket.close(1001, "server_shutdown"));
    wss.close();
  }

  return {
    openSession,
    handleUpgrade,
    closeAll
  };
}
