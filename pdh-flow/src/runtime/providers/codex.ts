import { runProvider } from "../process-control.ts";
import type { ProviderEvent, ProviderSpawnInfo } from "../../types.ts";

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
}: {
  cwd: string;
  prompt: string;
  rawLogPath: string;
  env?: NodeJS.ProcessEnv;
  bypass?: boolean;
  model?: string | null;
  resume?: string | null;
  timeoutMs?: number | null;
  idleTimeoutMs?: number | null;
  killGraceMs?: number;
  onSpawn?: (info: ProviderSpawnInfo) => void;
  onEvent?: (event: ProviderEvent) => void;
}) {
  const effectiveEnv = { ...process.env, ...env };
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

  return runProvider({
    providerName: "codex",
    bin: process.env.CODEX_BIN || "codex",
    args,
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    rawLogPath,
    prompt,
    writeStdin: true,
    timeoutMs,
    idleTimeoutMs,
    killGraceMs,
    normalizeLine: normalizeCodexLine,
    onSpawn,
    onEvent
  });
}

export function normalizeCodexLine(line: string): ProviderEvent {
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

function extractText(item: any) {
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
