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
  const args: string[] = [
    "-p",
    inv.prompt,
    "--add-dir",
    inv.cwd,
  ];
  if (inv.editable) {
    args.push("--permission-mode", "bypassPermissions");
  }
  if (inv.jsonSchema) {
    // --json-schema only constrains structured output; without
    // --output-format json claude still prints its prose. Pair them so
    // stdout becomes a single JSON object matching the schema.
    args.push(
      "--json-schema",
      JSON.stringify(inv.jsonSchema),
      "--output-format",
      "json",
    );
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

      let jsonOutput: unknown;
      let text = stdout;
      if (jsonSchema) {
        // claude --json-schema --output-format json emits a result envelope
        // like { type: "result", result: "...", structured_output: {...} }.
        // The actual schema-conforming object lives in `structured_output`.
        try {
          const envelope = JSON.parse(stdout);
          if (envelope && typeof envelope === "object") {
            const env = envelope as Record<string, unknown>;
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
              });
            }
            if (
              "structured_output" in env &&
              env.structured_output !== null &&
              env.structured_output !== undefined
            ) {
              jsonOutput = env.structured_output;
              text = typeof env.result === "string" ? env.result : "";
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
              jsonOutput = undefined;
              text = typeof env.result === "string" ? env.result : "";
            }
          }
        } catch {
          // fall through; caller will treat as failure if jsonOutput required
        }
      }

      resolve({
        text,
        jsonOutput,
        exitCode: code ?? -1,
        stderrTail,
        timedOut,
      });
    });
  });
}
