// Provider invocation interface for the v2 engine.
//
// Wraps `claude -p ...` and `codex exec ...` subprocess calls behind one
// shape. Subscription auth flows through the user's already-authenticated
// CLI; the engine never touches OAuth tokens.
//
// For Phase G (Option A) prototype: claude path uses --json-schema for
// structured output; codex path uses --output-schema (file-based).
// Both return the same ProviderResult.

import { invokeClaude } from "./claude.ts";
import { invokeCodex } from "./codex.ts";

export interface ProviderInvocation {
  /** Prompt body (the role / focus / output format guidance). */
  prompt: string;
  /** Worktree the provider operates in (cwd + read access). */
  cwd: string;
  /** When set, provider must produce JSON matching this schema. */
  jsonSchema?: Record<string, unknown>;
  /** Hard wall-clock cap. Default 5 min. */
  timeoutMs?: number;
  /** Abort signal from XState actor cancellation. */
  signal?: AbortSignal;
  /**
   * Allow the provider to edit files in `cwd`. Required for implementer /
   * repair roles. Defaults to false (read-only). When true:
   *   - claude: --permission-mode bypassPermissions
   *   - codex:  --sandbox workspace-write
   */
  editable?: boolean;
  /**
   * Resume a prior provider session by id. When set:
   *   - claude: invoke `claude --resume <id> -p <prompt>`. The session id
   *     comes from a previous ProviderResult.sessionId.
   *   - codex:  invoke `codex exec resume <id> [prompt]`. Note that
   *     `codex exec resume` inherits cwd/sandbox from the recorded session
   *     and does not accept --cd / --sandbox / --output-schema flags, so
   *     passing those is a no-op when this is set.
   *
   * Used by F-001 (engineer-resume for repair) and F-012 (in-step
   * user-input turn loop). When the underlying CLI rejects the resume
   * (e.g. session expired, file deleted), the provider returns a non-zero
   * exit; callers should fall back to a fresh invocation with the original
   * prompt + accumulated turn history.
   */
  resumeSessionId?: string;
}

export interface ProviderResult {
  /** Final assistant text (or empty string if jsonSchema produced raw JSON only). */
  text: string;
  /** Parsed JSON if jsonSchema was passed and provider returned valid JSON. */
  jsonOutput?: unknown;
  exitCode: number;
  stderrTail: string;
  /** True if process exceeded timeoutMs. */
  timedOut: boolean;
  /**
   * Provider-side session id, when the CLI exposes one. Used by F-001
   * (engineer-resume) and F-012 (in-step user-input turn loop) to re-invoke
   * the same conversation via `claude --resume <id>` or
   * `codex exec resume <id>`. May be undefined when the CLI didn't surface
   * one (e.g. claude without --output-format json, or a probe that errored
   * before thread.started).
   */
  sessionId?: string;
}

export type ProviderName = "claude" | "codex";

export async function invokeProvider(
  provider: ProviderName,
  inv: ProviderInvocation,
): Promise<ProviderResult> {
  switch (provider) {
    case "claude":
      return invokeClaude(inv);
    case "codex":
      return invokeCodex(inv);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unsupported provider: ${_exhaustive}`);
    }
  }
}
