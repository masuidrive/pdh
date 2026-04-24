import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { buildFlowView, getStep, nextStep, resolveStepReviewPlan } from "./flow.mjs";
import { defaultAcceptedJudgementStatus, defaultJudgementKind } from "./judgements.mjs";
import { loadStepInterruptions, renderInterruptionsForPrompt } from "./interruptions.mjs";
import { renderUiOutputPromptSection } from "./step-ui.mjs";

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

export function writeReviewerPromptArtifact({ repoPath, stateDir, run, flow, stepId, reviewer }) {
  const step = getStep(flow, stepId);
  const reviewPlan = resolveStepReviewPlan(flow, run.flow_variant, stepId);
  if (!reviewPlan) {
    throw new Error(`${stepId} does not define runtime review semantics`);
  }
  const artifactPath = join(stateDir, "runs", run.id, "steps", stepId, "reviewers", reviewer.reviewerId, "prompt.md");
  mkdirSync(join(artifactPath, ".."), { recursive: true });
  const body = renderReviewerPrompt({ repoPath, run, flow, step, reviewPlan, reviewer });
  writeFileSync(artifactPath, body);
  return { artifactPath, body };
}

export function renderStepPrompt({ repoPath, run, flow, step, interruptions = [] }) {
  const instructions = stepInstructions(step.id);
  const promptContext = mergePromptContext(flow, step);
  const flowView = buildFlowView(flow, run.flow_variant, step.id);
  const flowStep = flowView.steps.find((item) => item.id === step.id);
  const reviewPlan = flowStep?.review ?? null;

  return [
    "# pdh-flowchart Provider Prompt",
    "",
    "You are executing one PDH ticket-development step inside `pdh-flowchart`.",
    "Do only the current step. Do not claim later gates are complete.",
    "",
    "## Run Context",
    "",
    `- Run: ${run.id}`,
    `- Ticket: ${run.ticket_id ?? "(none)"}`,
    `- Flow: ${run.flow_id}@${run.flow_variant}`,
    `- Current step: ${step.id}`,
    `- Provider: ${step.provider}`,
    `- Mode: ${step.mode}`,
    ...(step.summary ? [`- Step summary: ${step.summary}`] : []),
    `- Success transition: ${nextStep(flow, run.flow_variant, step.id, "success") ?? "(none)"}`,
    "",
    "## Operating Rules",
    "",
    "- Treat `current-ticket.md` and `current-note.md` as the canonical records.",
    "- Keep changes scoped to this step's purpose.",
    `- Before finishing, satisfy every guard listed for ${step.id}.`,
    `- If you commit, the commit subject must start with \`[${step.id}]\`.`,
    "- If a guard cannot be satisfied, record the blocker in `current-note.md` and explain what is missing.",
    "- If answered interruptions are listed below, treat them as user instructions for this step.",
    "- If an open interruption is listed, stop and report that user input is still required.",
    "- Do not ask the user to choose among implementation options if local evidence is enough to decide.",
    "- Do not mark PD-C-5 or PD-C-10 approved; those are explicit human gates.",
    "",
    "## Interruptions",
    "",
    ...renderInterruptionsForPrompt(interruptions),
    "",
    "## Step Instructions",
    "",
    ...instructions.map((line) => `- ${line}`),
    "",
    "## Canonical Files",
    "",
    "- `current-ticket.md` at repo root: durable ticket intent, Product AC, and implementation notes.",
    "- `current-note.md` at repo root: workflow state in frontmatter plus process evidence and step history.",
    "- Read both files before acting. Use repo-local references called out there when you need additional context.",
    "",
    "## Compiled Context",
    "",
    ...(renderPromptContext(promptContext)),
    "",
    "## Required Guards",
    "",
    ...formatGuards(step),
    "",
    ...renderReviewSemantics(step, reviewPlan),
    ...((step.mode === "review" || reviewPlan?.reviewers?.length) ? [""] : []),
    ...renderUiOutputPromptSection({ run, step }),
    ""
  ].join("\n");
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
    "- This repo owns the review semantics for this step. Do not rely on external `pdh-dev` or `tmux-director` skills for missing rules."
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
  if (reviewPlan?.reviewers?.length) {
    lines.push("- Reviewer roster for this run variant:");
    for (const reviewer of reviewPlan.reviewers) {
      lines.push(`  - ${reviewer.label} x${reviewer.count}`);
      if (reviewer.remit) {
        lines.push(`    - remit: ${reviewer.remit}`);
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

export function renderReviewerPrompt({ repoPath, run, flow, step, reviewPlan, reviewer }) {
  const acceptedStatus = acceptedReviewerStatus(step.id);
  const outputPath = `.pdh-flowchart/runs/${run.id}/steps/${step.id}/reviewers/${reviewer.reviewerId}/review.yaml`;
  return [
    "# pdh-flowchart Reviewer Prompt",
    "",
    `You are ${reviewer.label} for ${step.id}.`,
    "This is a fresh reviewer role owned by pdh-flowchart runtime semantics.",
    "",
    "## Run Context",
    "",
    `- Run: ${run.id}`,
    `- Ticket: ${run.ticket_id ?? "(none)"}`,
    `- Flow: ${run.flow_id}@${run.flow_variant}`,
    `- Step: ${step.id}`,
    `- Reviewer role: ${reviewer.label}`,
    ...(reviewer.provider ? [`- Provider: ${reviewer.provider}`] : []),
    ...(reviewer.remit ? [`- Remit: ${reviewer.remit}`] : []),
    "",
    "## Reviewer Rules",
    "",
    "- Review the current repo state for this step only.",
    "- Read `current-ticket.md` and `current-note.md` before concluding.",
    "- Do not edit repo files.",
    "- Do not commit.",
    "- Do not run `ticket.sh` or `node src/cli.mjs ...`.",
    "- You may inspect git diff, read files, and run narrowly scoped verification commands when needed.",
    "- This repo owns review semantics. Do not rely on external `pdh-dev` or `tmux-director` skills for missing rules.",
    ...(reviewPlan.intent ? [`- Review intent: ${reviewPlan.intent}`] : []),
    ...(reviewPlan.passWhen?.length ? ["- Step pass conditions:", ...reviewPlan.passWhen.map((item) => `  - ${item}`)] : []),
    ...(reviewPlan.onFindings?.length ? ["- If findings remain:", ...reviewPlan.onFindings.map((item) => `  - ${item}`)] : []),
    ...(reviewer.focus?.length ? ["- Your focus:", ...reviewer.focus.map((item) => `  - ${item}`)] : ["- Your focus: (none)"]),
    "",
    "## Canonical Files",
    "",
    "- `current-ticket.md` at repo root: durable ticket intent, Product AC, and implementation notes.",
    "- `current-note.md` at repo root: workflow state in frontmatter plus process evidence and step history.",
    "- Read both files before acting. Use repo-local references called out there when you need additional context.",
    "",
    "## Output Artifact",
    "",
    `Write plain YAML to \`${outputPath}\`.`,
    "Do not use markdown fences. Do not add extra top-level keys.",
    "",
    "Field rules:",
    "- `status`: exact reviewer conclusion string.",
    "- `summary`: one short sentence.",
    "- `findings`: use `[]` when there are no findings.",
    "- `notes`: optional free text.",
    "- Each finding must have `severity`, `title`, `evidence`, and `recommendation`.",
    "- Allowed severities: `critical`, `major`, `minor`, `note`, `none`.",
    "- Match the primary language used in `current-ticket.md` for all human-readable text in this file.",
    ...(acceptedStatus ? [`- Use \`status: ${acceptedStatus}\` only when your latest review has no unresolved blocker at that threshold.`] : []),
    "",
    "Use this YAML shape:",
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
}

function acceptedReviewerStatus(stepId) {
  const kind = defaultJudgementKind(stepId);
  return kind ? defaultAcceptedJudgementStatus(kind) : null;
}

function stepInstructions(stepId) {
  const instructions = {
    "PD-C-2": [
      "Investigate the current implementation, design history, execution paths, and blast radius.",
      "Check recent git history for relevant files and read related tickets when available.",
      "Record findings, risks, external dependencies, and real-environment verification needs in `current-note.md` under `PD-C-2. 調査結果`.",
      "Commit the investigation record with a subject beginning `[PD-C-2]`."
    ],
    "PD-C-3": [
      "Create an implementation plan from the investigation and ticket goal.",
      "Document file-level changes, ownership/context, design decisions, test plan, E2E or real-environment verification steps, and risk handling in `current-note.md` under `PD-C-3. 計画`.",
      "Record durable design decisions and rationale in `current-ticket.md` under `Implementation Notes`.",
      "Choose a concrete plan from local evidence instead of leaving unresolved options for the user.",
      "Commit the plan with a subject beginning `[PD-C-3]`."
    ],
    "PD-C-4": [
      "Review the plan for Full flow before implementation starts.",
      "Evaluate whether the plan solves the ticket purpose, follows existing patterns, covers risks, and has a credible test/verification path.",
      "Record the integrated review result in `current-note.md` under `PD-C-4. 計画レビュー結果`.",
      "Use `No Critical/Major` only when there are no unresolved critical or major issues; otherwise state the required revision.",
      "Commit the review with a subject beginning `[PD-C-4]`."
    ],
    "PD-C-6": [
      "Implement the approved plan with changes scoped to this ticket.",
      "Update `current-note.md` under `PD-C-6` with implementation summary, changed files, tests run, and remaining risks.",
      "Run the smallest meaningful verification first; run broader checks when the change risk requires it.",
      "If `scripts/test-all.sh` exists and is appropriate for this repo, run it or record why it cannot be run.",
      "Commit the implementation with a subject beginning `[PD-C-6]`."
    ],
    "PD-C-7": [
      "Review the implemented change for quality, regressions, authorization or data-integrity issues, security, error handling, and test adequacy.",
      "Check the change against product-brief intent and Acceptance Criteria.",
      "Record quality verification in `current-note.md` under `PD-C-7. 品質検証結果`.",
      "Use `No Critical/Major` only when all latest reviewer concerns at those severities are resolved or explicitly user-accepted.",
      "Commit the review result with a subject beginning `[PD-C-7]`."
    ],
    "PD-C-8": [
      "Validate purpose fit: look for reasons the ticket should not close even if the implementation appears correct.",
      "Review every Acceptance Criteria item and classify it as `verified`, `deferred`, or `unverified` with evidence.",
      "Record purpose validation in `current-note.md` under `PD-C-8. 目的妥当性確認`.",
      "Do not treat follow-up work as acceptable deferral unless there is explicit user approval and a real follow-up ticket.",
      "Commit the validation with a subject beginning `[PD-C-8]`."
    ],
    "PD-C-9": [
      "Perform final verification against every product Acceptance Criteria and process checklist item.",
      "Write or update `AC 裏取り結果` in `current-note.md` with one row per AC: item, classification, status, evidence, and deferral ticket.",
      "Run final verification commands appropriate for the repo, including `scripts/test-all.sh` when present and applicable.",
      "Check changed external surfaces from a consumer perspective when the ticket affects UI, HTTP API, SDK, or CLI behavior.",
      "Commit final verification evidence with a subject beginning `[PD-C-9]`."
    ]
  };
  return instructions[stepId] ?? [
    `Execute ${stepId} according to the flow definition and repo rules.`,
    `Update canonical records and satisfy the guards for ${stepId}.`,
    `Commit with a subject beginning \`[${stepId}]\`.`
  ];
}
