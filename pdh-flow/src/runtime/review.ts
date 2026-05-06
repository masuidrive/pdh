import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { commitStep, stepCommitSummary } from "./actions.ts";
import { resolveStepReviewPlan } from "../flow/load.ts";
import { defaultAcceptedJudgementStatus, defaultJudgementKind, writeJudgement } from "../flow/guards/judgement-artifact.ts";
import { replaceNoteSection } from "../repo/note.ts";
import { uiOutputArtifactPath } from "../flow/prompts/ui-output.ts";

export function activeReviewPlan(flow, variant, stepId) {
  return resolveStepReviewPlan(flow, variant, stepId);
}

export function expandReviewerInstances(reviewPlan) {
  const reviewers = Array.isArray(reviewPlan?.reviewers) ? reviewPlan.reviewers : [];
  return reviewers.flatMap((reviewer) => {
    // `providers: string[]` is the canonical form post-normalizeReviewer.
    // Each entry produces one spawn with its own provider, letting the
    // user pick e.g. devils_advocate-1=claude / devils_advocate-2=codex.
    const providers: string[] = Array.isArray(reviewer.providers) && reviewer.providers.length
      ? reviewer.providers
      : (reviewer.provider ? [reviewer.provider] : []);
    if (providers.length === 0) return [];
    return providers.map((provider, index) => ({
      reviewerId: `${reviewer.roleId || slugify(reviewer.label || "reviewer")}-${index + 1}`,
      roleId: reviewer.roleId || "",
      label: reviewer.label || reviewer.roleId || `Reviewer ${index + 1}`,
      provider: provider || "",
      responsibility: reviewer.responsibility || "",
      focus: Array.isArray(reviewer.focus) ? reviewer.focus : []
    }));
  });
}

export function reviewerPromptPath({ stateDir, runId, stepId, reviewerId }) {
  return join(stateDir, "runs", runId, "steps", stepId, "reviewers", reviewerId, "prompt.md");
}

export function reviewerOutputPath({ stateDir, runId, stepId, reviewerId }) {
  return join(stateDir, "runs", runId, "steps", stepId, "reviewers", reviewerId, "review.json");
}

export function reviewerAttemptDir({ stateDir, runId, stepId, reviewerId, attempt }) {
  return join(stateDir, "runs", runId, "steps", stepId, "reviewers", reviewerId, `attempt-${attempt}`);
}

export function reviewerAttemptResultPath({ stateDir, runId, stepId, reviewerId, attempt }) {
  return join(reviewerAttemptDir({ stateDir, runId, stepId, reviewerId, attempt }), "result.json");
}

export function reviewRoundDir({ stateDir, runId, stepId, round }) {
  return join(stateDir, "runs", runId, "steps", stepId, "review-rounds", `round-${round}`);
}

export function reviewRoundReviewerDir({ stateDir, runId, stepId, round, reviewerId }) {
  return join(reviewRoundDir({ stateDir, runId, stepId, round }), "reviewers", reviewerId);
}

export function reviewRoundReviewerOutputPath({ stateDir, runId, stepId, round, reviewerId }) {
  return join(reviewRoundReviewerDir({ stateDir, runId, stepId, round, reviewerId }), "review.json");
}

export function reviewRoundReviewerAttemptDir({ stateDir, runId, stepId, round, reviewerId, attempt }) {
  return join(reviewRoundReviewerDir({ stateDir, runId, stepId, round, reviewerId }), `attempt-${attempt}`);
}

export function reviewRoundReviewerAttemptResultPath({ stateDir, runId, stepId, round, reviewerId, attempt }) {
  return join(reviewRoundReviewerAttemptDir({ stateDir, runId, stepId, round, reviewerId, attempt }), "result.json");
}

export function reviewRepairOutputPath({ stateDir, runId, stepId, round }) {
  return join(reviewRoundDir({ stateDir, runId, stepId, round }), "repair.json");
}

export function reviewRepairResultPath({ stateDir, runId, stepId, round }) {
  return join(reviewRoundDir({ stateDir, runId, stepId, round }), "repair-result.json");
}

