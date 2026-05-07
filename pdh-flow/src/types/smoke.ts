// Type-only smoke check: verify the barrel exports resolve and produce
// usable types. This file is import-only; it never executes runtime code.
// Removable once the engine modules import from "../types/index.ts" for real.

import type {
  FlowYAML,
  ProviderStepNode,
  GuardianStepNode,
  GuardianOutput,
  Finding,
  GateStepOutput,
  ProgressEvent,
  EngineSnapshot,
  NoteFrontmatter,
} from "./index.ts";

// Compile-time assertions: the types are usable.
const _flow: FlowYAML = null as unknown as FlowYAML;
const _provider: ProviderStepNode = null as unknown as ProviderStepNode;
const _guardian: GuardianStepNode = null as unknown as GuardianStepNode;

const _output: GuardianOutput = {
  decision: "pass",
  summary: "ok",
  reasoning: "all reviewers passed",
  round: 1,
  evidence_consumed: ["code_quality_review.devils_advocate_1"],
};

const _finding: Finding = {
  severity: "major",
  title: "auth missing",
  evidence_ref: "src/auth.ts:42",
};

const _gate: GateStepOutput = {
  status: "completed",
  node_id: "plan_gate",
  decision: "approved",
  approver: "pdm",
  decided_at: "2026-05-07T22:00:00Z",
};

const _progress: ProgressEvent = {
  v: 1,
  seq: 0,
  kind: "node_started",
  at: "2026-05-07T22:00:00Z",
  run_id: "run-001",
};

const _snapshot: EngineSnapshot = {
  version: 1,
  engine: { name: "pdh-flow", version: "0.2.0" },
  saved_at: "2026-05-07T22:00:00Z",
  run_id: "run-001",
  ticket_id: "260507-220000-test",
  flow: "pdh-c-v2",
  variant: "full",
  xstate_snapshot: {},
};

const _note: NoteFrontmatter = null as unknown as NoteFrontmatter;

// Suppress "unused" diagnostics — purpose is the type assertion above.
export const __types_compile_smoke = {
  _flow,
  _provider,
  _guardian,
  _output,
  _finding,
  _gate,
  _progress,
  _snapshot,
  _note,
};
