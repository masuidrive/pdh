import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { createProcessTimeout, spawnProvider } from "./process-control.mjs";
import { createRedactor } from "./redaction.mjs";

export async function runClaude({
  cwd,
  prompt,
  rawLogPath,
  env = {},
  bare = false,
  includePartialMessages = false,
  model = null,
  permissionMode = "bypassPermissions",
  resume = null,
  timeoutMs = null,
  killGraceMs = 5000,
  onEvent = () => {}
}) {
  mkdirSync(dirname(rawLogPath), { recursive: true });
  const raw = createWriteStream(rawLogPath, { flags: "a" });
  const effectiveEnv = { ...process.env, ...env };
  const redact = createRedactor({ repoPath: cwd, env: effectiveEnv });
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
  if (bare) {
    args.unshift("--bare");
  }
  if (includePartialMessages) {
    args.push("--include-partial-messages");
  }
  if (model) {
    args.push("--model", model);
  }
  if (permissionMode) {
    args.push("--permission-mode", permissionMode);
  }
  if (resume) {
    args.push("--resume", resume);
  }

  const child = spawnProvider(process.env.CLAUDE_BIN || "claude", args, {
    cwd,
    env: effectiveEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let finalMessage = "";
  let sessionId = null;
  let stdoutRemainder = "";
  let stderr = "";
  const decoder = new StringDecoder("utf8");
  const timeout = createProcessTimeout({
    child,
    timeoutMs,
    killGraceMs,
    onTimeout({ timeoutMs: ms, signal }) {
      const message = `claude timed out after ${ms}ms; sent ${signal}`;
      stderr += `${message}\n`;
      raw.write(JSON.stringify({ type: "timeout", provider: "claude", timeoutMs: ms, signal, message }) + "\n");
      onEvent({ type: "run_failed", message, payload: { timeoutMs: ms, signal } });
    },
    onKill({ timeoutMs: ms, signal }) {
      const message = `claude did not exit after timeout; sent ${signal}`;
      stderr += `${message}\n`;
      raw.write(JSON.stringify({ type: "timeout_kill", provider: "claude", timeoutMs: ms, signal, message }) + "\n");
      onEvent({ type: "run_failed", message, payload: { timeoutMs: ms, signal } });
    }
  });

  child.stdout.on("data", (chunk) => {
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
      const normalized = normalizeClaudeLine(redactedLine);
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
    const normalized = normalizeClaudeLine(redactedLine);
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
  return { exitCode, finalMessage, sessionId, stderr, timedOut: timeout.timedOut, signal: closed.signal };
}

export function normalizeClaudeLine(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch (error) {
    return { type: "message", message: line, payload: { parseError: error.message } };
  }

  const type = event.type ?? "event";
  const sessionId = event.session_id ?? event.sessionId ?? event.message?.session_id;

  if (type === "system" && event.subtype === "init") {
    return { type: "status", message: "claude session initialized", sessionId, payload: event };
  }
  if (type === "assistant") {
    const text = extractClaudeText(event.message);
    return { type: "message", message: text ?? "assistant message", finalMessage: text ?? null, sessionId, payload: event };
  }
  if (type === "result") {
    const isError = event.is_error === true || event.subtype === "error";
    return {
      type: isError ? "run_failed" : "step_finished",
      message: isError ? event.result ?? "claude failed" : "claude turn completed",
      finalMessage: typeof event.result === "string" ? event.result : null,
      sessionId,
      payload: event
    };
  }
  if (type === "rate_limit_event") {
    const status = event.rate_limit_info?.status ?? "unknown";
    return { type: "status", message: `claude rate limit ${status}`, sessionId, payload: event };
  }
  if (type === "user") {
    return { type: "status", message: "claude user event", sessionId, payload: event };
  }

  return { type: "status", message: type, sessionId, payload: event };
}

function extractClaudeText(message) {
  if (!message) {
    return null;
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content.map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part?.type === "text") {
        return part.text ?? "";
      }
      if (part?.type === "tool_use") {
        return `[tool_use:${part.name ?? "tool"}]`;
      }
      if (part?.type === "tool_result") {
        return "[tool_result]";
      }
      return part?.text ?? "";
    }).join("");
  }
  return null;
}