export function reviewRoundAggregatePath({ stateDir, runId, stepId, round }) {
  return join(reviewRoundDir({ stateDir, runId, stepId, round }), "aggregate.json");
}

export function writeReviewerAttemptResult({ stateDir, runId, stepId, reviewerId, attempt, result }) {
  const path = result.round
    ? reviewRoundReviewerAttemptResultPath({
        stateDir,
        runId,
        stepId,
        round: result.round,
        reviewerId,
        attempt
      })
    : reviewerAttemptResultPath({ stateDir, runId, stepId, reviewerId, attempt });
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ ...result, reviewerId, attempt, runId, stepId }, null, 2));
  return path;
}

export function loadReviewerOutput({ stateDir, runId, stepId, reviewerId, round = null }) {
  const path = round
    ? reviewRoundReviewerOutputPath({ stateDir, runId, stepId, round, reviewerId })
    : reviewerOutputPath({ stateDir, runId, stepId, reviewerId });
  return loadNormalizedJson(path, normalizeReviewerOutput);
}

function loadNormalizedJson(path, normalize) {
  if (!existsSync(path)) {
    return null;
  }
  const rawText = readFileSync(path, "utf8");
  let raw = {};
  const parseErrors = [];
  try {
    raw = JSON.parse(rawText) ?? {};
  } catch (error) {
    parseErrors.push(error?.message || String(error));
  }
  return normalize(raw, {
    artifactPath: path,
    rawText,
    parseErrors,
    parseWarnings: []
  });
}

export function loadReviewerOutputsForStep({ stateDir, runId, stepId }) {
  return loadReviewerOutputsForStepRound({ stateDir, runId, stepId, round: null });
}

export function loadReviewerOutputsForStepRound({ stateDir, runId, stepId, round = null }) {
  const reviewersDir = round
    ? join(reviewRoundDir({ stateDir, runId, stepId, round }), "reviewers")
    : join(stateDir, "runs", runId, "steps", stepId, "reviewers");
  if (!existsSync(reviewersDir)) {
    return [];
  }
  return readdirSync(reviewersDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const output = loadReviewerOutput({
        stateDir,
        runId,
        stepId,
        reviewerId: entry.name,
        round
      });
      return output
        ? {
            reviewerId: entry.name,
            label: entry.name,
            provider: "",
            output
          }
        : null;
    })
    .filter(Boolean);
}

