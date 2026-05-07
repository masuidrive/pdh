// codex CLI subprocess wrapper.
//
// Spawns `codex exec` with optional `--output-schema <file>` for structured
// output. The schema must be written to a temp file (codex doesn't take it
// inline). Subscription auth flows through the user's existing codex session.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderInvocation, ProviderResult } from "./index.ts";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export async function invokeCodex(
  inv: ProviderInvocation,
): Promise<ProviderResult> {
  let schemaTempDir: string | null = null;
  try {
    const args: string[] = ["exec", "--cd", inv.cwd, "--skip-git-repo-check"];
    if (inv.jsonSchema) {
      schemaTempDir = mkdtempSync(join(tmpdir(), "pdh-codex-schema-"));
      const schemaPath = join(schemaTempDir, "schema.json");
      writeFileSync(schemaPath, JSON.stringify(inv.jsonSchema));
      args.push("--output-schema", schemaPath);
    }
    args.push(inv.prompt);

    const timeoutMs = inv.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const result = await runProcess(
      "codex",
      args,
      inv.cwd,
      timeoutMs,
      inv.signal,
      inv.jsonSchema,
    );
    return result;
  } finally {
    if (schemaTempDir) {
      try { rmSync(schemaTempDir, { recursive: true, force: true }); } catch {}
    }
  }
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

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000);
    }, timeoutMs);

    const onAbort = () => {
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
        // codex with --output-schema emits the structured object as the
        // final stdout payload. codex may also print non-JSON status before
        // the object; for prototype simplicity we try JSON.parse on the
        // whole stdout, then fall back to extracting the last {...} block.
        try {
          jsonOutput = JSON.parse(stdout);
          text = "";
        } catch {
          const match = stdout.match(/\{[\s\S]*\}\s*$/);
          if (match) {
            try {
              jsonOutput = JSON.parse(match[0]);
              text = stdout.slice(0, match.index ?? 0);
            } catch {
              // fall through; caller will treat as failure
            }
          }
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
