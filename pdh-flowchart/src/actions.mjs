import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRedactor } from "./redaction.mjs";

export function createGateSummary({ repoPath, stateDir, runId, stepId }) {
  const ticketPath = join(repoPath, "current-ticket.md");
  const notePath = join(repoPath, "current-note.md");
  const redact = createRedactor({ repoPath });
  const ticket = redact(existsSync(ticketPath) ? readFileSync(ticketPath, "utf8") : "(missing current-ticket.md)");
  const note = redact(existsSync(notePath) ? readFileSync(notePath, "utf8") : "(missing current-note.md)");
  const artifactDir = join(stateDir, "runs", runId, "steps", stepId);
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "human-gate-summary.md");
  const body = [
    `# Human Gate Summary: ${stepId}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Decision Required",
    gateDecisionText(stepId),
    "",
    "## current-ticket.md",
    "",
    ticket.trim(),
    "",
    "## current-note.md",
    "",
    note.trim(),
    ""
  ].join("\n");
  writeFileSync(artifactPath, body);
  return { artifactPath, body };
}

export function commitStep({ repoPath, stepId, message }) {
  if (!stepId) {
    throw new Error("stepId is required");
  }
  const summary = message || stepId;
  stageCommitChanges(repoPath);
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: repoPath, text: true, encoding: "utf8" });
  if (status.status !== 0) {
    throw new Error((status.stderr || status.stdout || "git status failed").trim());
  }
  if (!status.stdout.trim()) {
    return { status: "skipped", message: "No changes to commit" };
  }
  const commitMessage = `[${stepId}] ${summary}`;
  run("git", ["commit", "-m", commitMessage], repoPath);
  const rev = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoPath, text: true, encoding: "utf8" });
  return { status: "committed", message: commitMessage, commit: rev.stdout.trim() };
}

export function ticketStart({ repoPath, ticket }) {
  if (!ticket) {
    throw new Error("ticket is required");
  }
  return runTicket(repoPath, ["start", ticket]);
}

export function ticketClose({ repoPath }) {
  return runTicket(repoPath, ["close"]);
}

function runTicket(repoPath, args) {
  const script = join(repoPath, "ticket.sh");
  if (!existsSync(script)) {
    throw new Error(`ticket.sh not found in ${repoPath}`);
  }
  const result = run(script, args, repoPath);
  return { status: "ok", stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, text: true, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} failed with ${result.status}`).trim());
  }
  return result;
}

function stageCommitChanges(repoPath) {
  run("git", ["add", "-u", "--", "."], repoPath);
  const untracked = spawnSync("git", ["ls-files", "-o", "--exclude-standard", "-z"], {
    cwd: repoPath,
    encoding: "utf8"
  });
  if (untracked.status !== 0) {
    throw new Error((untracked.stderr || untracked.stdout || "git ls-files failed").trim());
  }
  if (!untracked.stdout) {
    return;
  }
  const add = spawnSync("git", ["add", "--pathspec-from-file=-", "--pathspec-file-nul"], {
    cwd: repoPath,
    input: untracked.stdout,
    encoding: "utf8"
  });
  if (add.status !== 0) {
    throw new Error((add.stderr || add.stdout || "git add failed").trim());
  }
}

function gateDecisionText(stepId) {
  if (stepId === "PD-C-5") {
    return "Approve implementation start, reject, or request changes to the plan.";
  }
  if (stepId === "PD-C-10") {
    return "Approve ticket close, reject, or request changes before close.";
  }
  return "Approve, reject, or request changes.";
}
