import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRedactor } from "./redaction.mjs";
import { extractSection } from "./note-state.mjs";

export function createGateSummary({ repoPath, stateDir, runId, stepId, gate = null }) {
  const ticketPath = join(repoPath, "current-ticket.md");
  const notePath = join(repoPath, "current-note.md");
  const redact = createRedactor({ repoPath });
  const ticketRaw = existsSync(ticketPath) ? readFileSync(ticketPath, "utf8") : "";
  const noteRaw = existsSync(notePath) ? readFileSync(notePath, "utf8") : "";
  const artifactDir = join(stateDir, "runs", runId, "steps", stepId);
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "human-gate-summary.md");

  const lines = [
    `# Human Gate Summary: ${stepId}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Decision Required",
    gateDecisionText(stepId),
    "",
    ...renderGateContext(gate),
    "",
    ...renderPointers(stepId, ticketRaw, noteRaw),
    "",
    ...renderRelevantSections(stepId, ticketRaw, noteRaw, redact),
  ];
  const body = lines.filter((line, i, arr) => !(line === "" && arr[i - 1] === "")).join("\n").trimEnd() + "\n";
  writeFileSync(artifactPath, body);
  return { artifactPath, body };
}

function renderPointers(stepId, ticketRaw, noteRaw) {
  const pointers = ["## What to read (pointers)", ""];
  const noteHeadings = noteHeadingsFor(stepId);
  if (ticketRaw) {
    const ticketSection = ticketHeadingFor(stepId);
    pointers.push(`- \`current-ticket.md\`${ticketSection ? ` → ${ticketSection}` : ""}`);
  } else {
    pointers.push("- `current-ticket.md` (missing)");
  }
  if (noteRaw && noteHeadings.length) {
    for (const h of noteHeadings) {
      pointers.push(`- \`current-note.md\` → ${h}`);
    }
  } else if (!noteRaw) {
    pointers.push("- `current-note.md` (missing)");
  }
  return pointers;
}

function renderRelevantSections(stepId, ticketRaw, noteRaw, redact) {
  const out = [];
  const ticketSection = ticketHeadingFor(stepId);
  const ticketExcerpt = ticketSection ? extractSectionExcerpt(ticketRaw, ticketSection, redact) : "";
  if (ticketExcerpt) {
    out.push(`## current-ticket.md > ${ticketSection}`, "", ticketExcerpt, "");
  }
  for (const heading of noteHeadingsFor(stepId)) {
    const excerpt = extractSectionExcerpt(noteRaw, heading, redact);
    if (excerpt) {
      out.push(`## current-note.md > ${heading}`, "", excerpt, "");
    }
  }
  if (out.length === 0) {
    out.push("## Source", "", "(該当 step の note セクションがまだ書かれていません。runtime / agent が durable な evidence を残す前にこの gate に到達しています。)", "");
  }
  return out;
}

function extractSectionExcerpt(raw, heading, redact, maxLines = 40) {
  if (!raw) return "";
  const section = extractSection(raw, heading);
  if (!section) return "";
  const trimmed = redact(section).split(/\r?\n/);
  if (trimmed.length <= maxLines) return trimmed.join("\n").trim();
  return [...trimmed.slice(0, maxLines), "", `… (truncated, ${trimmed.length - maxLines} more lines — see current-note.md)`]
    .join("\n").trim();
}

const NOTE_HEADINGS_BY_STEP = {
  "PD-C-5": ["## PD-C-3. 計画", "## PD-C-4. 計画レビュー結果"],
  "PD-C-10": [
    "## PD-C-9. AC 裏取り結果",
    "## PD-C-8. 目的妥当性確認",
    "## PD-C-7. 品質検証結果"
  ]
};

function noteHeadingsFor(stepId) {
  return NOTE_HEADINGS_BY_STEP[stepId] ?? [];
}

const TICKET_HEADINGS_BY_STEP = {
  "PD-C-5": "## Implementation Notes",
  "PD-C-10": "## Product AC"
};

function ticketHeadingFor(stepId) {
  return TICKET_HEADINGS_BY_STEP[stepId] ?? null;
}

function renderGateContext(gate) {
  const baseline = gate?.baseline ?? null;
  const rerunRequirement = gate?.rerun_requirement ?? null;
  const lines = ["## Gate Context", ""];
  if (baseline?.commit) {
    lines.push(`- Baseline commit: \`${baseline.commit.slice(0, 7)}\`${baseline.step_id ? ` from ${baseline.step_id}` : ""}`);
  } else {
    lines.push("- Baseline commit: (none)");
  }
  if (rerunRequirement?.target_step_id) {
    lines.push(`- Required rerun target if gate edits continue: \`${rerunRequirement.target_step_id}\``);
    if (rerunRequirement.reason) {
      lines.push(`- Why: ${rerunRequirement.reason}`);
    }
    if (Array.isArray(rerunRequirement.changed_files) && rerunRequirement.changed_files.length > 0) {
      lines.push(`- Changed since baseline: ${rerunRequirement.changed_files.join(", ")}`);
    }
    if (Array.isArray(rerunRequirement.changed_ticket_sections) && rerunRequirement.changed_ticket_sections.length > 0) {
      lines.push(`- Ticket sections changed: ${rerunRequirement.changed_ticket_sections.join(", ")}`);
    }
    if (Array.isArray(rerunRequirement.changed_note_sections) && rerunRequirement.changed_note_sections.length > 0) {
      lines.push(`- Note sections changed: ${rerunRequirement.changed_note_sections.join(", ")}`);
    }
  } else {
    lines.push("- Required rerun target if gate edits continue: (none)");
  }
  return lines;
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

function gateDecisionText(stepId) {
  if (stepId === "PD-C-5") {
    return "Approve implementation start, reject, or request changes to the plan.";
  }
  if (stepId === "PD-C-10") {
    return "Approve ticket close, reject, or request changes before close.";
  }
  return "Approve, reject, or request changes.";
}
