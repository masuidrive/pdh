import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as yamlStringify } from "yaml";
import { buildFlowView, getStep, nextStep, resolveSkillBodies } from "../load.ts";
import { loadStepInterruptions, renderInterruptionsForPrompt } from "../../runtime/interruptions.ts";
import { previousCompletedStep } from "../../runtime/state.ts";
import { loadStepUiOutput, renderUiOutputPromptSection } from "./ui-output.ts";
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
  const carryover = renderCarryoverFromPredecessor({ repoPath, run, flow, step });

  return renderTemplate("shared/step_prompt.j2", {
    run,
    step,
    successTransition: nextStep(flow, run.flow_variant, step.id, "success"),
    skillBodies,
    interruptionLines: renderInterruptionsForPrompt(interruptions),
    stepBody,
    reviewerOutputs: reviewerOutputs ?? [],
    carryoverBlock: carryover,
    guardLines: formatGuards(step),
    reviewSemanticsLines: renderReviewSemantics(step, reviewPlan),
    hasReviewers: Boolean(reviewPlan?.reviewers?.length),
    uiOutputLines: renderUiOutputPromptSection({ run, step })
  });
}

// Auto-embed the immediate predecessor step's `ui_output.carryover_fields`.
//
// Producer-side declaration only: the predecessor step yaml lists which of
// its ui-output.json fields are clean for handoff. The current step does
// NOT declare what it consumes — this keeps cross-step coupling out of step
// yaml and preserves add/remove flexibility (no consumer needs touching
// when a step is added, removed, or reordered).
//
// Returns null when:
//   - no predecessor (e.g. PD-C-1 itself)
//   - predecessor declared no carryover_fields
//   - predecessor's ui-output.json is missing or empty
//
// Returns a markdown block (string) ready to inject into the prompt.
function renderCarryoverFromPredecessor({ repoPath, run, flow, step }) {
  if (!run?.id) return null;
  const previousStepId = previousCompletedStep({
    repoPath,
    runId: run.id,
    currentStepId: step.id
  });
  if (!previousStepId) return null;

  let prevStep;
  try {
    prevStep = getStep(flow, previousStepId);
  } catch {
    return null;
  }
  const carryoverFields = prevStep?.ui_output?.carryover_fields
    ?? prevStep?.uiOutput?.carryover_fields
    ?? prevStep?.display?.carryover_fields
    ?? [];
  if (!Array.isArray(carryoverFields) || carryoverFields.length === 0) {
    return null;
  }

  const stateDir = `${repoPath}/.pdh-flow`;
  const prevUi = loadStepUiOutput({ stateDir, runId: run.id, stepId: previousStepId });
  if (!prevUi) return null;

  // ui-output normalization renames snake_case to camelCase for some fields.
  // Try both shapes when extracting.
  const slim: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const fieldName of carryoverFields) {
    const value = prevUi[fieldName] ?? prevUi[snakeToCamel(fieldName)];
    if (value === undefined || value === null) {
      missing.push(fieldName);
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      missing.push(fieldName);
      continue;
    }
    slim[fieldName] = value;
  }
  if (Object.keys(slim).length === 0) return null;

  const dump = yamlStringify(slim, { lineWidth: 0, blockQuote: "literal", indent: 2 });
  const lines = [
    `## 直前ステップの引き継ぎ (${previousStepId})`,
    "",
    `${previousStepId} の \`ui-output.json\` から producer が指定した引き継ぎフィールドだけを抜粋しています。`,
    "正本は `.pdh-flow/runs/<run>/steps/" + previousStepId + "/ui-output.json` です。",
    "",
    "```yaml",
    dump.trimEnd(),
    "```"
  ];
  if (missing.length > 0) {
    lines.push("");
    lines.push(`(producer が \`carryover_fields\` で宣言したが ui-output.json に書かなかった field: ${missing.join(", ")})`);
  }
  return lines.join("\n");
}

function snakeToCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
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
