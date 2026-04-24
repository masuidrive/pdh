import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRedactor } from "./redaction.mjs";

export function writeFailureSummary({
  stateDir,
  repoPath,
  runId,
  stepId,
  reason,
  provider = "runtime",
  status = "failed",
  attempt = null,
  maxAttempts = null,
  exitCode = null,
  timedOut = false,
  timeoutKind = null,
  signal = null,
  rawLogPath = null,
  finalMessage = null,
  stderr = null,
  failedGuards = [],
  message = null,
  nextCommands = []
}) {
  const artifactDir = join(stateDir, "runs", runId, "steps", stepId);
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "failure-summary.md");
  const redact = createRedactor({ repoPath });
  const body = redact(renderFailureSummary({
    runId,
    stepId,
    reason,
    provider,
    status,
    attempt,
    maxAttempts,
    exitCode,
    timedOut,
    timeoutKind,
    signal,
    rawLogPath,
    finalMessage,
    stderr,
    failedGuards,
    message,
    nextCommands
  }));
  writeFileSync(artifactPath, body);
  return { artifactPath, body };
}

function renderFailureSummary({
  runId,
  stepId,
  reason,
  provider,
  status,
  attempt,
  maxAttempts,
  exitCode,
  timedOut,
  timeoutKind,
  signal,
  rawLogPath,
  finalMessage,
  stderr,
  failedGuards,
  message,
  nextCommands
}) {
  const lines = [
    "# PDH Flow Failure Summary",
    "",
    `- Run: ${runId}`,
    `- Step: ${stepId}`,
    `- Status: ${status}`,
    `- Reason: ${reason}`,
    `- Provider: ${provider}`,
    `- Attempt: ${attempt ?? "-"}${maxAttempts ? `/${maxAttempts}` : ""}`,
    `- Exit code: ${exitCode ?? "-"}`,
    `- Timed out: ${timedOut ? "yes" : "no"}`,
    `- Timeout kind: ${timeoutKind ?? "-"}`,
    `- Signal: ${signal ?? "-"}`,
    `- Raw log: ${rawLogPath ?? "-"}`,
    "",
    "## Failed Guards",
    ""
  ];

  if (failedGuards.length) {
    for (const guard of failedGuards) {
      lines.push(`- ${guard.guardId ?? guard.id ?? "(unknown)"} (${guard.type ?? "unknown"}): ${guard.evidence ?? ""}`);
    }
  } else {
    lines.push("- (none)");
  }

  if (message) {
    lines.push("", "## Diagnosis", "", `- ${message}`);
  }

  lines.push("", "## Provider Output", "");
  if (finalMessage) {
    lines.push("Final message:", "", fenced(finalMessage), "");
  }
  if (stderr) {
    lines.push("stderr:", "", fenced(stderr), "");
  }
  if (!finalMessage && !stderr) {
    lines.push("(none)", "");
  }

  lines.push("## Next Commands", "");
  if (nextCommands.length) {
    for (const command of nextCommands) {
      lines.push(`- \`${command}\``);
    }
  } else {
    lines.push("- (none)");
  }
  lines.push("");
  return lines.join("\n");
}

function fenced(value) {
  return `\`\`\`text\n${String(value).trim()}\n\`\`\``;
}
