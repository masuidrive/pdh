// API-direct judge via Vercel ai-sdk (Anthropic / OpenAI).
//
// Why this exists: the CLI subprocess path (claude -p --json-schema) does not
// reliably enforce structured output in agentic mode — claude can emit raw
// JSON in markdown fences, YAML, or skip the structured_output field
// entirely. For LLM-as-judge, the engine needs a deterministic JSON contract.
//
// This module uses @ai-sdk/{anthropic,openai} `generateObject()` which calls
// the underlying tool_use / response_format APIs to enforce schema adherence
// at the model level. Returns a typed JSON object or throws.
//
// Auth: API key only (process.env.ANTHROPIC_API_KEY / OPENAI_API_KEY).
// Subscription tokens via SDK direct are forbidden by ToS; we never read
// CLI subscription credentials here.

import { generateObject, jsonSchema, NoObjectGeneratedError } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

export interface ApiJudgeRequest {
  prompt: string;
  schema: Record<string, unknown>;
  /** Wall-clock cap per call. */
  timeoutMs?: number;
  /** Aborts the in-flight request. */
  signal?: AbortSignal;
}

export interface ApiJudgeResult {
  /** The schema-validated JSON object emitted by the model. */
  object: unknown;
  provider: "anthropic-api" | "openai-api";
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;

/** Strategy for picking which API provider to use. */
export interface JudgeProviderConfig {
  provider: "anthropic-api" | "openai-api";
  /** Anthropic: e.g. "claude-sonnet-4-6" / "claude-opus-4-7" / "claude-haiku-4-5".
   *  OpenAI: e.g. "gpt-5" / "gpt-5-mini". */
  model: string;
  apiKey: string;
}

/**
 * Detect which API provider to use based on environment.
 *
 *   - PDH_JUDGE_PROVIDER=anthropic-api → require ANTHROPIC_API_KEY
 *   - PDH_JUDGE_PROVIDER=openai-api    → require OPENAI_API_KEY
 *   - unset:
 *       prefer ANTHROPIC_API_KEY → OPENAI_API_KEY
 *       returns null if neither is set (caller falls back to CLI)
 *
 * Model defaults can be overridden via PDH_JUDGE_MODEL.
 */
export function detectJudgeConfig(): JudgeProviderConfig | null {
  const wantedProvider = process.env.PDH_JUDGE_PROVIDER;
  const modelOverride = process.env.PDH_JUDGE_MODEL;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (wantedProvider === "anthropic-api") {
    if (!anthropicKey) {
      throw new Error(
        "PDH_JUDGE_PROVIDER=anthropic-api but ANTHROPIC_API_KEY is not set",
      );
    }
    return {
      provider: "anthropic-api",
      model: modelOverride ?? "claude-sonnet-4-6",
      apiKey: anthropicKey,
    };
  }
  if (wantedProvider === "openai-api") {
    if (!openaiKey) {
      throw new Error(
        "PDH_JUDGE_PROVIDER=openai-api but OPENAI_API_KEY is not set",
      );
    }
    return {
      provider: "openai-api",
      model: modelOverride ?? "gpt-5-mini",
      apiKey: openaiKey,
    };
  }
  if (wantedProvider === "claude-cli") {
    return null; // explicit CLI fallback
  }
  if (wantedProvider && wantedProvider !== "auto") {
    throw new Error(
      `unknown PDH_JUDGE_PROVIDER=${wantedProvider} (allowed: anthropic-api, openai-api, claude-cli, auto)`,
    );
  }
  // Auto detect: prefer Anthropic, then OpenAI, else null (CLI).
  if (anthropicKey) {
    return {
      provider: "anthropic-api",
      model: modelOverride ?? "claude-sonnet-4-6",
      apiKey: anthropicKey,
    };
  }
  if (openaiKey) {
    return {
      provider: "openai-api",
      model: modelOverride ?? "gpt-5-mini",
      apiKey: openaiKey,
    };
  }
  return null;
}

export async function invokeApiJudge(
  cfg: JudgeProviderConfig,
  req: ApiJudgeRequest,
): Promise<ApiJudgeResult> {
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  if (req.signal) {
    if (req.signal.aborted) ac.abort();
    else req.signal.addEventListener("abort", () => ac.abort(), { once: true });
  }
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const model = pickModel(cfg);
    const result = await generateObject({
      model,
      schema: jsonSchema(req.schema as Parameters<typeof jsonSchema>[0]),
      prompt: req.prompt,
      abortSignal: ac.signal,
    });

    return {
      object: result.object,
      provider: cfg.provider,
      model: cfg.model,
      usage: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        totalTokens: result.usage?.totalTokens,
      },
    };
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) {
      // ai-sdk couldn't get a parsable object — surface diagnostics.
      throw new Error(
        `[${cfg.provider}/${cfg.model}] generateObject produced no valid object: ${err.message}\n` +
          `cause: ${err.cause ? String(err.cause) : "(none)"}\n` +
          `text: ${err.text?.slice(0, 1500) ?? "(empty)"}`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function pickModel(cfg: JudgeProviderConfig) {
  if (cfg.provider === "anthropic-api") {
    const anthropic = createAnthropic({ apiKey: cfg.apiKey });
    return anthropic(cfg.model);
  }
  const openai = createOpenAI({ apiKey: cfg.apiKey });
  return openai(cfg.model);
}
