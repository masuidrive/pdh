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
  ac?: { ok: boolean; counts: Record<string, number>; errors?: unknown[] };
  git?: GitInfo;
  tickets?: TicketEntry[];
  ticketRequests?: TicketRequest[];
  files?: Record<string, string>;
  documents?: Record<string, { path: string; text: string }>;
};

export type RuntimeBlock = {
  run: RunRecord | null;
  noteState?: { ticket?: string | null; current_step?: string | null; status?: string | null };
  currentStep?: { id: string; label?: string } | null;
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
  currentLabel?: string;
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

export type StepView = {
  id: string;
  label: string;
  summary?: string;
  userAction?: string | null;
  ui?: unknown;
  provider?: string | null;
  mode?: string | null;
  progress: { status: ProgressStatus; label?: string; note?: string };
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
  reviewDiff?: { totalChanged?: number; summary?: string } | null;
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
  stepArtifacts?: ArtifactEntry[];
};

export type NextAction = {
  title: string;
  body?: string;
  commands?: string[];
  actions?: ActionButton[];
  selection?: string;
  targetTab?: string;
};

export type ActionButton = {
  label: string;
  description?: string;
  command?: string;
  tone?: "approve" | "reject" | "neutral" | "warning" | "danger" | string;
  kind: string;
  payload?: Record<string, unknown>;
};

export type GateView = {
  step_id?: string;
  status?: string;
  recommendation?: { kind?: string } | null;
  diff_summary?: string;
  summary?: string;
  summaryText?: string;
  baseline_step?: string;
  rerun_requirement?: { reason?: string; from?: string } | null;
  recommendationText?: string;
};

export type AttemptInfo = {
  attempt?: number;
  startedAt?: string;
  status?: string;
  pid?: number | null;
};

export type HistoryEntry = {
  step_id?: string;
  status?: string;
  started_at?: string;
  completed_at?: string;
  attempts?: AttemptInfo[];
};

export type EventEntry = { kind: string; message?: string; created_at?: string };

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

export type ArtifactEntry = { name: string; path?: string; size?: number };

export type GitInfo = { branch?: string; head?: string; tickets?: TicketEntry[] };

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
