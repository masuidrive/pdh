import { spawnSync } from "node:child_process";
export class CommandExecutionError extends Error {
    name = "CommandExecutionError";
    kind;
    command;
    args;
    displayCommand;
    cwd;
    exitCode;
    signal;
    timedOut;
    stdout;
    stderr;
    stdoutBuffer;
    stderrBuffer;
    cause;
    constructor(result, options = {}) {
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
export function runCommand(command, args = [], options = {}) {
    const result = runCommandResult(command, args, options);
    if (!result.ok) {
        throw new CommandExecutionError(result, {
            timeoutMs: options.timeout,
            summaryLimit: options.summaryLimit,
        });
    }
    return result;
}
export function runCommandResult(command, args = [], options = {}) {
    const encoding = options.encoding === null ? null : (options.encoding ?? "utf8");
    const spawned = spawnSync(command, args, {
        ...options,
        encoding,
    });
    const stdoutBuffer = bufferFromOutput(spawned.stdout);
    const stderrBuffer = bufferFromOutput(spawned.stderr);
    const stdout = stdoutBuffer.toString("utf8");
    const stderr = stderrBuffer.toString("utf8");
    const exitCode = typeof spawned.status === "number" ? spawned.status : null;
    const signal = spawned.signal ?? null;
    const timedOut = Boolean(spawned.error && spawned.error?.code === "ETIMEDOUT");
    const acceptedExitCodes = new Set([0, ...normalizeExitCodes(options.acceptExitCodes)]);
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
        error: spawned.error ?? null,
        status: exitCode,
    };
}
export function commandErrorDetails(error, options = {}) {
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
export function formatCommandForDisplay(command, args = []) {
    return [shellQuote(command), ...args.map((arg) => shellQuote(String(arg)))].join(" ");
}
function normalizeExitCodes(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry));
}
function bufferFromOutput(value) {
    if (!value) {
        return Buffer.alloc(0);
    }
    if (Buffer.isBuffer(value)) {
        return value;
    }
    return Buffer.from(String(value), "utf8");
}
function commandFailureKind(result) {
    if (result.error) {
        return result.timedOut ? "timeout" : "spawn_error";
    }
    if (result.signal) {
        return "signal";
    }
    return "exit_code";
}
function formatCommandFailure(result, options) {
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
function summarizeOutput(result, maxChars) {
    return trimOutput(result.stderr.trim() || result.stdout.trim(), maxChars);
}
function trimOutput(text, maxChars) {
    const value = String(text ?? "").trim();
    if (!value) {
        return "";
    }
    if (value.length <= maxChars) {
        return value;
    }
    return `...${value.slice(-maxChars)}`;
}
function shellQuote(value) {
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
        return value;
    }
    return `'${value.replaceAll("'", "'\\''")}'`;
}
