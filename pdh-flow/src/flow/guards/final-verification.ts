import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateAcVerificationTable } from "./ac-verification.ts";
import { CommandExecutionError, runCommandResult } from "../../support/command.ts";

const SECTION = "## PD-C-9. プロセスチェックリスト";

export function runFinalVerification({ repoPath, stateDir, runId, stepId = "PD-C-9", command = null }) {
  const commandResult = runVerificationCommand({ repoPath, command });
  const ac = evaluateAcVerificationTable({ repoPath, allowUnverified: false });
  const artifactDir = join(stateDir, "runs", runId, "steps", stepId);
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "final-verification.json");
  const result = {
    status: commandResult.ok && ac.ok ? "passed" : "failed",
    at: new Date().toISOString(),
    command: commandResult,
    ac: {
      ok: ac.ok,
      counts: ac.counts,
      errors: ac.errors,
      rows: ac.rows
    }
  };
  writeFileSync(artifactPath, JSON.stringify(result, null, 2));
  upsertProcessChecklist({ repoPath, result, artifactPath });
  return { artifactPath, result };
}

function runVerificationCommand({ repoPath, command }) {
  const selected = command ?? (existsSync(join(repoPath, "scripts", "test-all.sh")) ? "scripts/test-all.sh" : null);
  if (!selected) {
    return { status: "skipped", ok: true, command: null, reason: "scripts/test-all.sh not found and --command was not provided" };
  }
  const result = runCommandResult(selected, [], {
    cwd: repoPath,
    shell: true,
    timeout: 30000
  });
  const errorMessage = result.ok ? "" : new CommandExecutionError(result, { timeoutMs: 30000 }).message;
  return {
    status: result.ok ? "passed" : "failed",
    ok: result.ok,
    command: selected,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    stdout: result.stdout.slice(-4000),
    stderr: result.stderr.slice(-4000),
    error: errorMessage || null
  };
}

function upsertProcessChecklist({ repoPath, result, artifactPath }) {
  const path = join(repoPath, "current-note.md");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "# Note\n";
  const body = [
    SECTION,
    "",
    `- [${result.command.ok ? "x" : " "}] Verification command ${result.command.status}${result.command.command ? `: \`${result.command.command}\`` : ""}`,
    `- [${result.ac.ok ? "x" : " "}] AC verification table parsed (${statusCounts(result.ac.counts)})`,
    `- Artifact: ${artifactPath}`,
    ...(result.ac.errors.length ? ["", "Errors:", ...result.ac.errors.map((error) => `- ${error}`)] : []),
    ""
  ].join("\n");
  writeFileSync(path, replaceSection(existing, SECTION, body));
}

function replaceSection(text, heading, body) {
  const index = text.indexOf(heading);
  if (index < 0) {
    return `${text.trimEnd()}\n\n${body}`;
  }
  const after = text.slice(index + heading.length);
  const nextHeading = after.search(/\n#{1,6}\s+/);
  if (nextHeading < 0) {
    return `${text.slice(0, index).trimEnd()}\n\n${body}`;
  }
  return `${text.slice(0, index).trimEnd()}\n\n${body}${after.slice(nextHeading)}`;
}

function statusCounts(counts) {
  return `verified=${counts.verified} deferred=${counts.deferred} unverified=${counts.unverified} invalid=${counts.invalid}`;
}
