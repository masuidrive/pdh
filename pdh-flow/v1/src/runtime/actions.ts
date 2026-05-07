import { existsSync } from "node:fs";
import { join } from "node:path";
import { CommandExecutionError, runCommand, runCommandResult } from "../support/command.ts";
import { getStep, loadFlow } from "../flow/load.ts";

export function gateNoteHeadingsFor(stepId) {
  const display = stepDisplay(stepId);
  return Array.isArray(display.readNoteHeadings) ? display.readNoteHeadings : [];
}

export function gateTicketHeadingFor(stepId) {
  const display = stepDisplay(stepId);
  return typeof display.readTicketHeading === "string" ? display.readTicketHeading : null;
}

export function gateDecisionText(stepId) {
  const display = stepDisplay(stepId);
  return typeof display.decision === "string" ? display.decision : "Approve, reject, or request changes.";
}

export function stepCommitSummary(stepId) {
  const step = flowStep(stepId);
  return typeof step?.commitSummary === "string" ? step.commitSummary : `${stepId} step output`;
}

export function commitStep({ repoPath, stepId, message, ticket = null }) {
  if (!stepId) {
    throw new Error("stepId is required");
  }
  const summary = message || stepId;
  stageCommitChanges(repoPath);
  const status = runCommand("git", ["status", "--porcelain"], { cwd: repoPath });
  if (!status.stdout.trim()) {
    if (ticket) {
      tagStepCommit({ repoPath, ticket, stepId });
    }
    return { status: "skipped", message: "No changes to commit" };
  }
  const commitMessage = `[${stepId}] ${summary}`;
  run("git", ["commit", "-m", commitMessage], repoPath);
  const rev = runCommand("git", ["rev-parse", "--short", "HEAD"], { cwd: repoPath });
  if (ticket) {
    tagStepCommit({ repoPath, ticket, stepId });
  }
  return { status: "committed", message: commitMessage, commit: rev.stdout.trim() };
}

export function stepRecoveryTag({ ticket, stepId }) {
  if (!ticket || !stepId) return null;
  const safeTicket = String(ticket).replace(/[^A-Za-z0-9._-]/g, "-");
  const safeStep = String(stepId).replace(/[^A-Za-z0-9._-]/g, "-");
  return `pdh-flow/${safeTicket}/${safeStep}`;
}

function tagStepCommit({ repoPath, ticket, stepId }) {
  const tag = stepRecoveryTag({ ticket, stepId });
  if (!tag) return;
  const result = runCommandResult("git", ["tag", "-f", tag, "HEAD"], { cwd: repoPath });
  if (!result.ok) {
    process.stderr.write(`pdh-flow: warning: failed to set tag ${tag}: ${new CommandExecutionError(result).message}\n`);
  }
}

export function archivePriorRunTag({ repoPath, run }) {
  if (!run?.ticket_id) return null;
  const safeTicket = String(run.ticket_id).replace(/[^A-Za-z0-9._-]/g, "-");
  const stepPart = run.current_step_id ? String(run.current_step_id).replace(/[^A-Za-z0-9._-]/g, "-") : "unknown";
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const tag = `pdh-flow-archive/${safeTicket}/${stamp}-${stepPart}`;
  const result = runCommandResult("git", ["tag", "-f", tag, "HEAD"], { cwd: repoPath });
  if (!result.ok) {
    process.stderr.write(`pdh-flow: warning: failed to set archive tag ${tag}: ${new CommandExecutionError(result).message}\n`);
    return null;
  }
  return tag;
}

export function ticketStart({ repoPath, ticket, worktree = false }) {
  if (!ticket) {
    throw new Error("ticket is required");
  }
  const args = worktree ? ["start", "--worktree", ticket] : ["start", ticket];
  const result = runTicket(repoPath, args);
  let worktreePath = null;
  if (worktree) {
    worktreePath = findTicketWorktreePath({ repoPath, ticket });
  }
  return { ...result, worktreePath };
}

export function ticketClose({ repoPath, args = [] }) {
  return runTicket(repoPath, ["close", ...args]);
}

// Probe whether `ticket.sh close` would succeed without performing it.
// Exits non-zero on collision, dirty main, merge conflict, etc. Never
// mutates the repo. Returns a structured result instead of throwing so
// callers can route on the failure mode.
export function ticketCloseDryRun({ repoPath, args = [] }) {
  const script = join(repoPath, "ticket.sh");
  if (!existsSync(script)) {
    return { ok: false, available: false, exitCode: null, stdout: "", stderr: `ticket.sh not found in ${repoPath}` };
  }
  const result = runCommandResult(script, ["close", "--dry-run", ...args], { cwd: repoPath });
  return {
    ok: result.ok,
    available: true,
    exitCode: result.exitCode,
    stdout: result.stdout.trim(),
    stderr: result.ok ? result.stderr.trim() : new CommandExecutionError(result).message
  };
}

export function findTicketWorktreePath({ repoPath, ticket }) {
  const result = runCommandResult("git", ["worktree", "list", "--porcelain"], { cwd: repoPath });
  if (!result.ok) {
    process.stderr.write(`pdh-flow: warning: failed to list worktrees: ${new CommandExecutionError(result).message}\n`);
    return null;
  }
  const blocks = String(result.stdout).split("\n\n");
  for (const block of blocks) {
    const wtMatch = block.match(/^worktree (.+)$/m);
    if (!wtMatch) continue;
    const path = wtMatch[1].trim();
    if (!path || path === repoPath) continue;
    const branchMatch = block.match(/^branch refs\/heads\/(.+)$/m);
    const branch = branchMatch ? branchMatch[1].trim() : "";
    if (branch === ticket || branch.endsWith(`/${ticket}`)) {
      return path;
    }
    if (path.endsWith(`/${ticket}`)) {
      return path;
    }
  }
  return null;
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
  return runCommand(command, args, { cwd });
}

function stageCommitChanges(repoPath) {
  run("git", ["add", "-u", "--", "."], repoPath);
  const untracked = runCommand("git", ["ls-files", "-o", "--exclude-standard", "-z"], {
    cwd: repoPath,
    encoding: null
  });
  const untrackedPaths = untracked.stdoutBuffer;
  if (untrackedPaths.length === 0) {
    return;
  }
  const untrackedArgs = untrackedPaths
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (untrackedArgs.length === 0) {
    return;
  }
  run("git", ["add", "--", ...untrackedArgs], repoPath);
}

function stepDisplay(stepId) {
  return flowStep(stepId)?.display ?? {};
}

function flowStep(stepId) {
  try {
    return getStep(loadFlow(), stepId);
  } catch {
    return null;
  }
}