export function writeLatestReviewerOutputMirror({ stateDir, runId, stepId, reviewerId, output }) {
  const path = reviewerOutputPath({ stateDir, runId, stepId, reviewerId });
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`);
  return path;
}

export function aggregateReviewerOutputs({ step, reviewPlan, reviewers }) {
  const kind = defaultJudgementKind(step.id);
  const acceptedStatus = kind ? defaultAcceptedJudgementStatus(kind) : null;
  const invalidReviewer = reviewers.find((reviewer) => !reviewerOutputUsable(reviewer.output));
  if (invalidReviewer) {
    return {
      kind,
      status: "invalid_reviewer_output",
      acceptedStatus,
      summary: `${invalidReviewer.label} output is invalid`,
      reviewers
    };
  }
  const missingReviewer = reviewers.find((reviewer) => !reviewer.output);
  if (missingReviewer) {
    return {
      kind,
      status: "missing_reviewer_output",
      acceptedStatus,
      summary: `${missingReviewer.label} did not write reviewer output`,
      reviewers
    };
  }

  const nonAccepted = acceptedStatus
    ? reviewers.find((reviewer) => reviewer.output.status !== acceptedStatus)
    : null;
  const findings = reviewers.flatMap((reviewer) =>
    (reviewer.output?.findings ?? []).map((finding) => ({ ...finding, reviewerId: reviewer.reviewerId, reviewerLabel: reviewer.label }))
  );
  const blockingFindings = findings.filter((finding) => ["critical", "major", "minor"].includes(finding.severity));
  const topFindings = findings.filter((finding) => ["critical", "major"].includes(finding.severity));
  const status = acceptedStatus
    ? (nonAccepted ? nonAccepted.output.status : acceptedStatus)
    : (blockingFindings.length > 0 ? "Findings Present" : "Ready");
  const summary = nonAccepted
    ? `${nonAccepted.label}: ${nonAccepted.output.summary || nonAccepted.output.status}`
    : reviewers.map((reviewer) => `${reviewer.label}: ${reviewer.output.summary}`).filter(Boolean).join(" / ");
  return {
    kind,
    status,
    acceptedStatus,
    summary: summary || status,
    reviewers,
    findings,
    blockingFindings,
    topFindings,
    readyWhen: Array.isArray(reviewPlan?.passWhen) ? reviewPlan.passWhen : []
  };
}

export function recordAggregatorReviewArtifacts({ repoPath, runtime, step, aggregate, aggregatorJudgement, rounds = [], commit = true }) {
  const section = noteSectionForStep(step);
  if (!section) {
    throw new Error(`${step.id} has no note_section_updated guard to record review output`);
  }
  const overlaidAggregate = {
    ...aggregate,
    status: aggregatorJudgement?.status ?? aggregate.status,
    summary: aggregatorJudgement?.summary ?? aggregate.summary,
    kind: aggregatorJudgement?.kind ?? aggregate.kind
  };
  const noteBody = renderReviewSection(step.id, overlaidAggregate, rounds);
  replaceNoteSection(repoPath, section, noteBody);
  const commitResult = commit
    ? commitStep({
        repoPath,
        stepId: step.id,
        message: stepCommitSummary(step.id),
        ticket: runtime?.run?.ticket_id ?? null
      })
    : { status: "skipped", message: "Commit deferred until review loop finishes" };
  return { noteSection: section, noteBody, commit: commitResult };
}

export function materializeAggregatedReview({ repoPath, runtime, step, reviewPlan, aggregate, rounds = [], commit = true }) {
  const section = noteSectionForStep(step);
  if (!section) {
    throw new Error(`${step.id} has no note_section_updated guard to record review output`);
  }
  const noteBody = renderReviewSection(step.id, aggregate, rounds);
  replaceNoteSection(repoPath, section, noteBody);

  const uiOutputPath = uiOutputArtifactPath({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id
  });
  mkdirSync(join(uiOutputPath, ".."), { recursive: true });
  writeFileSync(uiOutputPath, `${JSON.stringify(renderAggregateUiOutput(step, reviewPlan, aggregate), null, 2)}\n`);

  let judgement = null;
  if (aggregate.kind) {
    judgement = writeJudgement({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId: step.id,
      kind: aggregate.kind,
      status: aggregate.status,
      summary: aggregate.summary,
      source: "runtime:review-aggregate",
      details: {
        reviewers: aggregate.reviewers.map((reviewer) => ({
          reviewerId: reviewer.reviewerId,
          label: reviewer.label,
          provider: reviewer.provider,
          status: reviewer.output?.status || null,
          summary: reviewer.output?.summary || null,
          artifactPath: reviewer.output?.artifactPath || null
        }))
      }
    });
  }

  const commitResult = commit
    ? commitStep({
        repoPath,
        stepId: step.id,
        message: stepCommitSummary(step.id),
        ticket: runtime?.run?.ticket_id ?? null
      })
    : { status: "skipped", message: "Commit deferred until review loop finishes" };

  return {
    noteSection: section,
    noteBody,
    uiOutputPath,
    judgement,
    commit: commitResult
  };
}

export function writeReviewRoundAggregate({ stateDir, runId, stepId, round, aggregate }) {
  const path = reviewRoundAggregatePath({ stateDir, runId, stepId, round });
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify({
    round,
    status: aggregate.status,
    summary: aggregate.summary,
    accepted_status: aggregate.acceptedStatus ?? null,
    reviewers: aggregate.reviewers.map((reviewer) => ({
      reviewer_id: reviewer.reviewerId,
      label: reviewer.label,
      provider: reviewer.provider || "",
      status: reviewer.output?.status || "",
      summary: reviewer.output?.summary || "",
      artifact: reviewer.output?.artifactPath || ""
    })),
    findings: (aggregate.findings ?? []).map((finding) => ({
      severity: finding.severity,
      reviewer: finding.reviewerLabel,
      title: finding.title,
      evidence: finding.evidence,
      recommendation: finding.recommendation
    }))
  }, null, 2)}\n`);
  return path;
}

