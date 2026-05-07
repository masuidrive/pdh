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
          if (
            envelope &&
            typeof envelope === "object" &&
            "structured_output" in envelope &&
            envelope.structured_output !== null
          ) {
            jsonOutput = envelope.structured_output;
            text = typeof envelope.result === "string" ? envelope.result : "";
          } else {
            // Older / different shape: try the envelope itself if it matches.
            jsonOutput = envelope;
            text = "";
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
