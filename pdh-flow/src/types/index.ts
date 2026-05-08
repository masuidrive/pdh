// Barrel re-export of generated schema types.
//
// Generated files under ./generated/ are produced by `npm run gen:types` from
// pdh-flow/schemas/*.schema.json. Edit schemas and regenerate; never edit the
// .d.ts directly.
//
// Cross-file $refs cause json-schema-to-typescript to inline duplicate types
// in multiple .d.ts files, so this barrel imports each type from a single
// "primary" source to avoid ambiguity.

// flow.schema → primary source for all node types + macros + supporting shapes.
export type {
  FlowYAML,
  Variant,
  Defaults,
  Node,
  Transition,
  ProviderStepNode,
  GuardianStepNode,
  GuardianOutputs,
  RepairTransition,
  GateStepNode,
  FormField,
  SystemStepNode,
  TerminalNode,
  ReviewLoopMacro,
  ReviewerSpec,
  AggregatorSpec,
  RepairSpec,
  PromptSpec,
} from "./generated/flow.schema.d.ts";

// flat-flow.schema → only the parallel-group + compiled wrapper are unique.
export type {
  CompiledFlatFlow,
  FlatNode,
  ParallelGroup,
} from "./generated/flat-flow.schema.d.ts";

// Provider step output + its EvidenceRef alias.
export type {
  ProviderStepOutput,
  EvidenceRef,
} from "./generated/provider-output.schema.d.ts";

// Guardian (LLM-as-judge) output + finding shape.
export type {
  GuardianLLMAsJudgeOutput as GuardianOutput,
  Finding,
} from "./generated/guardian-output.schema.d.ts";

// Gate step output (human approval record).
export type { GateStepOutput } from "./generated/gate-output.schema.d.ts";

// System step output (deterministic runtime work).
export type { SystemStepOutput } from "./generated/system-output.schema.d.ts";

// Frozen judgement (= guardian output + freeze metadata).
export type { FrozenJudgement } from "./generated/judgement.schema.d.ts";

// current-note.md frontmatter (canonical runtime state).
export type {
  CurrentNoteMdFrontmatter as NoteFrontmatter,
  HistoryEntry,
} from "./generated/note-frontmatter.schema.d.ts";

// current-ticket.md frontmatter (durable ticket intent).
export type {
  CurrentTicketMdFrontmatter as TicketFrontmatter,
  AcceptanceCriterion,
} from "./generated/ticket-frontmatter.schema.d.ts";

// Engine input events (actor.send inputs).
export type {
  EngineInputEvent,
  StepCompleted,
  StepFailed,
  HumanResponded,
  CancelRun,
  PauseRun,
  ResumeRun,
  Timeout,
  InterruptRaised,
  InterruptResolved,
} from "./generated/engine-event.schema.d.ts";

// Progress event stream (observability).
export type {
  ProgressEvent,
  Kind as ProgressEventKind,
} from "./generated/progress-event.schema.d.ts";

// XState snapshot wrapper.
export type { EngineSnapshot } from "./generated/snapshot.schema.d.ts";

// F-012 in-step turn loop.
export type {
  ProviderStepOutputEnvelope,
  Final as TurnFinal,
  Ask as TurnAsk,
} from "./generated/provider-step-output.schema.d.ts";
export type { InStepTurnQuestion as TurnQuestion } from "./generated/turn-question.schema.d.ts";
export type { InStepTurnAnswer as TurnAnswer } from "./generated/turn-answer.schema.d.ts";
