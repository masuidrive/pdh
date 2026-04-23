import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getStep } from "./flow.mjs";

export function evaluateStepGuards(flow, stepId, context = {}) {
  const step = getStep(flow, stepId);
  const results = [];
  for (const guard of step.guards ?? []) {
    results.push(evaluateGuard(guard, context));
  }
  return results;
}

export function evaluateGuard(guard, context = {}) {
  const repo = context.repoPath ?? process.cwd();
  try {
    switch (guard.type) {
      case "file_exists":
        return passIf(guard, existsSync(join(repo, guard.path)), `${guard.path} exists`);
      case "note_section_updated":
      case "ticket_section_updated":
        return checkSection(guard, repo);
      case "git_commit_exists":
        return checkGitCommit(guard, repo);
      case "command":
        return checkCommand(guard, repo);
      case "ac_verification_table":
        return checkAcVerificationTable(guard, repo);
      case "artifact_exists":
        return checkArtifact(guard, context);
      case "human_approved":
        return passIf(guard, context.humanDecision === "approved", "human approval present");
      case "judgement_status":
        return checkJudgementStatus(guard, context);
      case "ticket_closed":
        return passIf(guard, context.ticketClosed === true, "ticket closed");
      default:
        return {
          guardId: guard.id,
          type: guard.type,
          status: guard.optional ? "skipped" : "failed",
          evidence: `unsupported guard type: ${guard.type}`
        };
    }
  } catch (error) {
    return { guardId: guard.id, type: guard.type, status: guard.optional ? "skipped" : "failed", evidence: error.message };
  }
}

function checkSection(guard, repo) {
  const path = join(repo, guard.path);
  if (!existsSync(path)) {
    return passIf(guard, false, `${guard.path} missing`);
  }
  const text = readFileSync(path, "utf8");
  const index = text.indexOf(guard.section);
  if (index < 0) {
    return passIf(guard, false, `${guard.section} missing`);
  }
  const after = text.slice(index + guard.section.length);
  const nextHeading = after.search(/\n#{1,6}\s+/);
  const body = (nextHeading >= 0 ? after.slice(0, nextHeading) : after).trim();
  return passIf(guard, body.length > 0, `${guard.section} has ${body.length} chars`);
}

function checkGitCommit(guard, repo) {
  const result = spawnSync("git", ["log", "--oneline", "-50"], { cwd: repo, text: true, encoding: "utf8" });
  if (result.status !== 0) {
    return passIf(guard, false, result.stderr.trim() || "git log failed");
  }
  const matched = new RegExp(guard.pattern).test(result.stdout);
  return passIf(guard, matched, matched ? `matched ${guard.pattern}` : `no commit matched ${guard.pattern}`);
}

function checkCommand(guard, repo) {
  const parts = guard.command.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return passIf(guard, false, "empty command");
  }
  const result = spawnSync(parts[0], parts.slice(1), { cwd: repo, text: true, encoding: "utf8" });
  if (result.error && guard.optional) {
    return { guardId: guard.id, type: guard.type, status: "skipped", evidence: result.error.message };
  }
  return passIf(guard, result.status === 0, `exit ${result.status}: ${(result.stderr || result.stdout || "").trim().slice(0, 500)}`);
}

function checkAcVerificationTable(guard, repo) {
  const path = join(repo, "current-note.md");
  if (!existsSync(path)) {
    return passIf(guard, false, "current-note.md missing");
  }
  const text = readFileSync(path, "utf8");
  const hasTable = text.includes("AC 裏取り結果") || text.includes("AC Verification");
  const hasUnverified = /\bunverified\b/i.test(text);
  const ok = hasTable && (guard.allowUnverified || !hasUnverified);
  return passIf(guard, ok, `hasTable=${hasTable} hasUnverified=${hasUnverified}`);
}

function checkArtifact(guard, context) {
  const artifacts = context.artifacts ?? [];
  const found = artifacts.some((artifact) => artifact.kind === guard.kind && existsSync(artifact.path));
  return passIf(guard, found, found ? `${guard.kind} found` : `${guard.kind} missing`);
}

function checkJudgementStatus(guard, context) {
  const judgements = context.judgements ?? [];
  const found = judgements.find((judgement) => judgement.kind === guard.artifactKind);
  const accepted = found && (guard.accepted ?? []).includes(found.status);
  return passIf(guard, Boolean(accepted), found ? `${found.kind}: ${found.status}` : `${guard.artifactKind} missing`);
}

function passIf(guard, condition, evidence) {
  return {
    guardId: guard.id,
    type: guard.type,
    status: condition ? "passed" : guard.optional ? "skipped" : "failed",
    evidence
  };
}
