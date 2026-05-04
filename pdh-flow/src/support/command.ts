import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import type { AnyRecord } from "../types.ts";

export type CommandFailureKind = "spawn_error" | "timeout" | "signal" | "exit_code";

export type CommandResult = {
  ok: boolean;
  command: string;
  args: string[];
  displayCommand: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  stdoutBuffer: Buffer;
  stderrBuffer: Buffer;
  error: Error | null;
  status: number | null;
};

export class CommandExecutionError extends Error {
  readonly name = "CommandExecutionError";
  readonly kind: CommandFailureKind;
  readonly command: string;
  readonly args: string[];
  readonly displayCommand: string;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBuffer: Buffer;
  readonly stderrBuffer: Buffer;
  readonly cause: Error | null;

  constructor(result: CommandResult, options: { timeoutMs?: number | null; summaryLimit?: number } = {}) {
    super(formatCommandFailure(result, options));
    this.kind = commandFailureKind(result);
    this.command = result.command;
    this.args = result.args;
    this.displayCommand = result.displayCommand;
    this.cwd = result.cwd;
    this.exitCode = result.exitCode;
    this.signal = result.signal;
    this.timedOut = result.timedOut;
    this.stdout = result.stdout;
    this.stderr = result.stderr;
    this.stdoutBuffer = result.stdoutBuffer;
    this.stderrBuffer = result.stderrBuffer;
    this.cause = result.error;
  }
}

export function runCommand(command: string, args: string[] = [], options: AnyRecord = {}) {
  const result = runCommandResult(command, args, options);
  if (!result.ok) {
    throw new CommandExecutionError(result, {
      timeoutMs: options.timeout,
      summaryLimit: options.summaryLimit,
    });
  }
  return result;
}

export function runCommandResult(command: string, args: string[] = [], options: AnyRecord = {}): CommandResult {
  const encoding = options.encoding === null ? null : (options.encoding ?? "utf8");
  const spawned = spawnSync(command, args, {
    ...options,
    encoding,
  }) as SpawnSyncReturns<string | Buffer>;
  const stdoutBuffer = bufferFromOutput(spawned.stdout);
  const stderrBuffer = bufferFromOutput(spawned.stderr);
  const stdout = stdoutBuffer.toString("utf8");
  const stderr = stderrBuffer.toString("utf8");
  const exitCode = typeof spawned.status === "number" ? spawned.status : null;
  const signal = spawned.signal ?? null;
  const timedOut = Boolean(spawned.error && (spawned.error as AnyRecord)?.code === "ETIMEDOUT");
  const acceptedExitCodes = new Set<number>([0, ...normalizeExitCodes(options.acceptExitCodes)]);
  const ok = !spawned.error && !signal && exitCode !== null && acceptedExitCodes.has(exitCode);
  return {
    ok,
    command,
    args,
    displayCommand: formatCommandForDisplay(command, args),
    cwd: String(options.cwd ?? process.cwd()),
    exitCode,
    signal,
    timedOut,
    stdout,
    stderr,
    stdoutBuffer,
    stderrBuffer,
    error: (spawned.error as Error | undefined) ?? null,
    status: exitCode,
  };
}

export function commandErrorDetails(error: unknown, options: { outputLimit?: number } = {}) {
  if (!(error instanceof CommandExecutionError)) {
    return null;
  }
  const outputLimit = options.outputLimit ?? 2000;
  return {
    kind: error.kind,
    command: error.displayCommand,
    cwd: error.cwd,
    exitCode: error.exitCode,
    signal: error.signal,
    timedOut: error.timedOut,
    stdout: trimOutput(error.stdout, outputLimit),
    stderr: trimOutput(error.stderr, outputLimit),
  };
}

export function formatCommandForDisplay(command: string, args: string[] = []) {
  return [shellQuote(command), ...args.map((arg) => shellQuote(String(arg)))].join(" ");
}

function normalizeExitCodes(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry));
}

function bufferFromOutput(value: string | Buffer | null | undefined) {
  if (!value) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  return Buffer.from(String(value), "utf8");
}

function commandFailureKind(result: CommandResult): CommandFailureKind {
  if (result.error) {
    return result.timedOut ? "timeout" : "spawn_error";
  }
  if (result.signal) {
    return "signal";
  }
  return "exit_code";
}

function formatCommandFailure(result: CommandResult, options: { timeoutMs?: number | null; summaryLimit?: number }) {
  const summary = summarizeOutput(result, options.summaryLimit ?? 1200);
  const cwdLine = result.cwd ? ` (cwd: ${result.cwd})` : "";
  if (result.error) {
    if (result.timedOut) {
      const timeoutMs = options.timeoutMs ?? "unknown";
      return `${result.displayCommand} timed out after ${timeoutMs}ms${cwdLine}${summary ? `\n${summary}` : ""}`;
    }
    return `${result.displayCommand} failed to start${cwdLine}: ${result.error.message}`;
  }
  if (result.signal) {
    return `${result.displayCommand} exited via ${result.signal}${cwdLine}${summary ? `\n${summary}` : ""}`;
  }
  return `${result.displayCommand} exited ${result.exitCode ?? "unknown"}${cwdLine}${summary ? `\n${summary}` : ""}`;
}

function summarizeOutput(result: CommandResult, maxChars: number) {
  return trimOutput(result.stderr.trim() || result.stdout.trim(), maxChars);
}

function trimOutput(text: string, maxChars: number) {
  const value = String(text ?? "").trim();
  if (!value) {
    return "";
  }
  if (value.length <= maxChars) {
    return value;
  }
  return `...${value.slice(-maxChars)}`;
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
