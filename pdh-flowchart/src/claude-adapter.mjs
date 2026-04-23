import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export async function runClaude({
  cwd,
  prompt,
  rawLogPath,
  env = {},
  bare = false,
  includePartialMessages = false,
  model = null,
  permissionMode = "acceptEdits",
  resume = null,
  onEvent = () => {}
}) {
  mkdirSync(dirname(rawLogPath), { recursive: true });
  const raw = createWriteStream(rawLogPath, { flags: "a" });
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

  const child = spawn(process.env.CLAUDE_BIN || "claude", args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let finalMessage = "";
  let sessionId = null;
  let stdoutRemainder = "";
  let stderr = "";
  const decoder = new StringDecoder("utf8");

  child.stdout.on("data", (chunk) => {
    const text = decoder.write(chunk);
    stdoutRemainder += text;
    const lines = stdoutRemainder.split(/\r?\n/);
    stdoutRemainder = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      raw.write(`${line}\n`);
      const normalized = normalizeClaudeLine(line);
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
    const text = chunk.toString("utf8");
    stderr += text;
    raw.write(JSON.stringify({ stream: "stderr", text }) + "\n");
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (stdoutRemainder.trim()) {
    raw.write(`${stdoutRemainder}\n`);
    const normalized = normalizeClaudeLine(stdoutRemainder);
    if (normalized.sessionId) {
      sessionId = normalized.sessionId;
    }
    if (normalized.finalMessage) {
      finalMessage = normalized.finalMessage;
    }
    onEvent(normalized);
  }
  raw.end();

  return { exitCode, finalMessage, sessionId, stderr };
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
