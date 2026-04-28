import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildFlowView, getStep, nextStep, resolveStepReviewPlan } from "./flow.mjs";
import { defaultAcceptedJudgementStatus, defaultJudgementKind } from "./judgements.mjs";
import { loadStepInterruptions, renderInterruptionsForPrompt } from "./interruptions.mjs";
import { renderUiOutputPromptSection } from "./step-ui.mjs";
import { hasStepPrompt, renderStepPromptBody } from "./step-prompts.mjs";

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

  return [
    "# pdh-flow Step Prompt",
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
    "## Interruptions",
    "",
    ...renderInterruptionsForPrompt(interruptions),
    "",
    ...(stepBody
      ? [stepBody.trimEnd(), ""]
      : [
          "## Step Instructions",
          "",
          `- Execute ${step.id} according to the flow definition and repo rules.`,
          `- Update canonical records and satisfy the guards for ${step.id}.`,
          ""
        ]),
    ...(reviewerOutputs?.length ? renderReviewerOutputsSection(reviewerOutputs) : []),
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

function renderReviewerOutputsSection(reviewerOutputs) {
  const lines = [
    "## Reviewer Outputs",
    "",
    `Runtime ran ${reviewerOutputs.length} reviewer${reviewerOutputs.length === 1 ? "" : "s"} in parallel for this round. Their \`review.json\` artifacts are listed below in full so you can read them without opening additional files. Treat each block as the canonical output of that reviewer.`,
    ""
  ];
  for (const reviewer of reviewerOutputs) {
    lines.push(`### ${reviewer.label} (${reviewer.reviewerId})`);
    lines.push("");
    if (reviewer.provider) {
      lines.push(`- provider: ${reviewer.provider}`);
    }
    if (reviewer.round !== null && reviewer.round !== undefined) {
      lines.push(`- round: ${reviewer.round}`);
    }
    if (reviewer.artifactPath) {
      lines.push(`- artifact: \`${reviewer.artifactPath}\``);
    }
    if (reviewer.status) {
      lines.push(`- status: ${reviewer.status}`);
    }
    lines.push("");
    if (reviewer.rawText) {
      lines.push("```json");
      lines.push(reviewer.rawText.trimEnd());
      lines.push("```");
    } else {
      lines.push("_(reviewer produced no readable output)_");
    }
    lines.push("");
  }
  return lines;
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
    ? `.pdh-flow/runs/${run.id}/steps/${step.id}/review-rounds/round-${round}/reviewers/${reviewer.reviewerId}/review.json`
    : `.pdh-flow/runs/${run.id}/steps/${step.id}/reviewers/${reviewer.reviewerId}/review.json`;
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
    `Write valid JSON to \`${outputPath}\`.`,
    "Do not use markdown fences. Do not add extra top-level keys. All keys and strings must be double-quoted; escape inner double quotes with `\\\"` and backslashes with `\\\\`.",
    "",
    "Field rules:",
    "- `status`: exact reviewer conclusion string.",
    "- `summary`: one short sentence.",
    "- `findings`: use `[]` when there are no findings.",
    "- `notes`: optional free text. Multi-line content uses `\\n` inside the JSON string.",
    "- Each finding must have `severity`, `title`, `evidence`, and `recommendation`.",
    "- Allowed severities: `critical`, `major`, `minor`, `note`, `none`.",
    "- Match the primary language used in `current-ticket.md` for all human-readable text in this file.",
    ...(acceptedStatus ? [`- Use \`status: ${acceptedStatus}\` only when your latest review has no unresolved blocker at that threshold.`] : []),
    "",
    "Use this JSON shape:",
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
}

export function renderReviewRepairPrompt({ repoPath, run, flow, step, reviewPlan, aggregate, round, provider }) {
  const outputPath = `.pdh-flow/runs/${run.id}/steps/${step.id}/review-rounds/round-${round}/repair.json`;
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
    `Write valid JSON to \`${outputPath}\`.`,
    "Do not use markdown fences. Do not add extra top-level keys. All keys and strings must be double-quoted; escape inner double quotes with `\\\"` and backslashes with `\\\\`.",
    "",
    "Field rules:",
    "- `summary`: one short sentence describing what you changed.",
    "- `verification`: commands or checks you actually ran in this repair round.",
    "- `remaining_risks`: unresolved blockers or follow-up risks only. Use `[]` when there are none.",
    "- `notes`: optional free text. Multi-line content uses `\\n` inside the JSON string.",
    "",
    "Use this JSON shape:",
    "",
    JSON.stringify({
      summary: "Short repair summary",
      verification: [
        "command or check that was actually run"
      ],
      remaining_risks: [
        "Unresolved blocker or follow-up risk"
      ],
      notes: "Optional free text"
    }, null, 2),
    ""
  );
  return lines.join("\n");
}

function acceptedReviewerStatus(stepId) {
  const kind = defaultJudgementKind(stepId);
  return kind ? defaultAcceptedJudgementStatus(kind) : null;
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
