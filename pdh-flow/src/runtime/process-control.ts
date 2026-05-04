import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams, ChildProcessByStdio } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { createRedactor } from "../repo/redaction.ts";
import type { AnyRecord, ProviderEvent, ProviderRunResult, ProviderSpawnInfo, ProviderTimeoutInfo } from "../types.ts";

export function spawnProvider(command: string, args: string[], options: AnyRecord) {
  return spawn(command, args, {
    ...options,
    detached: process.platform !== "win32"
  });
}

export async function runProvider({
  providerName,
  bin,
  args,
  cwd,
  env,
  stdio,
  rawLogPath,
  prompt = null,
  writeStdin = false,
  timeoutMs,
  idleTimeoutMs,
  killGraceMs,
  normalizeLine,
  onSpawn,
  onEvent
}: {
  providerName: string;
  bin: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdio: AnyRecord;
  rawLogPath: string;
  prompt?: string | null;
  writeStdin?: boolean;
  timeoutMs: number | null;
  idleTimeoutMs: number | null;
  killGraceMs: number;
  normalizeLine: (line: string) => ProviderEvent;
  onSpawn: (info: ProviderSpawnInfo) => void;
  onEvent: (event: ProviderEvent) => void;
}): Promise<ProviderRunResult> {
  mkdirSync(dirname(rawLogPath), { recursive: true });
  const raw = createWriteStream(rawLogPath, { flags: "a" });
  const effectiveEnv = { ...process.env, ...env };
  const redact = createRedactor({ repoPath: cwd, env: effectiveEnv });

  const child = spawnProvider(bin, args, { cwd, env: effectiveEnv, stdio }) as ChildProcessByStdio<any, any, any>;
  onSpawn({ pid: child.pid ?? null });

  let finalMessage = "";
  let sessionId = null;
  let stdoutRemainder = "";
  let stderr = "";
  const decoder = new StringDecoder("utf8");

  const writeTimeoutEntry = ({ timeoutMs: ms, signal, kind, type, label }: ProviderTimeoutInfo & { type: string; label: string }) => {
    const message = `${providerName} ${label} after ${ms}ms; sent ${signal}`;
    stderr += `${message}\n`;
    raw.write(JSON.stringify({ type, provider: providerName, timeoutMs: ms, signal, kind, message }) + "\n");
    onEvent({ type: "run_failed", message, payload: { timeoutMs: ms, signal, kind } });
  };

  const timeout = createProcessTimeout({
    child,
    timeoutMs,
    idleTimeoutMs,
    killGraceMs,
    onTimeout(info) {
      writeTimeoutEntry({
        ...info,
        type: "timeout",
        label: info.kind === "idle" ? "idle timeout" : "timed out"
      });
    },
    onKill(info) {
      writeTimeoutEntry({
        ...info,
        type: "timeout_kill",
        label: `did not exit after ${info.kind === "idle" ? "idle timeout" : "timeout"}`
      });
    }
  });

  if (writeStdin) {
    child.stdin.write(prompt ?? "");
    child.stdin.end();
  }

  const handleLine = (line: string) => {
    const redactedLine = redact(line);
    raw.write(`${redactedLine}\n`);
    const normalized = normalizeLine(redactedLine);
    if (normalized.sessionId) {
      sessionId = normalized.sessionId;
    }
    if (normalized.finalMessage) {
      finalMessage = normalized.finalMessage;
    }
    onEvent(normalized);
  };

  child.stdout.on("data", (chunk: Buffer) => {
    timeout.touch();
    stdoutRemainder += decoder.write(chunk);
    const lines = stdoutRemainder.split(/\r?\n/);
    stdoutRemainder = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        handleLine(line);
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
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
    handleLine(stdoutRemainder);
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

export function createProcessTimeout({
  child,
  timeoutMs = null,
  idleTimeoutMs = null,
  killGraceMs = 5000,
  onTimeout = () => {},
  onKill = () => {},
  onTerminateError = () => {}
}: {
  child: ChildProcessWithoutNullStreams | ChildProcessByStdio<any, any, any>;
  timeoutMs?: number | null;
  idleTimeoutMs?: number | null;
  killGraceMs?: number;
  onTimeout?: (info: ProviderTimeoutInfo) => void;
  onKill?: (info: ProviderTimeoutInfo) => void;
  onTerminateError?: (info: ProviderTimeoutInfo & { error: unknown }) => void;
}) {
  if ((!timeoutMs || timeoutMs <= 0) && (!idleTimeoutMs || idleTimeoutMs <= 0)) {
    return {
      get timedOut() {
        return false;
      },
      get timeoutKind() {
        return null;
      },
      touch() {},
      clear() {}
    };
  }

  let timedOut = false;
  let timeoutKind = null;
  let killTimer = null;
  let idleTimer = null;

  const armKillTimer = (budgetMs: number, kind: "wall" | "idle") => {
    killTimer = setTimeout(() => {
      onKill({ timeoutMs: budgetMs, signal: "SIGKILL", kind });
      tryTerminateProcessTree(child, "SIGKILL", (error) => onTerminateError({ timeoutMs: budgetMs, signal: "SIGKILL", kind, error }));
    }, killGraceMs);
    killTimer.unref?.();
  };

  const triggerTimeout = (budgetMs: number, kind: "wall" | "idle") => {
    if (timedOut) {
      return;
    }
    timedOut = true;
    timeoutKind = kind;
    clearTimeout(timer);
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    onTimeout({ timeoutMs: budgetMs, signal: "SIGTERM", kind });
    tryTerminateProcessTree(child, "SIGTERM", (error) => onTerminateError({ timeoutMs: budgetMs, signal: "SIGTERM", kind, error }));
    armKillTimer(budgetMs, kind);
  };

  const timer = timeoutMs > 0 ? setTimeout(() => {
    triggerTimeout(timeoutMs, "wall");
  }, timeoutMs) : null;
  if (timer) {
    timer.unref?.();
  }

  const armIdleTimer = () => {
    if (!idleTimeoutMs || idleTimeoutMs <= 0 || timedOut) {
      return;
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      triggerTimeout(idleTimeoutMs, "idle");
    }, idleTimeoutMs);
    idleTimer.unref?.();
  };

  armIdleTimer();

  return {
    get timedOut() {
      return timedOut;
    },
    get timeoutKind() {
      return timeoutKind;
    },
    touch() {
      armIdleTimer();
    },
    clear() {
      if (timer) {
        clearTimeout(timer);
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
    }
  };
}

function tryTerminateProcessTree(child: ChildProcessWithoutNullStreams | ChildProcessByStdio<any, any, any>, signal: NodeJS.Signals, onError: (error: unknown) => void) {
  try {
    terminateProcessTree(child, signal);
  } catch (error) {
    onError(error);
  }
}

export function terminateProcessTree(child: ChildProcessWithoutNullStreams | ChildProcessByStdio<any, any, any>, signal: NodeJS.Signals) {
  if (!child.pid) {
    return;
  }
  try {
    if (process.platform === "win32") {
      child.kill(signal);
      return;
    }
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") {
      throw error;
    }
  }
}