export function writeReviewRepairResult({ stateDir, runId, stepId, round, result }) {
  const path = reviewRepairResultPath({ stateDir, runId, stepId, round });
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ ...result, runId, stepId, round }, null, 2));
  return path;
}

export function loadReviewRepairOutput({ stateDir, runId, stepId, round }) {
  return loadNormalizedJson(
    reviewRepairOutputPath({ stateDir, runId, stepId, round }),
    normalizeReviewRepairOutput
  );
}

export function reviewAccepted(aggregate) {
  if (!aggregate) {
    return false;
  }
  if (aggregate.acceptedStatus) {
    return aggregate.status === aggregate.acceptedStatus;
  }
  return aggregate.status === "Ready" && (aggregate.blockingFindings?.length ?? 0) === 0;
}

function renderAggregateUiOutput(step, reviewPlan, aggregate) {
  // ready_when was retired in favor of structured `risks`. The review
  // aggregator surfaces top findings as risk objects so close gates and
  // future runtime checks can act on severity / defer_to_step instead
  // of free-form text. Findings are mapped to severity by the source
  // finding's severity (critical/major) and never carry defer_to_step
  // because they're meant to be addressed in this review round (or
  // forced into a rerun if blocking).
  return {
    summary: aggregate.reviewers.map((reviewer) => reviewer.output?.summary).filter(Boolean).slice(0, 4),
    risks: (aggregate.topFindings ?? []).map((finding) => ({
      description: `${finding.reviewerLabel}: ${finding.title}`,
      severity: finding.severity || "major",
      defer_to_step: null
    })),
    notes: renderReviewNotes(step.id, aggregate),
    ...(aggregate.kind
      ? {
          judgement: {
            kind: aggregate.kind,
            status: aggregate.status,
            summary: aggregate.summary
          }
        }
      : {})
  };
}

