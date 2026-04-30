import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildFlowView, getStep, nextStep, resolveSkillBodies, resolveStepReviewPlan } from "../core/flow.mjs";
import { defaultAcceptedJudgementStatus, defaultJudgementKind } from "./judgements.mjs";
import { loadStepInterruptions, renderInterruptionsForPrompt } from "./interruptions.mjs";
import { renderUiOutputPromptSection } from "./step-ui.mjs";
import { hasStepPrompt, renderStepPromptBody } from "./step-prompts.mjs";
import { renderTemplate } from "./template-engine.mjs";

export function writeStepPrompt({ repoPath, stateDir, run, flow, stepId }) {
  const step = getStep(flow, stepId);
  if (step.provider === "runtime") {
    throw new Error(`${stepId} is runtime-owned and does not use a provider prompt`);
  }
  const artifactDir = join(stateDir, "runs", run.id, "steps", stepId);
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "prompt.md");
  const interruptions = loadStepInterruptions({ stateDir, runId: run.id, stepId });
  const body = renderStepPrompt({ repoPath, run, flow, step, interruptions });
  writeFileSync(artifactPath, body);
  return { artifactPath, body };
}

export function writeReviewerPromptArtifact({ repoPath, stateDir, run, flow, stepId, reviewer, round = null, priorFindings = [] }) {
  const step = getStep(flow, stepId);
  const reviewPlan = resolveStepReviewPlan(flow, run.flow_variant, stepId);
  if (!reviewPlan) {
    throw new Error(`${stepId} does not define runtime review semantics`);
  }
  const artifactPath = round
    ? join(stateDir, "runs", run.id, "steps", stepId, "review-rounds", `round-${round}`, "reviewers", reviewer.reviewerId, "prompt.md")
    : join(stateDir, "runs", run.id, "steps", stepId, "reviewers", reviewer.reviewerId, "prompt.md");
  mkdirSync(join(artifactPath, ".."), { recursive: true });
  const body = renderReviewerPrompt({ repoPath, run, flow, step, reviewPlan, reviewer, round, priorFindings });
  writeFileSync(artifactPath, body);
  return { artifactPath, body };
}

export function writeReviewRepairPromptArtifact({ repoPath, stateDir, run, flow, stepId, reviewPlan, aggregate, round, provider }) {
  const step = getStep(flow, stepId);
  const artifactPath = join(stateDir, "runs", run.id, "steps", stepId, "review-rounds", `round-${round}`, "repair-prompt.md");
  mkdirSync(join(artifactPath, ".."), { recursive: true });
  const body = renderReviewRepairPrompt({ repoPath, run, flow, step, reviewPlan, aggregate, round, provider });
  writeFileSync(artifactPath, body);
  return { artifactPath, body };
}

export function renderStepPrompt({ repoPath, run, flow, step, interruptions = [], reviewerOutputs = null }) {
  const promptContext = mergePromptContext(flow, step);
  const flowView = buildFlowView(flow, run.flow_variant, step.id);
  const flowStep = flowView.steps.find((item) => item.id === step.id);
  const reviewPlan = flowStep?.review ?? null;
  const stepBody = hasStepPrompt(step.id) ? renderStepPromptBody(step.id) : null;
  const skillBodies = resolveSkillBodies(step.role);

  return renderTemplate("step-prompt.j2", {
    run,
    step,
    successTransition: nextStep(flow, run.flow_variant, step.id, "success"),
    skillBodies,
    interruptionLines: renderInterruptionsForPrompt(interruptions),
    stepBody,
    reviewerOutputs: reviewerOutputs ?? [],
    promptContextLines: renderPromptContext(promptContext),
    guardLines: formatGuards(step),
    reviewSemanticsLines: renderReviewSemantics(step, reviewPlan),
    hasReviewers: Boolean(reviewPlan?.reviewers?.length),
    uiOutputLines: renderUiOutputPromptSection({ run, step })
  });
}

function formatGuards(step) {
  if (!step.guards?.length) {
    return ["- (none)"];
  }
  return step.guards.map((guard) => {
    const details = Object.entries(guard)
      .filter(([key]) => !["id", "type"].includes(key))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(" ");
    return `- ${guard.id}: ${guard.type}${details ? ` (${details})` : ""}`;
  });
}

function mergePromptContext(flow, step) {
  const defaults = flow.defaults?.promptContext ?? {};
  const specific = step.promptContext ?? {};
  return {
    contextSummary: specific.contextSummary ?? defaults.contextSummary ?? "",
    semanticRules: [
      ...(defaults.semanticRules ?? []),
      ...(specific.semanticRules ?? [])
    ],
    requiredRefs: dedupeRequiredRefs([
      ...(defaults.requiredRefs ?? []),
      ...(specific.requiredRefs ?? [])
    ])
  };
}

function dedupeRequiredRefs(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    if (!entry?.path) {
      continue;
    }
    if (seen.has(entry.path)) {
      continue;
    }
    seen.add(entry.path);
    result.push(entry);
  }
  return result;
}

