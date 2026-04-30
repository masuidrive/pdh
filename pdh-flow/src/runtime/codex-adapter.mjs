import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { createProcessTimeout, spawnProvider } from "./process-control.mjs";
import { createRedactor } from "../core/redaction.mjs";

export async function runCodex({
  cwd,
  prompt,
  rawLogPath,
  env = {},
  bypass = true,
  model = null,
  resume = null,
  timeoutMs = null,
  idleTimeoutMs = null,
  killGraceMs = 5000,
  onSpawn = () => {},
  onEvent = () => {}
}) {
  mkdirSync(dirname(rawLogPath), { recursive: true });
  const raw = createWriteStream(rawLogPath, { flags: "a" });
  const effectiveEnv = { ...process.env, ...env };
  const redact = createRedactor({ repoPath: cwd, env: effectiveEnv });
  const args = resume
    ? ["exec", "resume", "--json", "--skip-git-repo-check"]
    : ["exec", "--json", "--cd", cwd, "--skip-git-repo-check"];
  for (const key of ["PATH", "TMPDIR", "UV_CACHE_DIR"]) {
    if (effectiveEnv[key]) {
      args.push("-c", `shell_environment_policy.set.${key}=${JSON.stringify(effectiveEnv[key])}`);
    }
  }
  if (model) {
    args.push("--model", model);
  }
  args.push(bypass ? "--dangerously-bypass-approvals-and-sandbox" : "--full-auto");
  if (resume) {
    args.push(resume);
  }
  args.push("-");

  const child = spawnProvider(process.env.CODEX_BIN || "codex", args, {
    cwd,
    env: effectiveEnv,
    stdio: ["pipe", "pipe", "pipe"]
  });
  onSpawn({ pid: child.pid ?? null });

  let finalMessage = "";
  let sessionId = null;
  let stdoutRemainder = "";
  let stderr = "";
  const decoder = new StringDecoder("utf8");
  const timeout = createProcessTimeout({
    child,
    timeoutMs,
    idleTimeoutMs,
    killGraceMs,
    onTimeout({ timeoutMs: ms, signal, kind }) {
      const label = kind === "idle" ? "idle timeout" : "timed out";
      const message = `codex ${label} after ${ms}ms; sent ${signal}`;
      stderr += `${message}\n`;
      raw.write(JSON.stringify({ type: "timeout", provider: "codex", timeoutMs: ms, signal, kind, message }) + "\n");
      onEvent({ type: "run_failed", message, payload: { timeoutMs: ms, signal, kind } });
    },
    onKill({ timeoutMs: ms, signal, kind }) {
      const label = kind === "idle" ? "idle timeout" : "timeout";
      const message = `codex did not exit after ${label}; sent ${signal}`;
      stderr += `${message}\n`;
      raw.write(JSON.stringify({ type: "timeout_kill", provider: "codex", timeoutMs: ms, signal, kind, message }) + "\n");
      onEvent({ type: "run_failed", message, payload: { timeoutMs: ms, signal, kind } });
    }
  });

  child.stdin.write(prompt);
  child.stdin.end();

  child.stdout.on("data", (chunk) => {
    timeout.touch();
    const text = decoder.write(chunk);
    stdoutRemainder += text;
    const lines = stdoutRemainder.split(/\r?\n/);
    stdoutRemainder = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const redactedLine = redact(line);
      raw.write(`${redactedLine}\n`);
      const normalized = normalizeCodexLine(redactedLine);
      if (normalized.sessionId) {
        sessionId = normalized.sessionId;
      }
      if (normalized.finalMessage) {
        finalMessage = normalized.finalMessage;
      }
      onEvent(normalized);
    }
  });

  child.stderr.on("data", (chunk) => {
    timeout.touch();
    const text = redact(chunk.toString("utf8"));
    stderr += text;
    raw.write(JSON.stringify({ stream: "stderr", text }) + "\n");
  });

  let closed;
  try {
    closed = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
    });
  } finally {
    timeout.clear();
  }
  if (stdoutRemainder.trim()) {
    const redactedLine = redact(stdoutRemainder);
    raw.write(`${redactedLine}\n`);
    const normalized = normalizeCodexLine(redactedLine);
    if (normalized.sessionId) {
      sessionId = normalized.sessionId;
    }
    if (normalized.finalMessage) {
      finalMessage = normalized.finalMessage;
    }
    onEvent(normalized);
  }
  await new Promise((resolve) => raw.end(resolve));

  const exitCode = timeout.timedOut ? 124 : (closed.code ?? (closed.signal ? 1 : 0));
  return {
    exitCode,
    pid: child.pid ?? null,
    finalMessage,
    sessionId,
    stderr,
    timedOut: timeout.timedOut,
    timeoutKind: timeout.timeoutKind,
    signal: closed.signal
  };
}

export function normalizeCodexLine(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch (error) {
    return { type: "message", message: line, payload: { parseError: error.message } };
  }

  const type = event.type ?? event.msg?.type ?? "event";
  const sessionId = event.thread_id ?? event.threadId ?? event.session_id ?? event.id;

  if (type === "thread.started" || type === "session.started") {
    return { type: "status", message: type, sessionId, payload: event };
  }
  if (type === "turn.completed" || type === "completed") {
    return { type: "step_finished", message: "codex turn completed", finalMessage: event.final_message ?? event.message, payload: event };
  }
  if (type === "error") {
    return { type: "run_failed", message: event.message ?? "codex error", payload: event };
  }

  const item = event.item ?? event.msg?.item;
  const itemType = item?.type ?? event.item_type;
  if (itemType === "message" || itemType === "agent_message") {
    const text = extractText(item) ?? event.message ?? "";
    return { type: "message", message: text, finalMessage: text, payload: event };
  }
  if (itemType === "todo_list") {
    return { type: "status", message: "todo_list updated", payload: event };
  }
  if (itemType === "command_execution" || itemType === "local_shell_call") {
    const command = item?.command ?? item?.cmd ?? item?.arguments ?? event.command;
    const status = item?.status ?? event.status;
    return {
      type: status === "completed" ? "tool_finished" : "tool_started",
      message: command ? String(command) : "command",
      payload: event
    };
  }
  if (itemType === "file_change" || itemType === "file_changes") {
    return { type: "file_changed", message: item?.path ?? "file changed", payload: event };
  }

  return { type: "status", message: type, sessionId, payload: event };
}

function extractText(item) {
  if (!item) {
    return null;
  }
  if (typeof item.text === "string") {
    return item.text;
  }
  if (typeof item.content === "string") {
    return item.content;
  }
  if (Array.isArray(item.content)) {
    return item.content.map((part) => part.text ?? part.content ?? "").join("");
  }
  return null;
}
