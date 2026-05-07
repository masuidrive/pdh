// Provider dispatcher.
//
// pdh-flow currently has two provider adapters (codex, claude) under
// src/runtime/. Both export a `run<Provider>` async function that shares
// a parameter shape (cwd, prompt, rawLogPath, env, model, resume,
// timeoutMs, idleTimeoutMs, killGraceMs, onSpawn, onEvent) and returns
// { exitCode, pid, finalMessage, sessionId, stderr, timedOut, timeoutKind, signal }.
// They are not formal classes — the contract is duck-typed.
//
// runProvider() is the single dispatch point. It takes the parsed CLI
// `options` bag and translates the provider-agnostic flags (bypass,
// bare, model, permission-mode, include-partial-messages, kill-grace-ms)
// into each adapter's preferred argument shape. Callers stay free of
// per-provider conditionals.
import { runCodex } from "./codex.js";
import { runClaude } from "./claude.js";
import { readArtifactsForLog, recordProviderRequest, recordProviderResponse } from "./debug-log.js";
const KNOWN_PROVIDERS = new Set(["codex", "claude"]);
export function isKnownProvider(name) {
    return KNOWN_PROVIDERS.has(name);
}
export function listKnownProviders() {
    return [...KNOWN_PROVIDERS];
}
export async function runProvider({ provider, cwd, prompt, rawLogPath, timeoutMs, idleTimeoutMs, options = {}, onEvent = () => { }, onSpawn = () => { }, resume = null, forceBareClaude = false, disableSlashCommands = false, settingSources = null, debugContext = null }) {
    const debugHandle = debugContext
        ? recordProviderRequest(debugContext, {
            provider,
            cwd,
            rawLogPath,
            timeoutMs,
            idleTimeoutMs,
            resume,
            bypass: options.bypass !== "false",
            bare: forceBareClaude || options.bare === "true",
            model: options.model ?? null,
            permissionMode: options["permission-mode"] ?? null,
            disableSlashCommands,
            settingSources,
            includePartialMessages: options["include-partial-messages"] === "true",
            startedAt: new Date().toISOString(),
            promptLength: prompt.length,
            prompt
        })
        : null;
    let result;
    if (provider === "codex") {
        result = await runCodex({
            cwd,
            prompt,
            rawLogPath,
            bypass: options.bypass !== "false",
            model: options.model ?? null,
            resume,
            timeoutMs,
            idleTimeoutMs,
            killGraceMs: providerKillGraceMs(options),
            onSpawn,
            onEvent
        });
    }
    else if (provider === "claude") {
        result = await runClaude({
            cwd,
            prompt,
            rawLogPath,
            bare: forceBareClaude || options.bare === "true",
            disableSlashCommands,
            settingSources,
            includePartialMessages: options["include-partial-messages"] === "true",
            model: options.model ?? null,
            permissionMode: options["permission-mode"] ?? (options.bypass !== "false" ? "bypassPermissions" : "acceptEdits"),
            resume,
            timeoutMs,
            idleTimeoutMs,
            killGraceMs: providerKillGraceMs(options),
            onSpawn,
            onEvent
        });
    }
    else {
        throw new Error(`runProvider: unknown provider=${provider}`);
    }
    if (debugContext && debugHandle) {
        const artifacts = readArtifactsForLog(debugContext.artifactPaths);
        recordProviderResponse(debugContext, debugHandle.seqStr, {
            provider,
            finishedAt: new Date().toISOString(),
            exitCode: result.exitCode ?? null,
            pid: result.pid ?? null,
            sessionId: result.sessionId ?? null,
            finalMessage: result.finalMessage ?? null,
            stderr: result.stderr ?? null,
            timedOut: result.timedOut ?? false,
            timeoutKind: result.timeoutKind ?? null,
            signal: result.signal ?? null,
            rawLogPath,
            artifacts
        });
    }
    return result;
}
export function providerKillGraceMs(options = {}) {
    const raw = options?.["kill-grace-ms"] ?? "5000";
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
        throw new Error(`--kill-grace-ms must be a non-negative integer`);
    }
    return n;
}