function renderPromptContext(promptContext) {
  const lines = [];
  if (promptContext.contextSummary) {
    lines.push(`- Context summary: ${promptContext.contextSummary}`);
  }
  if (promptContext.semanticRules.length > 0) {
    lines.push("- Semantic rules:");
    for (const rule of promptContext.semanticRules) {
      lines.push(`  - ${rule}`);
    }
  } else {
    lines.push("- Semantic rules: (none)");
  }
  if (promptContext.requiredRefs.length > 0) {
    lines.push("- Required references:");
    for (const ref of promptContext.requiredRefs) {
      const reason = ref.reason ? ` - ${ref.reason}` : "";
      lines.push(`  - \`${ref.path}\`${reason}`);
    }
  } else {
    lines.push("- Required references: (none)");
  }
  return lines;
}

function renderReviewSemantics(step, reviewPlan) {
  if (step.mode !== "review" && !reviewPlan?.reviewers?.length) {
    return [];
  }
  const lines = [
    "## Runtime Review Semantics",
    "",
    "- This repo owns the review semantics for this step."
  ];
  if (reviewPlan?.intent) {
    lines.push(`- Review intent: ${reviewPlan.intent}`);
  }
  if (reviewPlan?.passWhen?.length) {
    lines.push("- Pass conditions:");
    for (const item of reviewPlan.passWhen) {
      lines.push(`  - ${item}`);
    }
  }
  if (reviewPlan?.onFindings?.length) {
    lines.push("- If findings remain:");
    for (const item of reviewPlan.onFindings) {
      lines.push(`  - ${item}`);
    }
  }
  if (reviewPlan?.maxRounds) {
    lines.push(`- Review loop max rounds: ${reviewPlan.maxRounds}`);
  }
  if (reviewPlan?.repairProvider) {
    lines.push(`- Repair provider between rounds: ${reviewPlan.repairProvider}`);
  }
  if (reviewPlan?.reviewers?.length) {
    lines.push("- Reviewer roster for this run variant:");
    for (const reviewer of reviewPlan.reviewers) {
      lines.push(`  - ${reviewer.label} x${reviewer.count}`);
      if (reviewer.responsibility) {
        lines.push(`    - responsibility: ${reviewer.responsibility}`);
      }
      for (const focus of reviewer.focus) {
        lines.push(`    - focus: ${focus}`);
      }
    }
  } else {
    lines.push("- Reviewer roster for this run variant: (unspecified)");
  }
  lines.push("- Keep your output aligned with this runtime-owned review contract.");
  return lines;
}

export function renderReviewerPrompt({ repoPath, run, flow, step, reviewPlan, reviewer, round = null, priorFindings = [] }) {
  const acceptedStatus = acceptedReviewerStatus(step.id);
  const outputPath = round
    ? `.pdh-flow/runs/${run.id}/steps/${step.id}/review-rounds/round-${round}/reviewers/${reviewer.reviewerId}/review.json`
    : `.pdh-flow/runs/${run.id}/steps/${step.id}/reviewers/${reviewer.reviewerId}/review.json`;
  const reviewerStepRules = Array.isArray(reviewPlan?.reviewerRules) ? reviewPlan.reviewerRules : [];
  const jsonShape = JSON.stringify({
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
  }, null, 2);
  return renderTemplate("reviewer-prompt.j2", {
    run,
    step,
    reviewPlan,
    reviewer,
    round,
    priorFindings,
    reviewerStepRules,
    acceptedStatus,
    outputPath,
    jsonShape
  });
}

export function renderReviewRepairPrompt({ repoPath, run, flow, step, reviewPlan, aggregate, round, provider }) {
  const outputPath = `.pdh-flow/runs/${run.id}/steps/${step.id}/review-rounds/round-${round}/repair.json`;
  const skillBodies = resolveSkillBodies("repair");
  const blockers = blockingFindings(aggregate);
  const repairStepRules = Array.isArray(reviewPlan?.repairRules) ? reviewPlan.repairRules : [];
  const jsonShape = JSON.stringify({
    summary: "Short repair summary",
    verification: ["command or check that was actually run"],
    remaining_risks: ["Unresolved blocker or follow-up risk"],
    notes: "Optional free text",
    commit_required: false,
    rerun_target_step: null
  }, null, 2);
  const blockerLines = renderBlockerLines(blockers);
  return renderTemplate("repair-prompt.j2", {
    run,
    step,
    reviewPlan: reviewPlan ?? {},
    round,
    provider,
    skillBodies,
    repairStepRules,
    blockerLines,
    outputPath,
    jsonShape
  });
}

function renderBlockerLines(blockers) {
  if (!blockers.length) {
    return ["- No blocking findings were detected. Clean up any remaining verification or evidence gaps and prepare for the next review round."];
  }
  const lines = [];
  for (const finding of blockers) {
    lines.push(`- [${finding.severity}] ${finding.reviewerLabel}: ${finding.title}`);
    if (finding.evidence) {
      lines.push(`  - Evidence: ${finding.evidence}`);
    }
    if (finding.recommendation) {
      lines.push(`  - Recommendation: ${finding.recommendation}`);
    }
  }
  return lines;
}

function acceptedReviewerStatus(stepId) {
  const kind = defaultJudgementKind(stepId);
  return kind ? defaultAcceptedJudgementStatus(kind) : null;
}

function blockingFindings(aggregate) {
  if (!aggregate?.findings?.length) {
    return [];
  }
  const severe = aggregate.findings.filter((finding) => ["critical", "major"].includes(String(finding.severity || "").toLowerCase()));
  if (severe.length > 0) {
    return severe;
  }
  return aggregate.findings.filter((finding) => !["none", "note"].includes(String(finding.severity || "").toLowerCase()));
}
