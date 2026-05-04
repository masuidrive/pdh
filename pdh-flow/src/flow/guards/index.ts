import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getStep } from "../load.ts";
import { evaluateAcVerificationTable } from "./ac-verification.ts";
import type { AnyRecord } from "../../types.ts";

export function evaluateStepGuards(flow: AnyRecord, stepId: string, context: AnyRecord = {}) {
  const step = getStep(flow, stepId);
  const results = [];
  for (const guard of step.guards ?? []) {
    results.push(evaluateGuard(guard, context));
  }
  return results;
}

export function evaluateGuard(guard: AnyRecord, context: AnyRecord = {}) {
  const repo = context.repoPath ?? process.cwd();
  try {
    switch (guard.type) {
      case "file_exists":
        return passIf(guard, existsSync(join(repo, guard.path)), `${guard.path} exists`);
      case "note_section_updated":
      case "ticket_section_updated":
        return checkSection(guard, repo);
      case "step_commit_recorded":
        return checkStepCommitRecorded(guard, context);
      case "command":
        return checkCommand(guard, repo);
      case "ac_verification_table":
        return checkAcVerificationTable(guard, repo);
      case "artifact_exists":
        return checkArtifact(guard, context);
      case "human_approved":
        return passIf(guard, context.humanDecision === "approved", `decision=${context.humanDecision ?? "none"}`);
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
  const body = sectionBody(text, guard.section);
  if (body === null) {
    return passIf(guard, false, `${guard.section} missing`);
  }
  return passIf(guard, body.length > 0, `${guard.section} has ${body.length} chars`);
}

function sectionBody(text, section) {
  const target = normalizeSectionTitle(section);
  const lines = String(text).split(/\r?\n/);
  let start = -1;
  let level = null;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.*?)\s*$/);
    if (!match) {
      continue;
    }
    if (sectionHeadingMatches(target, normalizeSectionTitle(match[2]))) {
      start = index + 1;
      level = match[1].length;
      break;
    }
  }
  if (start < 0 || level === null) {
    return null;
  }
  const bodyLines = [];
  for (let index = start; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.*?)\s*$/);
    if (match && match[1].length <= level) {
      break;
    }
    bodyLines.push(lines[index]);
  }
  return bodyLines.join("\n").trim();
}

function normalizeSectionTitle(value) {
  return String(value ?? "")
    .replace(/^#{1,6}\s+/, "")
    .trim();
}

function sectionHeadingMatches(target, heading) {
  if (heading === target) {
    return true;
  }
  const normalizedTarget = normalizeSectionTitle(target);
  const normalizedHeading = normalizeSectionTitle(heading);
  if (normalizedHeading === normalizedTarget) {
    return true;
  }
  if (/^PD-C-\d+$/i.test(normalizedTarget)) {
    return new RegExp(`^${escapeRegExp(normalizedTarget)}(?:[\\s.:：。\\-].+)?$`, "i").test(normalizedHeading);
  }
  return false;
}

function checkStepCommitRecorded(guard: AnyRecord, context: AnyRecord = {}) {
  const recorded = guardStepCommitRecord(guard, context);
  if (!recorded) {
    return passIf(guard, false, "step-commit.json missing");
  }
  return passIf(guard, true, `${recorded.short_commit || recorded.commit} ${recorded.subject || ""}`.trim());
}

function guardStepCommitRecord(guard: AnyRecord, context: AnyRecord = {}) {
  if (context?.stepCommit && typeof context.stepCommit === "object" && context.stepCommit.commit) {
    return context.stepCommit;
  }
  if (guard?.stepCommit && typeof guard.stepCommit === "object" && guard.stepCommit.commit) {
    return guard.stepCommit;
  }
  return null;
}

function checkCommand(guard, repo) {
  const parts = guard.command.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return passIf(guard, false, "empty command");
  }
  const result = spawnSync(parts[0], parts.slice(1), { cwd: repo, encoding: "utf8" });
  if (result.error && guard.optional) {
    return { guardId: guard.id, type: guard.type, status: "skipped", evidence: result.error.message };
  }
  return passIf(guard, result.status === 0, `exit ${result.status}: ${(result.stderr || result.stdout || "").trim().slice(0, 500)}`);
}

function checkAcVerificationTable(guard, repo) {
  const result = evaluateAcVerificationTable({ repoPath: repo, allowUnverified: guard.allowUnverified === true });
  const evidence = result.ok
    ? `rows=${result.rows.length} verified=${result.counts.verified} deferred=${result.counts.deferred} unverified=${result.counts.unverified}`
    : result.errors.join("; ");
  return passIf(guard, result.ok, evidence);
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
  if (found) {
    return passIf(guard, Boolean(accepted), `${found.kind}: ${found.status}`);
  }
  const uiJudgement = context.uiOutput?.judgement;
  if (uiJudgement?.kind === guard.artifactKind) {
    const parseErrors = context.uiOutput?.parseErrors ?? [];
    if (parseErrors.length > 0) {
      return passIf(
        guard,
        false,
        `${guard.artifactKind} not materialized because ui-output.json has parse errors: ${parseErrors[0]}`
      );
    }
    return passIf(
      guard,
      false,
      `${guard.artifactKind} is present in ui-output.json (${uiJudgement.status}) but the judgement artifact was not written`
    );
  }
  if (context.latestAttempt?.status === "completed") {
    return passIf(
      guard,
      false,
      `${guard.artifactKind} is still missing even though the provider step completed; inspect ui-output.json and judgements/`
    );
  }
  return passIf(guard, false, `${guard.artifactKind} missing`);
}

function passIf(guard, condition, evidence) {
  return {
    guardId: guard.id,
    type: guard.type,
    status: condition ? "passed" : guard.optional ? "skipped" : "failed",
    evidence
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
