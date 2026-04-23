import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getStep, nextStep } from "./flow.mjs";
import { loadStepInterruptions, renderInterruptionsForPrompt } from "./interruptions.mjs";

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

export function renderStepPrompt({ repoPath, run, flow, step, interruptions = [] }) {
  const ticket = readRepoFile(repoPath, "current-ticket.md");
  const note = readRepoFile(repoPath, "current-note.md");
  const instructions = stepInstructions(step.id);

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
    "## Required Guards",
    "",
    ...formatGuards(step),
    "",
    "## current-ticket.md",
    "",
    "```markdown",
    ticket.trim() || "(empty)",
    "```",
    "",
    "## current-note.md",
    "",
    "```markdown",
    note.trim() || "(empty)",
    "```",
    ""
  ].join("\n");
}

function readRepoFile(repoPath, path) {
  const fullPath = join(repoPath, path);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : `(missing ${path})`;
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
