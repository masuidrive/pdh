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

import { runCodex } from "./codex.ts";
import { runClaude } from "./claude.ts";
import type { CliOptions, ProviderEvent, ProviderSpawnInfo } from "../../types.ts";

const KNOWN_PROVIDERS = new Set(["codex", "claude"]);

export function isKnownProvider(name: string) {
  return KNOWN_PROVIDERS.has(name);
}

export function listKnownProviders() {
  return [...KNOWN_PROVIDERS];
}

export async function runProvider({
  provider,
  cwd,
  prompt,
  rawLogPath,
  timeoutMs,
  idleTimeoutMs,
  options = {},
  onEvent = () => {},
  onSpawn = () => {},
  resume = null,
  forceBareClaude = false,
  disableSlashCommands = false,
  settingSources = null
}: {
  provider: string;
  cwd: string;
  prompt: string;
  rawLogPath: string;
  timeoutMs: number | null;
  idleTimeoutMs: number | null;
  options?: CliOptions;
  onEvent?: (event: ProviderEvent) => void;
  onSpawn?: (info: ProviderSpawnInfo) => void;
  resume?: string | null;
  forceBareClaude?: boolean;
  disableSlashCommands?: boolean;
  settingSources?: string | null;
}) {
  if (provider === "codex") {
    return runCodex({
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
  if (provider === "claude") {
    return runClaude({
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
  throw new Error(`runProvider: unknown provider=${provider}`);
}

export function providerKillGraceMs(options: CliOptions = {}) {
  const raw = options?.["kill-grace-ms"] ?? "5000";
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`--kill-grace-ms must be a non-negative integer`);
  }
  return n;
}
