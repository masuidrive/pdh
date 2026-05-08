// codex CLI subprocess wrapper.
//
// Spawns `codex exec --json` (always JSONL event stream) with optional
// `--output-schema <file>` for structured output. The schema must be
// written to a temp file (codex doesn't take it inline). Subscription
// auth flows through the user's existing codex session.
//
// We always run in --json mode so we can capture `thread.started.thread_id`
// (the codex session id) for F-001 (engineer-resume) / F-012 (in-step turn
// loop). The final assistant text comes from the last `item.completed`
// event whose `item.type === "agent_message"`.

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
    const args: string[] = inv.resumeSessionId
      ? // `codex exec resume <id> [args] [prompt]` continues a recorded
        // session. The resume subcommand inherits cwd / sandbox /
        // output-schema from the recorded session, so we don't pass
        // --cd / --sandbox / --output-schema here.
        [
          "exec",
          "resume",
          inv.resumeSessionId,
          "--skip-git-repo-check",
          "--json",
        ]
      : ["exec", "--cd", inv.cwd, "--skip-git-repo-check", "--json"];
    if (!inv.resumeSessionId) {
      if (inv.editable) {
        // Default codex sandbox is read-only; raise to workspace-write so
        // implementer / repair roles can apply patches.
        args.push("--sandbox", "workspace-write");
      }
      if (inv.jsonSchema) {
        schemaTempDir = mkdtempSync(join(tmpdir(), "pdh-codex-schema-"));
        const schemaPath = join(schemaTempDir, "schema.json");
        writeFileSync(schemaPath, JSON.stringify(inv.jsonSchema));
        args.push("--output-schema", schemaPath);
      }
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

      // Parse JSONL event stream. Skip non-JSON lines (codex sometimes
      // prints banners or status text outside the event stream). Capture:
      //   - thread.started.thread_id  → sessionId
      //   - last item.completed where item.type==="agent_message" → text
      let sessionId: string | undefined;
      let agentMessageText = "";
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let evt: unknown;
        try {
          evt = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (!evt || typeof evt !== "object") continue;
        const e = evt as Record<string, unknown>;
        if (e.type === "thread.started" && typeof e.thread_id === "string") {
          sessionId = e.thread_id;
        } else if (e.type === "item.completed" && e.item && typeof e.item === "object") {
          const item = e.item as Record<string, unknown>;
          if (item.type === "agent_message" && typeof item.text === "string") {
            agentMessageText = item.text;
          }
        }
      }

      let text = agentMessageText || stdout;
      let jsonOutput: unknown;
      if (jsonSchema) {
        // With --output-schema, codex writes the schema-conforming object
        // as the final agent_message text. Parse it as JSON.
        const candidate = agentMessageText.trim();
        if (candidate) {
          try {
            jsonOutput = JSON.parse(candidate);
            text = "";
          } catch {
            const match = candidate.match(/\{[\s\S]*\}\s*$/);
            if (match) {
              try {
                jsonOutput = JSON.parse(match[0]);
                text = candidate.slice(0, match.index ?? 0);
              } catch {
                // caller treats missing jsonOutput as failure
              }
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
        sessionId,
      });
    });
  });
}
