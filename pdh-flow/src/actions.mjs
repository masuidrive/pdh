import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const NOTE_HEADINGS_BY_STEP = {
  "PD-C-5": ["## PD-C-3. 計画", "## PD-C-4. 計画レビュー結果"],
  "PD-C-8": ["## PD-C-8. 目的妥当性確認"],
  "PD-C-10": [
    "## PD-C-9. AC 裏取り結果",
    "## PD-C-8. 目的妥当性確認",
    "## PD-C-7. 品質検証結果"
  ]
};

const TICKET_HEADINGS_BY_STEP = {
  "PD-C-5": "## Implementation Notes",
  "PD-C-10": "## Product AC"
};

export function gateNoteHeadingsFor(stepId) {
  return NOTE_HEADINGS_BY_STEP[stepId] ?? [];
}

export function gateTicketHeadingFor(stepId) {
  return TICKET_HEADINGS_BY_STEP[stepId] ?? null;
}

export function gateDecisionText(stepId) {
  if (stepId === "PD-C-5") {
    return "Approve implementation start, reject, or request changes to the plan.";
  }
  if (stepId === "PD-C-8") {
    return "Approve to proceed to PD-C-9, or rerun from PD-C-3 (plan) / PD-C-6 (implementation).";
  }
  if (stepId === "PD-C-10") {
    return "Approve ticket close, reject, or request changes before close.";
  }
  return "Approve, reject, or request changes.";
}

export function commitStep({ repoPath, stepId, message, ticket = null }) {
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
    if (ticket) {
      tagStepCommit({ repoPath, ticket, stepId });
    }
    return { status: "skipped", message: "No changes to commit" };
  }
  const commitMessage = `[${stepId}] ${summary}`;
  run("git", ["commit", "-m", commitMessage], repoPath);
  const rev = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoPath, text: true, encoding: "utf8" });
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
  const result = spawnSync("git", ["tag", "-f", tag, "HEAD"], { cwd: repoPath, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(`pdh-flow: warning: failed to set tag ${tag}: ${(result.stderr || result.stdout || "").trim()}\n`);
  }
}

export function archivePriorRunTag({ repoPath, run }) {
  if (!run?.ticket_id) return null;
  const safeTicket = String(run.ticket_id).replace(/[^A-Za-z0-9._-]/g, "-");
  const stepPart = run.current_step_id ? String(run.current_step_id).replace(/[^A-Za-z0-9._-]/g, "-") : "unknown";
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const tag = `pdh-flow-archive/${safeTicket}/${stamp}-${stepPart}`;
  const result = spawnSync("git", ["tag", "-f", tag, "HEAD"], { cwd: repoPath, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(`pdh-flow: warning: failed to set archive tag ${tag}: ${(result.stderr || result.stdout || "").trim()}\n`);
    return null;
  }
  return tag;
}

export function ticketStart({ repoPath, ticket }) {
  if (!ticket) {
    throw new Error("ticket is required");
  }
  return runTicket(repoPath, ["start", ticket]);
}

export function ticketClose({ repoPath, args = [] }) {
  return runTicket(repoPath, ["close", ...args]);
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
