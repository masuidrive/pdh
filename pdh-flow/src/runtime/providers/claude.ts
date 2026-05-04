import { runProvider } from "../process-control.ts";
import type { ProviderEvent, ProviderSpawnInfo } from "../../types.ts";

export async function runClaude({
  cwd,
  prompt,
  rawLogPath,
  env = {},
  bare = false,
  disableSlashCommands = false,
  settingSources = null,
  includePartialMessages = false,
  model = null,
  permissionMode = "bypassPermissions",
  resume = null,
  timeoutMs = null,
  idleTimeoutMs = null,
  killGraceMs = 5000,
  onSpawn = () => {},
  onEvent = () => {}
}: {
  cwd: string;
  prompt: string;
  rawLogPath: string;
  env?: NodeJS.ProcessEnv;
  bare?: boolean;
  disableSlashCommands?: boolean;
  settingSources?: string | null;
  includePartialMessages?: boolean;
  model?: string | null;
  permissionMode?: string | null;
  resume?: string | null;
  timeoutMs?: number | null;
  idleTimeoutMs?: number | null;
  killGraceMs?: number;
  onSpawn?: (info: ProviderSpawnInfo) => void;
  onEvent?: (event: ProviderEvent) => void;
}) {
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
  if (bare) {
    args.unshift("--bare");
  }
  if (disableSlashCommands) {
    args.push("--disable-slash-commands");
  }
  if (settingSources) {
    args.push("--setting-sources", settingSources);
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

  return runProvider({
    providerName: "claude",
    bin: process.env.CLAUDE_BIN || "claude",
    args,
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    rawLogPath,
    timeoutMs,
    idleTimeoutMs,
    killGraceMs,
    normalizeLine: normalizeClaudeLine,
    onSpawn,
    onEvent
  });
}

export function normalizeClaudeLine(line: string): ProviderEvent {
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

function extractClaudeText(message: any) {
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
