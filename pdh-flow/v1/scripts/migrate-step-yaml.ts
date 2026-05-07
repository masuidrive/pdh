#!/usr/bin/env node
// Throwaway migration: rewrite flows/steps/PD-C-*.yaml from the old
// (ui:/promptContext:/inline review:) layout to the new
// (display:/prompt:/top-level identifiers + behavior) layout.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { AnyRecord } from "../src/types.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: migrate-step-yaml.ts <flows/steps/>");
  process.exit(1);
}

// Hardcoded carried-over fields (will move INTO the yaml here).
const NOTE_SECTIONS = {
  "PD-C-2": "PD-C-2. 調査結果",
  "PD-C-3": "PD-C-3. 計画",
  "PD-C-4": "PD-C-4. 計画レビュー結果",
  "PD-C-5": "PD-C-5. 実装承認待ち",
  "PD-C-6": "PD-C-6. 実装",
  "PD-C-7": "PD-C-7. 品質検証結果",
  "PD-C-8": "PD-C-8. 目的妥当性確認",
  "PD-C-9": "PD-C-9. プロセスチェックリスト",
  "PD-C-10": "PD-C-10. クローズ準備"
};

const JUDGEMENTS = {
  "PD-C-4": { kind: "plan_review", acceptedStatuses: ["No Critical/Major", "user_accepted"] },
  "PD-C-7": { kind: "quality_review", acceptedStatuses: ["No Critical/Major", "user_accepted"] },
  "PD-C-8": { kind: "purpose_validation", acceptedStatuses: ["No Unverified", "user_accepted"] },
  "PD-C-9": { kind: "ac_verification", acceptedStatuses: ["Ready", "user_accepted"] },
  "PD-C-10": { kind: "close-gate", acceptedStatuses: ["Ready", "user_accepted"] }
};

// Pulled from src/runtime/assist-runtime.ts::checkpointsForStep map.
const ASSIST_CHECKPOINTS = {
  "PD-C-3": [
    "Lock the plan to a single concrete implementation path before review.",
    "Make ownership, verification commands, and risks explicit so PD-C-6 can execute deterministically."
  ],
  "PD-C-4": [
    "Push unresolved plan issues back to PD-C-3 with concrete revisions instead of vague cautionary notes."
  ],
  "PD-C-5": [
    "Surface the implementation plan, blast radius, and explicit risks so the human can approve confidently.",
    "Do not approve here yourself; runtime owns the gate."
  ],
  "PD-C-6": [
    "Stay inside the approved plan unless current repo evidence forces a scoped correction; record the correction.",
    "Run the smallest meaningful verification first, then broader checks when the blast radius requires it."
  ],
  "PD-C-7": [
    "Resolve critical and major findings with code or verification evidence, then rerun the same quality step.",
    "Do not clear a serious finding just because notes say it is fixed; verify the latest repo state."
  ],
  "PD-C-8": [
    "Look for missing outcomes, missing coverage, and reasons the ticket still should not close.",
    "If the implementation or scope must change, expect to route back through PD-C-6 or earlier review."
  ],
  "PD-C-9": [
    "Every Acceptance Criteria item needs explicit evidence in `Acceptance Criteria 裏取り結果`.",
    "Check changed user-facing surfaces as a consumer, not only through unit-style evidence."
  ],
  "PD-C-10": [
    "Only propose close when Acceptance Criteria evidence, user verification guidance, and residual risks are all explicit.",
    "If code or evidence changed during the gate, expect a rerun proposal instead of close."
  ]
};

// Pulled from src/web/index.ts::approveProposalLabelForStep / approveActionDescriptionForStep.
const APPROVE_DISPLAY = {
  "PD-C-5": {
    label: "実装開始",
    description: "計画を承認して PD-C-6 (実装) に進めます。"
  },
  "PD-C-10": {
    label: "チケット完了",
    description: "この close-gate をそのまま通し、ticket を close して flow を完了します。"
  }
};

// Default rerun-from target for review steps (where the runtime should
// jump back when the in-place repair budget is exhausted).
const DEFAULT_RERUN = {
  "PD-C-4": "PD-C-3",
  "PD-C-7": "PD-C-6",
  "PD-C-9": "PD-C-6"
};

for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
  const path = join(dir, file);
  const old = (parse(readFileSync(path, "utf8")) ?? {}) as AnyRecord;
  const id = old.id;

  const display: AnyRecord = {};
  if (old.label !== undefined) display.label = old.label;
  if (old.summary !== undefined) display.summary = old.summary;
  if (old.userAction !== undefined) display.userAction = old.userAction;
  if (old.ui?.viewer !== undefined) display.viewer = old.ui.viewer;
  if (old.ui?.decision !== undefined) display.decision = old.ui.decision;
  if (old.ui?.mustShow !== undefined) display.mustShow = old.ui.mustShow;
  if (old.ui?.omit !== undefined) display.omit = old.ui.omit;
  if (APPROVE_DISPLAY[id]) display.approve = APPROVE_DISPLAY[id];

  const prompt: AnyRecord = { body: `${id}.j2` };
  if (old.promptContext?.contextSummary !== undefined) prompt.contextSummary = old.promptContext.contextSummary;
  if (old.promptContext?.semanticRules !== undefined) prompt.semanticRules = old.promptContext.semanticRules;
  if (old.review?.intent !== undefined) prompt.intent = old.review.intent;
  if (old.review?.passWhen !== undefined) prompt.passWhen = old.review.passWhen;
  if (old.review?.onFindings !== undefined) prompt.onFindings = old.review.onFindings;
  if (old.review?.reviewerRules !== undefined) prompt.reviewerRules = old.review.reviewerRules;
  if (old.review?.repairRules !== undefined) prompt.repairRules = old.review.repairRules;
  if (ASSIST_CHECKPOINTS[id]) prompt.assistCheckpoints = ASSIST_CHECKPOINTS[id];

  const out: AnyRecord = {
    id,
    role: old.role ?? null,
    mode: old.mode ?? "edit",
    humanGate: old.humanGate === true || undefined,
    noteSection: NOTE_SECTIONS[id] ?? undefined,
    judgement: JUDGEMENTS[id] ?? undefined,
    review: old.mode === "review"
      ? {
          maxRounds: old.review?.maxRounds ?? 6,
          defaultRerunStep: DEFAULT_RERUN[id] ?? "PD-C-6"
        }
      : undefined,
    display,
    prompt,
    guards: old.guards ?? [],
    transitions: undefined
  };

  // Collect transitions: keep on_success / on_failure / on_human_*
  const t: AnyRecord = {};
  for (const key of ["on_success", "on_failure", "on_human_approved", "on_human_rejected", "on_human_changes_requested"]) {
    if (old[key] !== undefined) t[key] = old[key];
  }
  if (Object.keys(t).length > 0) {
    out.transitions = t;
  } else {
    delete out.transitions;
  }

  // Drop role if null/undefined.
  if (!out.role) delete out.role;
  if (out.humanGate !== true) delete out.humanGate;
  if (!out.noteSection) delete out.noteSection;
  if (!out.judgement) delete out.judgement;
  if (!out.review) delete out.review;

  const text = stringify(out, { lineWidth: 0 });
  writeFileSync(path, text);
  console.log(`migrated ${file}`);
}
