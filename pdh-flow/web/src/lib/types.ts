// Mirrors collectState() in pdh-flow/src/web-server.mjs.

export type AppState = {
  repo: string;
  repoName: string;
  mode: string;
  generatedAt: string;
  runtime: RuntimeBlock;
  summary: SummaryBlock;
  flow: { activeVariant: string; variants: Record<string, VariantState> };
  current: CurrentBlock;
  history?: HistoryEntry[];
  events?: EventEntry[];
  git?: GitInfo;
  tickets?: TicketEntry[];
  ticketRequests?: TicketRequest[];
  documents?: Record<string, { path: string; text: string }>;
};

export type RuntimeBlock = {
  run: RunRecord | null;
  supervisor?: SupervisorState | null;
};

export type RunRecord = {
  id?: string;
  flow_id?: string;
  flow_variant?: string;
  ticket_id?: string;
  status?: string;
  current_step_id?: string | null;
  repo_path?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  flow_variant_locked?: boolean;
  flow_variant_reason?: string | null;
  agent_overrides?: Record<string, unknown>;
  agent_overrides_locked?: Record<string, boolean>;
  note_overrides_warnings?: string[];
};

export type SupervisorState = {
  pid?: number | null;
  status?: string;
  reason?: string;
  startedAt?: string | null;
  running?: boolean;
};

export type SummaryBlock = {
  doneCount: number;
  totalSteps: number;
  acCounts?: Record<string, number>;
  openItems?: number;
  gateStatus?: string | null;
};

export type VariantState = {
  id?: string;
  variant: string;
  count?: number;
  initial?: string;
  sequence?: string[];
  mermaid?: string;
  overview?: { summary?: string | null };
  steps: StepView[];
  skippedSteps?: string[];
};

export type ProgressStatus = "done" | "active" | "needs_human" | "failed" | "blocked" | "pending" | string;

export type ReviewerSlot = {
  role: string;
  label?: string;
  // One provider per spawn. devils_advocate ×2 = providers.length === 2;
  // each entry can be claude or codex independently.
  providers: string[];
};

export type StepView = {
  id: string;
  label: string;
  summary?: string;
  provider?: string | null;
  mode?: string | null;
  role?: string | null;
  // Review-mode steps expose their variant-resolved aggregator/repair
  // providers + reviewer roster so the composition editor can render
  // defaults next to per-step overrides.
  aggregatorProvider?: string | null;
  repairProvider?: string | null;
  reviewers?: ReviewerSlot[];
  display?: {
    label?: string;
    summary?: string;
    userAction?: string;
    viewer?: string;
    decision?: string;
    mustShow?: string[];
    omit?: string[];
    readTicketHeading?: string;
    readNoteHeadings?: string[];
    approve?: { label?: string; description?: string } | null;
  } | null;
  progress: { status: ProgressStatus; note?: string };
  current: boolean;
  processState?: ProcessState | null;
  uiContract?: unknown;
  uiOutput?: unknown;
  uiRuntime?: unknown;
  assistSignal?: unknown;
  noteSection?: string | null;
  acSummary?: Record<string, number>;
  historyEntry?: HistoryEntry | null;
  latestAttempt?: AttemptInfo | null;
  gate?: GateView | null;
  interruptions?: Interruption[];
  judgements?: JudgementEntry[];
  reviewFindings?: ReviewFinding[];
  reviewDiff?: ReviewDiff | null;
  artifacts?: ArtifactEntry[];
  events?: EventEntry[];
};

export type ProcessState = {
  activeCount: number;
  stale: boolean;
  active: ProcessEntry[];
  dead: ProcessEntry[];
  note?: string;
};

export type ProcessEntry = {
  pid?: number | null;
  alive?: boolean;
  kind?: string;
  label?: string;
  reviewerId?: string | null;
  round?: number | null;
  startedAt?: string | null;
};

export type CurrentBlock = {
  gate: GateView | null;
  interruptions: Interruption[];
  nextAction: NextAction | null;
  notice?: RuntimeNotice | null;
};

export type RuntimeNotice = {
  kind: string;
  stepId?: string | null;
  ts?: string | null;
  message?: string | null;
  escalation?: string | null;
  failedGuards?: string[] | null;
  detail?: string | null;
};

export type NextAction = {
  title: string;
  body?: string;
  actions?: ActionButton[];
};

export type ActionButton = {
  label: string;
  description?: string;
  tone?: "approve" | "reject" | "neutral" | "warning" | "danger" | string;
  kind: string;
};

export type GateView = {
  step_id?: string;
  stepId?: string;
  status?: string;
  proposal?: { id?: string; status?: string; action?: string; reason?: string; target_step_id?: string | null } | null;
  baseline?: { commit?: string; step_id?: string; ref?: string; captured_at?: string };
  rerun_requirement?: { reason?: string; from?: string; target_step_id?: string; changed_ticket_sections?: string[]; changed_note_sections?: string[] } | null;
  decision?: string | null;
};

export type AttemptInfo = {
  attempt?: number;
  startedAt?: string;
  // attempt lifecycle: running | completed | failed | abandoned
  status?: string;
  // rerun_from on a completed attempt means the review/repair decided
  // to redirect the run to a previous step rather than advance.
  verdict?: string | null;
  pid?: number | null;
};

export type HistoryEntry = {
  step_id?: string;
  status?: string;
  started_at?: string;
  completed_at?: string;
  attempts?: AttemptInfo[];
};

export type EventEntry = {
  id?: string;
  ts?: string;
  created_at?: string;
  type?: string;
  kind?: string;
  message?: string;
  stepId?: string;
  provider?: string;
};

export type Interruption = { kind: string; message?: string; created_at?: string };

export type JudgementEntry = { kind: string; status?: string; summary?: string };

export type ReviewFinding = {
  reviewerId?: string;
  reviewerLabel?: string;
  severity: "critical" | "major" | "minor" | string;
  title?: string;
  evidence?: string;
  recommendation?: string;
};

export type ReviewDiff = {
  stepId?: string;
  baseLabel?: string;
  baseCommit?: string;
  diffStat?: unknown[];
  changedFiles?: string[];
  patch?: string | null;
  totalChanged?: number;
  summary?: string;
};

export type ArtifactEntry = { name: string; path?: string; size?: number | string };

export type GitInfo = {
  branch?: string;
  clean?: boolean;
  statusLines?: string[];
  epics?: Epic[];
};

export type Epic = {
  slug: string;
  filename: string;
  title: string;
  branch: string;
  createdAt?: string | null;
  closedAt?: string | null;
  hasBranch: boolean;
  lastCommit?: string | null;
  lastCommittedAt?: string | null;
  lastSubject?: string;
};

export type TicketEntry = {
  id: string;
  title?: string;
  status?: string;
  path?: string;
  notePath?: string | null;
  description?: string;
  priority?: number;
};

export type TicketRequest = { ticketId: string; variant?: string; createdAt?: string };