function renderReviewSection(stepId, aggregate, rounds = []) {
  const lines = [
    `Updated: ${new Date().toISOString()}`,
    "",
    `- Review rounds: ${Math.max(rounds.length, 1)}`,
    "",
    "### Aggregate",
    "",
    `- Status: ${aggregate.status}`,
    `- Summary: ${aggregate.summary || "-"}`,
    ...(aggregate.acceptedStatus ? [`- Pass target: ${aggregate.acceptedStatus}`] : []),
    "",
    "### Reviewer Status",
    "",
    "| Reviewer | Provider | Status | Summary |",
    "| --- | --- | --- | --- |"
  ];
  for (const reviewer of aggregate.reviewers) {
    lines.push(`| ${reviewer.label} | ${reviewer.provider || "-"} | ${reviewer.output?.status || "-"} | ${escapeTable(reviewer.output?.summary || "-")} |`);
  }
  lines.push("", "### Findings", "");
  const findings = aggregate.findings ?? [];
  if (findings.length === 0) {
    lines.push("- None.");
  } else {
    for (const finding of findings) {
      lines.push(`- [${finding.severity}] ${finding.reviewerLabel}: ${finding.title}`);
      if (finding.evidence) {
        lines.push(`  - Evidence: ${finding.evidence}`);
      }
      if (finding.recommendation) {
        lines.push(`  - Recommendation: ${finding.recommendation}`);
      }
    }
  }
  if (rounds.length > 0) {
    lines.push("", "### Review Rounds", "");
    for (const round of rounds) {
      lines.push(`#### Round ${round.round}`, "");
      lines.push(`- Aggregate status: ${round.status}`);
      lines.push(`- Summary: ${round.summary || "-"}`);
      if (round.repairSummary) {
        lines.push(`- Repair summary: ${round.repairSummary}`);
      }
      if (Array.isArray(round.verification) && round.verification.length > 0) {
        lines.push(`- Verification: ${round.verification.join(" / ")}`);
      }
      if (Array.isArray(round.blockingFindings) && round.blockingFindings.length > 0) {
        lines.push("- Blocking findings:");
        for (const finding of round.blockingFindings) {
          lines.push(`  - [${finding.severity}] ${finding.reviewerLabel}: ${finding.title}`);
        }
      }
      if (Array.isArray(round.remainingRisks) && round.remainingRisks.length > 0) {
        lines.push("- Remaining risks:");
        for (const risk of round.remainingRisks) {
          lines.push(`  - ${risk}`);
        }
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

function renderReviewNotes(stepId, aggregate) {
  const findings = aggregate.topFindings ?? [];
  const parts = [];
  if (findings.length > 0) {
    parts.push(findings.map((finding) => `[${finding.severity}] ${finding.reviewerLabel}: ${finding.title}`).join("\n"));
  }
  return parts.join("\n\n");
}

function normalizeReviewerOutput(value, meta = {}) {
  const source: any = value ?? {};
  const metadata: any = meta ?? {};
  return {
    status: asString(source.status),
    summary: normalizeReviewText(source.summary),
    findings: Array.isArray(source.findings)
      ? source.findings.map((finding) => ({
          severity: normalizeSeverity(finding?.severity),
          title: normalizeReviewText(finding?.title),
          evidence: normalizeReviewText(finding?.evidence),
          recommendation: normalizeReviewText(finding?.recommendation)
        })).filter(hasMeaningfulFinding)
      : [],
    notes: normalizeReviewText(source.notes),
    artifactPath: asString(metadata.artifactPath),
    parseErrors: asStringList(metadata.parseErrors),
    parseWarnings: asStringList(metadata.parseWarnings),
    rawText: asString(metadata.rawText)
  };
}

function reviewerOutputUsable(output) {
  if (!output) {
    return false;
  }
  if (!output.status || !output.summary) {
    return false;
  }
  if (!Array.isArray(output.findings)) {
    return false;
  }
  return true;
}

function normalizeReviewRepairOutput(value, meta = {}) {
  const source: any = value ?? {};
  const metadata: any = meta ?? {};
  return {
    summary: normalizeReviewText(source.summary),
    verification: asReviewStringList(source.verification),
    remainingRisks: asReviewStringList(source.remaining_risks ?? source.remainingRisks),
    notes: normalizeReviewText(source.notes),
    commitRequired: source.commit_required === true || source.commitRequired === true,
    rerunTargetStep: asString(source.rerun_target_step ?? source.rerunTargetStep),
    artifactPath: asString(metadata.artifactPath),
    parseErrors: asStringList(metadata.parseErrors),
    parseWarnings: asStringList(metadata.parseWarnings),
    rawText: asString(metadata.rawText)
  };
}

function noteSectionForStep(step) {
  return step.guards?.find((guard) => guard.type === "note_section_updated")?.section ?? null;
}

function normalizeSeverity(value) {
  const normalized = asString(value).toLowerCase();
  return ["critical", "major", "minor", "note", "none"].includes(normalized) ? normalized : "note";
}

function hasMeaningfulFinding(finding) {
  return Boolean(finding?.title || finding?.evidence || finding?.recommendation);
}

function normalizeReviewText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return scrubPlaceholderText(value.trim());
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  const rendered = JSON.stringify(value, null, 2);
  return scrubPlaceholderText(rendered);
}

function asReviewStringList(value) {
  return Array.isArray(value) ? value.map(normalizeReviewText).filter(Boolean) : [];
}

function scrubPlaceholderText(value) {
  return PLACEHOLDER_TEXT.has(value) ? "" : value;
}

function asString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function asStringList(value) {
  return Array.isArray(value) ? value.map(asString).filter(Boolean) : [];
}

const PLACEHOLDER_TEXT = new Set(["[object Object]", "[object Array]"]);

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br/>");
}

function slugify(value) {
  return basename(String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"), "-") || "reviewer";
}
