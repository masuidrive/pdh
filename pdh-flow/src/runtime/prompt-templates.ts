import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildFlowView, getStep, nextStep, resolveSkillBodies, resolveStepReviewPlan } from "../core/flow.ts";
import { defaultAcceptedJudgementStatus, defaultJudgementKind } from "./judgements.ts";
import { loadStepInterruptions, renderInterruptionsForPrompt } from "./interruptions.ts";
import { renderUiOutputPromptSection } from "./step-ui.ts";
import { hasStepPrompt, renderStepPromptBody } from "./step-prompts.ts";
import { renderTemplate } from "./template-engine.ts";

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
  const flowView = buildFlowView(flow, run.flow_variant, step.id);
  const flowStep = flowView.steps.find((item) => item.id === step.id);
  const reviewPlan = flowStep?.review ?? null;
  const stepBody = hasStepPrompt(step.id) ? renderStepPromptBody(step.id) : null;
  const skillBodies = resolveSkillBodies(step.role);

  return renderTemplate("shared/step_prompt.j2", {
    run,
    step,
    successTransition: nextStep(flow, run.flow_variant, step.id, "success"),
    skillBodies,
    interruptionLines: renderInterruptionsForPrompt(interruptions),
    stepBody,
    reviewerOutputs: reviewerOutputs ?? [],
    guardLines: formatGuards(step),
    reviewSemanticsLines: renderReviewSemantics(step, reviewPlan),
    hasReviewers: Boolean(reviewPlan?.reviewers?.length),
    uiOutputLines: renderUiOutputPromptSection({ run, step })
  });
}

function formatGuards(step) {
  if (!step.guards?.length) {
    return ["- (なし)"];
  }
  return step.guards.map((guard) => {
    const details = Object.entries(guard)
      .filter(([key]) => !["id", "type"].includes(key))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(" ");
    return `- ${guard.id}: ${guard.type}${details ? ` (${details})` : ""}`;
  });
}

function renderReviewSemantics(step, reviewPlan) {
  if (step.mode !== "review" && !reviewPlan?.reviewers?.length) {
    return [];
  }
  const lines = [
    "## runtime 管理のレビュー契約",
    "",
    "- このステップのレビュー契約はこの repo が定義する。"
  ];
  if (reviewPlan?.intent) {
    lines.push(`- レビュー意図: ${reviewPlan.intent}`);
  }
  if (reviewPlan?.passWhen?.length) {
    lines.push("- 通過条件:");
    for (const item of reviewPlan.passWhen) {
      lines.push(`  - ${item}`);
    }
  }
  if (reviewPlan?.onFindings?.length) {
    lines.push("- finding が残る場合:");
    for (const item of reviewPlan.onFindings) {
      lines.push(`  - ${item}`);
    }
  }
  if (reviewPlan?.maxRounds) {
    lines.push(`- レビューループの最大ラウンド数: ${reviewPlan.maxRounds}`);
  }
  if (reviewPlan?.repairProvider) {
    lines.push(`- ラウンド間の修正担当プロバイダ: ${reviewPlan.repairProvider}`);
  }
  if (reviewPlan?.reviewers?.length) {
    lines.push("- この run variant の reviewer roster:");
    for (const reviewer of reviewPlan.reviewers) {
      const providers: string[] = Array.isArray(reviewer.providers) ? reviewer.providers : [];
      lines.push(`  - ${reviewer.label} x${providers.length} (${providers.join(", ") || "-"})`);
      if (reviewer.responsibility) {
        lines.push(`    - 担当範囲: ${reviewer.responsibility}`);
      }
      for (const focus of reviewer.focus) {
        lines.push(`    - 注力点: ${focus}`);
      }
    }
  } else {
    lines.push("- この run variant の reviewer roster: (未指定)");
  }
  lines.push("- 出力はこの runtime 管理のレビュー契約に揃える。");
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

export function renderReviewRepairPrompt({ repoPath, run, flow, step, reviewPlan, aggregate, round, provider }) {
  const outputPath = `.pdh-flow/runs/${run.id}/steps/${step.id}/review-rounds/round-${round}/repair.json`;
  const skillBodies = resolveSkillBodies("repair");
  const blockers = blockingFindings(aggregate);
  const repairStepRules = Array.isArray(reviewPlan?.repairRules) ? reviewPlan.repairRules : [];
  const jsonShape = JSON.stringify({
    summary: "短い修正要約",
    verification: ["実際に実行したコマンドまたは確認"],
    remaining_risks: ["未解消 blocker または follow-up risk"],
    notes: "任意の自由記述",
    commit_required: false,
    rerun_target_step: null
  }, null, 2);
  const blockerLines = renderBlockerLines(blockers);
  return renderTemplate("shared/repair_prompt.j2", {
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
    return ["- blocking finding は検出されていません。残っている検証不足や証跡不足を片付けて、次のレビューラウンドへ渡してください。"];
  }
  const lines = [];
  for (const finding of blockers) {
    lines.push(`- [${finding.severity}] ${finding.reviewerLabel}: ${finding.title}`);
    if (finding.evidence) {
      lines.push(`  - 証拠: ${finding.evidence}`);
    }
    if (finding.recommendation) {
      lines.push(`  - 推奨対応: ${finding.recommendation}`);
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
