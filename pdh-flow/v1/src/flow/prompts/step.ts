import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildFlowView, getStep, nextStep, resolveSkillBodies } from "../load.ts";
import { loadStepInterruptions, renderInterruptionsForPrompt } from "../../runtime/interruptions.ts";
import { renderUiOutputPromptSection } from "./ui-output.ts";
import { hasStepPrompt, renderStepPromptBody } from "./step-bodies.ts";
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
