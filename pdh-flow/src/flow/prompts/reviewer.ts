import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getStep, resolveStepReviewPlan } from "../load.ts";
import { defaultAcceptedJudgementStatus, defaultJudgementKind } from "../guards/judgement-artifact.ts";
import { renderTemplate } from "./template-engine.ts";

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

export function renderReviewerPrompt({ repoPath, run, flow, step, reviewPlan, reviewer, round = null, priorFindings = [] }) {
  const acceptedStatus = acceptedReviewerStatus(step.id);
  const outputPath = round
    ? `.pdh-flow/runs/${run.id}/steps/${step.id}/review-rounds/round-${round}/reviewers/${reviewer.reviewerId}/review.json`
    : `.pdh-flow/runs/${run.id}/steps/${step.id}/reviewers/${reviewer.reviewerId}/review.json`;
  const reviewerStepRules = Array.isArray(reviewPlan?.reviewerRules) ? reviewPlan.reviewerRules : [];
  const jsonShape = JSON.stringify({
    status: acceptedStatus || "Ready",
    summary: "短いレビュー要約",
    findings: [
      {
        severity: "major",
        title: "具体的な問題のタイトル",
        evidence: "具体的な証拠",
        recommendation: "具体的な修正案または follow-up"
      }
    ],
    notes: "任意の自由記述"
  }, null, 2);
  return renderTemplate("shared/reviewer_prompt.j2", {
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

function acceptedReviewerStatus(stepId) {
  const kind = defaultJudgementKind(stepId);
  return kind ? defaultAcceptedJudgementStatus(kind) : null;
}
