import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { commitStep } from "./actions.mjs";
import { resolveStepReviewPlan } from "./flow.mjs";
import { defaultAcceptedJudgementStatus, defaultJudgementKind, writeJudgement } from "./judgements.mjs";
import { replaceNoteSection } from "./note-state.mjs";
import { uiOutputArtifactPath } from "./step-ui.mjs";

export function activeReviewPlan(flow, variant, stepId) {
  return resolveStepReviewPlan(flow, variant, stepId);
}

export function expandReviewerInstances(reviewPlan) {
  const reviewers = Array.isArray(reviewPlan?.reviewers) ? reviewPlan.reviewers : [];
  return reviewers.flatMap((reviewer) => {
    const count = Number.isFinite(Number(reviewer.count)) ? Number(reviewer.count) : 1;
    return Array.from({ length: Math.max(count, 1) }, (_, index) => ({
      reviewerId: `${reviewer.roleId || slugify(reviewer.label || "reviewer")}-${index + 1}`,
      roleId: reviewer.roleId || "",
      label: reviewer.label || reviewer.roleId || `Reviewer ${index + 1}`,
      provider: reviewer.provider || "",
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

export function writeReviewerPrompt({ stateDir, run, step, reviewPlan, reviewer }) {
  const path = reviewerPromptPath({
    stateDir,
    runId: run.id,
    stepId: step.id,
    reviewerId: reviewer.reviewerId
  });
  mkdirSync(join(path, ".."), { recursive: true });
  const acceptedStatus = reviewerAcceptedStatus(step.id);
  const outputPath = `.pdh-flow/runs/${run.id}/steps/${step.id}/reviewers/${reviewer.reviewerId}/review.json`;
  const body = [
    "# pdh-flow Reviewer Prompt",
    "",
    `You are ${reviewer.label} for ${step.id}.`,
    "This is a fresh reviewer role inside pdh-flow runtime semantics.",
    "",
    "## Reviewer Contract",
    "",
    `- Role: ${reviewer.label}`,
    ...(reviewer.responsibility ? [`- Responsibility: ${reviewer.responsibility}`] : []),
    ...(reviewer.focus.length > 0 ? ["- Focus:", ...reviewer.focus.map((item) => `  - ${item}`)] : ["- Focus: (none)"]),
    "",
    "## Review Rules",
    "",
    "- Review the current repo state for this step only.",
    "- Read `current-ticket.md` and `current-note.md` before concluding.",
    "- Do not edit repo files.",
    "- Do not commit.",
    "- Do not run `ticket.sh` or `node src/cli.mjs ...`.",
    "- You may inspect git diff, read files, and run narrowly scoped verification commands when needed.",
    "- This repo owns review semantics.",
    ...(reviewPlan?.intent ? [`- Review intent: ${reviewPlan.intent}`] : []),
    ...(reviewPlan?.passWhen?.length ? ["- Step pass conditions:", ...reviewPlan.passWhen.map((item) => `  - ${item}`)] : []),
    ...(reviewPlan?.onFindings?.length ? ["- If findings remain:", ...reviewPlan.onFindings.map((item) => `  - ${item}`)] : []),
    "",
    "## Output",
    "",
    `Write valid JSON to \`${outputPath}\`.`,
    "Do not use markdown fences. All keys and strings must be double-quoted; escape inner double quotes with `\\\"` and backslashes with `\\\\`.",
    "Required fields:",
    "- `status`: exact reviewer conclusion string.",
    "- `summary`: one short sentence.",
    "- `findings`: array of finding objects. Use `[]` when there are no findings.",
    "- `notes`: optional free text. Multi-line content uses `\\n` inside the JSON string.",
    "",
    "Finding object shape:",
    "- `severity`: one of `critical`, `major`, `minor`, `note`, `none`",
    "- `title`: short title",
    "- `evidence`: concrete evidence",
    "- `recommendation`: concrete correction or follow-up",
    "",
    acceptedStatus
      ? `Use \`status: ${acceptedStatus}\` only when your latest review has no unresolved blocker at that threshold.`
      : "Use a short status string that states whether final verification is ready.",
    "Match the primary language used in `current-ticket.md` for human-readable text.",
    "",
    "Template:",
    "",
    JSON.stringify({
      status: acceptedStatus || "Ready",
      summary: "Short reviewer summary",
      findings: [
        {
          severity: "major",
          title: "Concrete issue title",
          evidence: "Concrete evidence",
          recommendation: "Concrete correction or follow-up"
        }
      ],
      notes: "Optional free text"
    }, null, 2),
    ""
  ].join("\n");
  writeFileSync(path, body);
  return { artifactPath: path, body };
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
  return normalizeReviewerOutput(raw, {
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
        message: reviewCommitSummary(step.id),
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
        message: reviewCommitSummary(step.id),
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
  const path = reviewRepairOutputPath({ stateDir, runId, stepId, round });
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
  return normalizeReviewRepairOutput(raw, {
    artifactPath: path,
    rawText,
    parseErrors,
    parseWarnings: []
  });
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
  return {
    summary: aggregate.reviewers.map((reviewer) => reviewer.output?.summary).filter(Boolean).slice(0, 4),
    risks: (aggregate.topFindings ?? []).map((finding) => `${finding.reviewerLabel}: ${finding.title}`),
    ready_when: aggregate.readyWhen ?? [],
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
  if (stepId === "PD-C-8") {
    lines.push("", "### Close Check", "", "- This step is counterexample-driven. Any unverified AC or unresolved purpose gap blocks close.");
  }
  return lines.join("\n");
}

function renderReviewNotes(stepId, aggregate) {
  const findings = aggregate.topFindings ?? [];
  const parts = [];
  if (findings.length > 0) {
    parts.push(findings.map((finding) => `[${finding.severity}] ${finding.reviewerLabel}: ${finding.title}`).join("\n"));
  }
  if (stepId === "PD-C-8") {
    parts.push("Counterexample-driven review. Missing AC verification or purpose fit should block close.");
  }
  return parts.join("\n\n");
}

function normalizeReviewerOutput(value, meta = {}) {
  const source = value ?? {};
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
    artifactPath: asString(meta.artifactPath),
    parseErrors: asStringList(meta.parseErrors),
    parseWarnings: asStringList(meta.parseWarnings),
    rawText: asString(meta.rawText)
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
  const source = value ?? {};
  return {
    summary: normalizeReviewText(source.summary),
    verification: asReviewStringList(source.verification),
    remainingRisks: asReviewStringList(source.remaining_risks ?? source.remainingRisks),
    notes: normalizeReviewText(source.notes),
    commitRequired: source.commit_required === true || source.commitRequired === true,
    rerunTargetStep: asString(source.rerun_target_step ?? source.rerunTargetStep),
    artifactPath: asString(meta.artifactPath),
    parseErrors: asStringList(meta.parseErrors),
    parseWarnings: asStringList(meta.parseWarnings),
    rawText: asString(meta.rawText)
  };
}

function noteSectionForStep(step) {
  return step.guards?.find((guard) => guard.type === "note_section_updated")?.section ?? null;
}

function reviewerAcceptedStatus(stepId) {
  const kind = defaultJudgementKind(stepId);
  return kind ? defaultAcceptedJudgementStatus(kind) : null;
}

function reviewCommitSummary(stepId) {
  const summaries = {
    "PD-C-4": "Plan review",
    "PD-C-7": "Quality verification",
    "PD-C-8": "Purpose validation",
    "PD-C-9": "Final verification"
  };
  return summaries[stepId] ?? `${stepId} review`;
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
