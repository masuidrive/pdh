// claude CLI subprocess wrapper.
//
// Spawns `claude -p <prompt>` with optional `--json-schema` for structured
// output. Subscription auth happens via the user's existing claude session
// (we never touch OAuth tokens).

import { spawn } from "node:child_process";
import type { ProviderInvocation, ProviderResult } from "./index.ts";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export async function invokeClaude(
  inv: ProviderInvocation,
): Promise<ProviderResult> {
  // Always request --output-format json so we can capture session_id from
  // the result envelope, even for plain provider_step runs (no schema).
  // The envelope's `result` field is what previous "text" mode emitted, so
  // callers see the same text either way.
  const args: string[] = [
    "-p",
    inv.prompt,
    "--add-dir",
    inv.cwd,
    "--output-format",
    "json",
  ];
  if (inv.resumeSessionId) {
    // Continue an existing conversation. -p still supplies the new user
    // message; --resume points at the prior session by id.
    args.push("--resume", inv.resumeSessionId);
  }
  if (inv.editable) {
    args.push("--permission-mode", "bypassPermissions");
  }
  if (inv.jsonSchema) {
    args.push("--json-schema", JSON.stringify(inv.jsonSchema));
  }

  const timeoutMs = inv.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return runProcess("claude", args, inv.cwd, timeoutMs, inv.signal, inv.jsonSchema);
}

async function runProcess(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
  jsonSchema: Record<string, unknown> | undefined,
): Promise<ProviderResult> {
  return new Promise<ProviderResult>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let killed = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch {}
      // Force kill if still alive after 5s grace.
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000);
    }, timeoutMs);

    const onAbort = () => {
      killed = true;
      try { child.kill("SIGTERM"); } catch {}
    };
    if (externalSignal) {
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout?.on("data", (b: Buffer) => stdoutChunks.push(b));
    child.stderr?.on("data", (b: Buffer) => stderrChunks.push(b));

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const stderrTail = stderr.slice(-2000);

      // claude --output-format json always emits a result envelope:
      //   { type: "result", result: "...", session_id: "...",
      //     structured_output?: {...}, is_error?: bool, stop_reason?: ... }
      // We always parse it so session_id is captured for F-001
      // (engineer-resume) / F-012 (in-step turn loop), and the schema-
      // constrained `structured_output` is surfaced to the caller as
      // `jsonOutput`.
      let jsonOutput: unknown;
      let text = stdout;
      let sessionId: string | undefined;
      try {
        const envelope = JSON.parse(stdout);
        if (envelope && typeof envelope === "object") {
          const env = envelope as Record<string, unknown>;
          if (typeof env.session_id === "string" && env.session_id.length > 0) {
            sessionId = env.session_id;
          }
          if (env.is_error === true) {
            // Surface the real cause (API error, rate limit, permission
            // denial, etc.) instead of letting the envelope flow through
            // and trip downstream schema validation.
            const cause =
              typeof env.result === "string"
                ? env.result
                : `is_error=true (api_error_status=${String(env.api_error_status ?? "unknown")})`;
            process.stderr.write(
              `[claude] provider returned is_error=true. cause: ${cause}\n`,
            );
            return resolve({
              text: "",
              jsonOutput: undefined,
              exitCode: code ?? -1,
              stderrTail,
              timedOut,
              sessionId,
            });
          }
          // Always replace text with envelope.result so callers get the
          // assistant prose, not the JSON envelope as a string.
          text = typeof env.result === "string" ? env.result : "";
          if (jsonSchema) {
            if (
              "structured_output" in env &&
              env.structured_output !== null &&
              env.structured_output !== undefined
            ) {
              jsonOutput = env.structured_output;
            } else {
              // Schema requested but no structured_output produced. Log a
              // diagnostic — the caller will treat missing jsonOutput as a
              // failure. Do NOT flow the bare envelope through; downstream
              // Ajv would reject every meta field as additionalProperties.
              const resultPreview =
                typeof env.result === "string" ? env.result.slice(0, 1500) : "";
              process.stderr.write(
                `[claude] --json-schema requested but envelope has no structured_output. ` +
                  `stop_reason=${String(env.stop_reason ?? "unknown")} ` +
                  `terminal_reason=${String(env.terminal_reason ?? "unknown")}\n` +
                  (resultPreview ? `[claude] result preview:\n${resultPreview}\n` : ""),
              );
            }
          }
        }
      } catch {
        // Envelope parse failed (e.g. CLI error before producing JSON);
        // fall through with raw stdout in `text`. Caller will treat
        // missing jsonOutput as a failure when a schema was requested.
      }

      resolve({
        text,
        jsonOutput,
        exitCode: code ?? -1,
        stderrTail,
        timedOut,
        sessionId,
      });
    });
  });
}
