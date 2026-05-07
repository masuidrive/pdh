import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { createRedactor } from "../repo/redaction.js";
export function spawnProvider(command, args, options) {
    return spawn(command, args, {
        ...options,
        detached: process.platform !== "win32"
    });
}
export async function runProvider({ providerName, bin, args, cwd, env, stdio, rawLogPath, prompt = null, writeStdin = false, timeoutMs, idleTimeoutMs, killGraceMs, normalizeLine, onSpawn, onEvent }) {
    mkdirSync(dirname(rawLogPath), { recursive: true });
    const raw = createWriteStream(rawLogPath, { flags: "a" });
    const effectiveEnv = { ...process.env, ...env };
    const redact = createRedactor({ repoPath: cwd, env: effectiveEnv });
    const child = spawnProvider(bin, args, { cwd, env: effectiveEnv, stdio });
    onSpawn({ pid: child.pid ?? null });
    let finalMessage = "";
    let sessionId = null;
    let stdoutRemainder = "";
    let stderr = "";
    const decoder = new StringDecoder("utf8");
    const writeTimeoutEntry = ({ timeoutMs: ms, signal, kind, type, label }) => {
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
    const handleLine = (line) => {
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
    child.stdout.on("data", (chunk) => {
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
    }
    finally {
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
export function createProcessTimeout({ child, timeoutMs = null, idleTimeoutMs = null, killGraceMs = 5000, onTimeout = () => { }, onKill = () => { }, onTerminateError = () => { } }) {
    if ((!timeoutMs || timeoutMs <= 0) && (!idleTimeoutMs || idleTimeoutMs <= 0)) {
        return {
            get timedOut() {
                return false;
            },
            get timeoutKind() {
                return null;
            },
            touch() { },
            clear() { }
        };
    }
    let timedOut = false;
    let timeoutKind = null;
    let killTimer = null;
    let idleTimer = null;
    const armKillTimer = (budgetMs, kind) => {
        killTimer = setTimeout(() => {
            onKill({ timeoutMs: budgetMs, signal: "SIGKILL", kind });
            tryTerminateProcessTree(child, "SIGKILL", (error) => onTerminateError({ timeoutMs: budgetMs, signal: "SIGKILL", kind, error }));
        }, killGraceMs);
        killTimer.unref?.();
    };
    const triggerTimeout = (budgetMs, kind) => {
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
function tryTerminateProcessTree(child, signal, onError) {
    try {
        terminateProcessTree(child, signal);
    }
    catch (error) {
        onError(error);
    }
}
export function terminateProcessTree(child, signal) {
    if (!child.pid) {
        return;
    }
    try {
        if (process.platform === "win32") {
            child.kill(signal);
            return;
        }
        process.kill(-child.pid, signal);
    }
    catch (error) {
        if (error.code !== "ESRCH") {
            throw error;
        }
    }
}
