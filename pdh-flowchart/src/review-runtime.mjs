import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseDocument, stringify } from "yaml";
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
      remit: reviewer.remit || "",
      focus: Array.isArray(reviewer.focus) ? reviewer.focus : []
    }));
  });
}

export function reviewerPromptPath({ stateDir, runId, stepId, reviewerId }) {
  return join(stateDir, "runs", runId, "steps", stepId, "reviewers", reviewerId, "prompt.md");
}

export function reviewerOutputPath({ stateDir, runId, stepId, reviewerId }) {
  return join(stateDir, "runs", runId, "steps", stepId, "reviewers", reviewerId, "review.yaml");
}

export function reviewerAttemptDir({ stateDir, runId, stepId, reviewerId, attempt }) {
  return join(stateDir, "runs", runId, "steps", stepId, "reviewers", reviewerId, `attempt-${attempt}`);
}

export function reviewerAttemptResultPath({ stateDir, runId, stepId, reviewerId, attempt }) {
  return join(reviewerAttemptDir({ stateDir, runId, stepId, reviewerId, attempt }), "result.json");
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
  const outputPath = `.pdh-flowchart/runs/${run.id}/steps/${step.id}/reviewers/${reviewer.reviewerId}/review.yaml`;
  const body = [
    "# pdh-flowchart Reviewer Prompt",
    "",
    `You are ${reviewer.label} for ${step.id}.`,
    "This is a fresh reviewer role inside pdh-flowchart runtime semantics.",
    "",
    "## Reviewer Contract",
    "",
    `- Role: ${reviewer.label}`,
    ...(reviewer.remit ? [`- Remit: ${reviewer.remit}`] : []),
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
    "- This repo owns review semantics. Do not rely on external `pdh-dev` or `tmux-director` skills.",
    ...(reviewPlan?.intent ? [`- Review intent: ${reviewPlan.intent}`] : []),
    ...(reviewPlan?.passWhen?.length ? ["- Step pass conditions:", ...reviewPlan.passWhen.map((item) => `  - ${item}`)] : []),
    ...(reviewPlan?.onFindings?.length ? ["- If findings remain:", ...reviewPlan.onFindings.map((item) => `  - ${item}`)] : []),
    "",
    "## Output",
    "",
    `Write plain YAML to \`${outputPath}\`.`,
    "Do not use markdown fences.",
    "Required fields:",
    "- `status`: exact reviewer conclusion string.",
    "- `summary`: one short sentence.",
    "- `findings`: array of finding objects. Use `[]` when there are no findings.",
    "- `notes`: optional free text.",
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
    stringify({
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
    }).trimEnd(),
    ""
  ].join("\n");
  writeFileSync(path, body);
  return { artifactPath: path, body };
}

export function writeReviewerAttemptResult({ stateDir, runId, stepId, reviewerId, attempt, result }) {
  const path = reviewerAttemptResultPath({ stateDir, runId, stepId, reviewerId, attempt });
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ ...result, reviewerId, attempt, runId, stepId }, null, 2));
  return path;
}

export function loadReviewerOutput({ stateDir, runId, stepId, reviewerId }) {
  const path = reviewerOutputPath({ stateDir, runId, stepId, reviewerId });
  if (!existsSync(path)) {
    return null;
  }
  try {
    const rawText = readFileSync(path, "utf8");
    const doc = parseDocument(rawText, { prettyErrors: false });
    const raw = doc.toJS() ?? {};
    return normalizeReviewerOutput(raw, {
      artifactPath: path,
      rawText,
      parseErrors: doc.errors.map((error) => error.message),
      parseWarnings: doc.warnings.map((warning) => warning.message)
    });
  } catch {
    return null;
  }
}

export function loadReviewerOutputsForStep({ stateDir, runId, stepId }) {
  const reviewersDir = join(stateDir, "runs", runId, "steps", stepId, "reviewers");
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
        reviewerId: entry.name
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

export function aggregateReviewerOutputs({ step, reviewPlan, reviewers }) {
  const kind = defaultJudgementKind(step.id);
  const acceptedStatus = kind ? defaultAcceptedJudgementStatus(kind) : null;
  const invalidReviewer = reviewers.find((reviewer) => reviewer.output?.parseErrors?.length);
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
  const topFindings = findings.filter((finding) => ["critical", "major"].includes(finding.severity));
  const status = acceptedStatus
    ? (nonAccepted ? nonAccepted.output.status : acceptedStatus)
    : (topFindings.length > 0 ? "Findings Present" : "Ready");
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
    topFindings,
    readyWhen: Array.isArray(reviewPlan?.passWhen) ? reviewPlan.passWhen : []
  };
}

export function materializeAggregatedReview({ repoPath, runtime, step, reviewPlan, aggregate }) {
  const section = noteSectionForStep(step);
  if (!section) {
    throw new Error(`${step.id} has no note_section_updated guard to record review output`);
  }
  const noteBody = renderReviewSection(step.id, aggregate);
  replaceNoteSection(repoPath, section, noteBody);

  const uiOutputPath = uiOutputArtifactPath({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id
  });
  mkdirSync(join(uiOutputPath, ".."), { recursive: true });
  writeFileSync(uiOutputPath, `${stringify(renderAggregateUiOutput(step, reviewPlan, aggregate)).trimEnd()}\n`);

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

  const commit = commitStep({
    repoPath,
    stepId: step.id,
    message: reviewCommitSummary(step.id)
  });

  return {
    noteSection: section,
    noteBody,
    uiOutputPath,
    judgement,
    commit
  };
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

function renderReviewSection(stepId, aggregate) {
  const lines = [
    `Updated: ${new Date().toISOString()}`,
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
    summary: asString(source.summary),
    findings: Array.isArray(source.findings)
      ? source.findings.map((finding) => ({
          severity: normalizeSeverity(finding?.severity),
          title: asString(finding?.title),
          evidence: asString(finding?.evidence),
          recommendation: asString(finding?.recommendation)
        }))
      : [],
    notes: asString(source.notes),
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

function asString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function asStringList(value) {
  return Array.isArray(value) ? value.map(asString).filter(Boolean) : [];
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br/>");
}

function slugify(value) {
  return basename(String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"), "-") || "reviewer";
}
