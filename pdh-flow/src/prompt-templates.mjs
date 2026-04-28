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

export function renderStepPrompt({ repoPath, run, flow, step, interruptions = [] }) {
  const instructions = stepInstructions(step.id);
  const promptContext = mergePromptContext(flow, step);
  const flowView = buildFlowView(flow, run.flow_variant, step.id);
  const flowStep = flowView.steps.find((item) => item.id === step.id);
  const reviewPlan = flowStep?.review ?? null;

  return [
    "# pdh-flow Provider Prompt",
    "",
    "You are executing one PDH ticket-development step inside `pdh-flow`.",
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
    "- If local evidence is insufficient and you need one precise user answer, run `node src/provider-cli.mjs ask --repo . --message \"<question>\"` and then stop.",
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

export function renderReviewerPrompt({ repoPath, run, flow, step, reviewPlan, reviewer, round = null, priorFindings = [] }) {
  const acceptedStatus = acceptedReviewerStatus(step.id);
  const outputPath = round
    ? `.pdh-flow/runs/${run.id}/steps/${step.id}/review-rounds/round-${round}/reviewers/${reviewer.reviewerId}/review.yaml`
    : `.pdh-flow/runs/${run.id}/steps/${step.id}/reviewers/${reviewer.reviewerId}/review.yaml`;
  const reviewerStepRules = reviewerRulesForStep(step.id);
  return [
    "# pdh-flow Reviewer Prompt",
    "",
    `You are ${reviewer.label} for ${step.id}.`,
    "This is a fresh reviewer role owned by pdh-flow runtime semantics.",
    "",
    "## Run Context",
    "",
    `- Run: ${run.id}`,
    `- Ticket: ${run.ticket_id ?? "(none)"}`,
    `- Flow: ${run.flow_id}@${run.flow_variant}`,
    `- Step: ${step.id}`,
    `- Reviewer role: ${reviewer.label}`,
    ...(round ? [`- Review round: ${round}`] : []),
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
    "- Prioritize critical and major findings over nits. If severe issues remain, do not spend the review on style-only comments.",
    "- Review the purpose of the plan or change, not only generic code-style concerns.",
    "- Do not dismiss a finding just because the plan or note claims it is handled. Look for direct evidence in the current repo state.",
    "- If this reviewer role previously raised a blocker, clear it only when the latest repo state resolves it.",
    "- The runtime unions the latest reviewer results across roles. Do not assume PM or another reviewer will downgrade your severity for you.",
    ...(reviewPlan.intent ? [`- Review intent: ${reviewPlan.intent}`] : []),
    ...(reviewPlan.passWhen?.length ? ["- Step pass conditions:", ...reviewPlan.passWhen.map((item) => `  - ${item}`)] : []),
    ...(reviewPlan.onFindings?.length ? ["- If findings remain:", ...reviewPlan.onFindings.map((item) => `  - ${item}`)] : []),
    ...(reviewer.focus?.length ? ["- Your focus:", ...reviewer.focus.map((item) => `  - ${item}`)] : ["- Your focus: (none)"]),
    ...(reviewerStepRules.length ? ["- Step-specific review rules:", ...reviewerStepRules.map((item) => `  - ${item}`)] : []),
    ...(priorFindings.length
      ? [
          "- Prior blocking findings from this reviewer role that must be re-checked in this round:",
          ...priorFindings.map((finding) => `  - [${finding.severity}] ${finding.title}: ${finding.evidence || finding.recommendation || "re-check against the latest repo state"}`),
          "- Clear these only when the current repo state directly resolves them."
        ]
      : []),
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

export function renderReviewRepairPrompt({ repoPath, run, flow, step, reviewPlan, aggregate, round, provider }) {
  const outputPath = `.pdh-flow/runs/${run.id}/steps/${step.id}/review-rounds/round-${round}/repair.yaml`;
  const lines = [
    "# pdh-flow Review Repair Prompt",
    "",
    `You are the repair provider for ${step.id} round ${round}.`,
    "Your job is to resolve the current blocking review findings, update the repo state, run the smallest meaningful verification, and prepare the next review round.",
    "",
    "## Run Context",
    "",
    `- Run: ${run.id}`,
    `- Ticket: ${run.ticket_id ?? "(none)"}`,
    `- Flow: ${run.flow_id}@${run.flow_variant}`,
    `- Step: ${step.id}`,
    `- Review round: ${round}`,
    `- Repair provider: ${provider}`,
    ...(reviewPlan?.intent ? [`- Review intent: ${reviewPlan.intent}`] : []),
    "",
    "## Repair Rules",
    "",
    "- Read `current-ticket.md` and `current-note.md` before editing.",
    "- Resolve the current blocking findings for this step only. Do not drift into later steps.",
    "- You may edit code, tests, `current-ticket.md`, and `current-note.md` when needed to satisfy the findings.",
    "- Do not commit.",
    "- Do not run `ticket.sh` or `node src/cli.mjs ...`.",
    "- Run the smallest meaningful verification that proves the addressed findings are actually resolved.",
    "- Keep your changes consistent with existing local patterns instead of inventing a parallel design.",
    "- If you cannot fully resolve every blocker in this round, still fix the highest-leverage subset and record what remains.",
    "- Match the primary language used in `current-ticket.md` for all human-readable text in the output artifact.",
    ...reviewRepairRulesForStep(step.id).map((rule) => `- ${rule}`),
    "",
    "## Canonical Files",
    "",
    "- `current-ticket.md` at repo root: durable ticket intent, Product AC, and implementation notes.",
    "- `current-note.md` at repo root: workflow state in frontmatter plus process evidence and step history.",
    "",
    "## Current Blocking Findings",
    ""
  ];
  const blockers = blockingFindings(aggregate);
  if (blockers.length === 0) {
    lines.push("- No blocking findings were detected. Clean up any remaining verification or evidence gaps and prepare for the next review round.");
  } else {
    for (const finding of blockers) {
      lines.push(`- [${finding.severity}] ${finding.reviewerLabel}: ${finding.title}`);
      if (finding.evidence) {
        lines.push(`  - Evidence: ${finding.evidence}`);
      }
      if (finding.recommendation) {
        lines.push(`  - Recommendation: ${finding.recommendation}`);
      }
    }
  }
  lines.push(
    "",
    "## Output Artifact",
    "",
    `Write plain YAML to \`${outputPath}\`.`,
    "Do not use markdown fences. Do not add extra top-level keys.",
    "",
    "Field rules:",
    "- `summary`: one short sentence describing what you changed.",
    "- `verification`: commands or checks you actually ran in this repair round.",
    "- `remaining_risks`: unresolved blockers or follow-up risks only. Use `[]` when there are none.",
    "- `notes`: optional free text.",
    "",
    "Use this YAML shape:",
    "",
    stringify({
      summary: "Short repair summary",
      verification: [
        "command or check that was actually run"
      ],
      remaining_risks: [
        "Unresolved blocker or follow-up risk"
      ],
      notes: "Optional free text"
    }).trimEnd(),
    ""
  );
  return lines.join("\n");
}

function acceptedReviewerStatus(stepId) {
  const kind = defaultJudgementKind(stepId);
  return kind ? defaultAcceptedJudgementStatus(kind) : null;
}

function stepInstructions(stepId) {
  const instructions = {
    "PD-C-2": [
      "Investigate the current implementation, design history, execution paths, and blast radius.",
      "Check recent git history for relevant files and read related tickets or notes when available.",
      "Cover at least the app code, tests, UI or API surfaces, SDK or CLI entrypoints, migrations or generated assets, docs or specs, repo rule files, and examples when they are in scope.",
      "Record findings, risks, external dependencies, blast radius, and real-environment verification needs in `current-note.md` under `PD-C-2. 調査結果`.",
      "Write enough concrete evidence that PD-C-3 can plan without redoing the same repository walk.",
      "Commit the investigation record with a subject beginning `[PD-C-2]`."
    ],
    "PD-C-3": [
      "Create an implementation plan from the investigation and ticket goal.",
      "Analyze nearby existing patterns first and prefer the local implementation style over inventing a new abstraction.",
      "Document file-level changes, ownership, file-specific context, design decisions, test plan, E2E or real-environment verification steps, and risk handling in `current-note.md` under `PD-C-3. 計画`.",
      "Record durable design decisions and rationale in `current-ticket.md` under `Implementation Notes`.",
      "Include how the PD-C-2 concerns will be handled, not just a happy-path implementation outline.",
      "Choose a concrete plan from local evidence instead of leaving unresolved options for the user.",
      "Commit the plan with a subject beginning `[PD-C-3]`."
    ],
    "PD-C-4": [
      "Review the plan for Full flow before implementation starts.",
      "Evaluate whether the plan solves the ticket purpose, follows existing patterns, covers risks, and has a credible test or verification path.",
      "Review the proposed correction strategy, not just the historical bug report or current code smell list.",
      "Record the integrated review result in `current-note.md` under `PD-C-4. 計画レビュー結果`.",
      "Use `No Critical/Major` only when there are no unresolved critical or major issues; otherwise state the required revision.",
      "Commit the review with a subject beginning `[PD-C-4]`."
    ],
    "PD-C-6": [
      "Implement the approved plan with changes scoped to this ticket.",
      "Keep `current-ticket.md`, `current-note.md`, code, and tests consistent with the approved plan as you implement.",
      "Update `current-note.md` under `PD-C-6` with implementation summary, changed files, tests run, remaining risks, and any deviations from the original plan.",
      "Run the smallest meaningful verification first; broaden coverage when the change risk or affected surface requires it.",
      "If `scripts/test-all.sh` exists and is appropriate for this repo, run it or record why it cannot be run.",
      "Do not treat failing, skipped, or environment-blocked verification as complete implementation.",
      "Commit the implementation with a subject beginning `[PD-C-6]`."
    ],
    "PD-C-7": [
      "Review the implemented change for quality, regressions, authorization or data-integrity issues, security, error handling, and test adequacy.",
      "Check the change against product-brief intent and Acceptance Criteria.",
      "When critical or major findings remain, push concrete corrections, rerun impacted verification, and review again until the latest reviewer state is clear or user-accepted.",
      "Record quality verification in `current-note.md` under `PD-C-7. 品質検証結果`.",
      "Use `No Critical/Major` only when all latest reviewer concerns at those severities are resolved or explicitly user-accepted.",
      "Commit the review result with a subject beginning `[PD-C-7]`."
    ],
    "PD-C-8": [
      "Validate purpose fit: look for reasons the ticket should not close even if the implementation appears correct.",
      "Review every Acceptance Criteria item and classify it as `verified`, `deferred`, or `unverified` with evidence.",
      "Act like a counterexample-seeking product reviewer: look for missing outcomes, missing scope, and things that should have been written but were not.",
      "Record purpose validation in `current-note.md` under `PD-C-8. 目的妥当性確認`.",
      "Do not treat follow-up work as acceptable deferral unless there is explicit user approval and a real follow-up ticket.",
      "Commit the validation with a subject beginning `[PD-C-8]`."
    ],
    "PD-C-9": [
      "Perform final verification against every product Acceptance Criteria and process checklist item.",
      "Write or update `AC 裏取り結果` in `current-note.md` with one row per AC: item, classification, status, evidence, and deferral ticket.",
      "Run final verification commands appropriate for the repo, including `scripts/test-all.sh` when present and applicable.",
      "Check changed external surfaces from a consumer perspective when the ticket affects UI, HTTP API, SDK, or CLI behavior.",
      "Do not leave any AC as implicit. `unverified` means the ticket is not ready to close.",
      "Commit final verification evidence with a subject beginning `[PD-C-9]`."
    ]
  };
  return instructions[stepId] ?? [
    `Execute ${stepId} according to the flow definition and repo rules.`,
    `Update canonical records and satisfy the guards for ${stepId}.`,
    `Commit with a subject beginning \`[${stepId}]\`.`
  ];
}

function reviewerRulesForStep(stepId) {
  const rules = {
    "PD-C-4": [
      "Judge whether the plan's correction strategy is credible for this repo and ticket purpose.",
      "Push plan changes back to PD-C-3 with concrete revisions instead of vague cautionary notes."
    ],
    "PD-C-7": [
      "Focus on regressions, security, authorization, data integrity, error handling, and test adequacy against the implemented diff.",
      "If the repo state changed after earlier severe findings, explicitly check whether those findings are now resolved."
    ],
    "PD-C-8": [
      "Try to find reasons the ticket should not close, especially missing outcomes or insufficient delivery against the product intent.",
      "Treat unverified or weakly evidenced Acceptance Criteria as blocking, not as optional polish."
    ],
    "PD-C-9": [
      "Treat any unverified Acceptance Criteria row or missing external-surface evidence as blocking.",
      "Prefer direct evidence over assertions from notes when the two conflict."
    ]
  };
  return rules[stepId] ?? [];
}

function reviewRepairRulesForStep(stepId) {
  const rules = {
    "PD-C-4": [
      "Treat this as a plan repair loop. Prefer updating `current-ticket.md` and `current-note.md` over editing app code unless the finding proves the plan is impossible without a code spike.",
      "If the plan changes materially, keep Product AC, implementation notes, and the PD-C-3 plan section aligned."
    ],
    "PD-C-7": [
      "Treat this as a code-quality repair loop. Fix the implementation and impacted tests, then rerun only the verification needed for the changed surface.",
      "Do not claim quality blockers are resolved unless the changed code path is covered by direct evidence."
    ],
    "PD-C-8": [
      "Treat this as a purpose-fit repair loop. Close missing AC coverage, missing outcomes, or weak evidence, and update ticket intent when the product scope changed.",
      "If AC verification evidence is missing or incomplete, write or update `AC 裏取り結果` in `current-note.md` now instead of deferring that record to a later step.",
      "If you change code or tests here, make sure `current-note.md` explains why the purpose validation required it."
    ],
    "PD-C-9": [
      "Treat this as a final-verification repair loop. Fill missing AC evidence and final verification gaps rather than normalizing them away.",
      "If external-surface observations found problems, fix the surface or its evidence before the next review round."
    ]
  };
  return rules[stepId] ?? [];
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
