import type { AppState, NextAction, StepView, VariantState, ProgressStatus } from "./types";

const STEP_DEF: { id: string; label: string }[] = [
  { id: "PD-C-2", label: "PD-C-2 調査" },
  { id: "PD-C-3", label: "PD-C-3 計画" },
  { id: "PD-C-4", label: "PD-C-4 計画レビュー" },
  { id: "PD-C-5", label: "PD-C-5 実装承認" },
  { id: "PD-C-6", label: "PD-C-6 実装" },
  { id: "PD-C-7", label: "PD-C-7 品質レビュー" },
  { id: "PD-C-8", label: "PD-C-8 目的妥当性" },
  { id: "PD-C-9", label: "PD-C-9 最終検証" },
  { id: "PD-C-10", label: "PD-C-10 完了承認" },
];

function makeStep(idx: number, currentIdx: number, currentStatus: ProgressStatus): StepView {
  const def = STEP_DEF[idx];
  let status: ProgressStatus;
  let note = "";
  if (idx < currentIdx) {
    status = "done";
    note = "完了";
  } else if (idx === currentIdx) {
    status = currentStatus;
    note =
      currentStatus === "needs_human"
        ? "ユーザ回答待ち · gate summary を確認"
        : currentStatus === "failed"
        ? "失敗 — Open Terminal で対処"
        : currentStatus === "active"
        ? "実行中"
        : currentStatus;
  } else {
    status = "pending";
    note = "未着手";
  }
  return {
    id: def.id,
    label: def.label,
    summary: "",
    progress: { status, note },
    current: idx === currentIdx,
    processState: { activeCount: 0, stale: false, active: [], dead: [] },
    historyEntry: null,
    latestAttempt: null,
    gate: null,
    interruptions: [],
    judgements: [],
    reviewFindings: [],
    artifacts: [],
    events: [],
  };
}

function variant(currentIdx: number, currentStatus: ProgressStatus): VariantState {
  return {
    id: "pdh-ticket-core",
    variant: "full",
    count: STEP_DEF.length,
    initial: STEP_DEF[0].id,
    sequence: STEP_DEF.map((s) => s.id),
    overview: { summary: null },
    steps: STEP_DEF.map((_, i) => makeStep(i, currentIdx, currentStatus)),
  };
}

function baseState(currentIdx: number, currentStatus: ProgressStatus, next: NextAction): AppState {
  const def = STEP_DEF[currentIdx];
  return {
    repo: "/tmp/sample1-standalone",
    repoName: "sample1-standalone",
    mode: "viewer+assist",
    generatedAt: new Date().toISOString(),
    runtime: {
      run: {
        id: "run-mock",
        flow_variant: "full",
        ticket_id: "calc-multiply",
        status: "running",
        current_step_id: def.id,
        repo_path: "/tmp/sample1-standalone",
      },
      supervisor: { running: false },
    },
    summary: {
      doneCount: currentIdx,
      totalSteps: STEP_DEF.length,
      acCounts: { verified: 0, deferred: 0, unverified: 0 },
      openItems: 0,
      gateStatus: currentStatus === "needs_human" ? "pending" : null,
    },
    flow: { activeVariant: "full", variants: { full: variant(currentIdx, currentStatus) } },
    current: { gate: null, interruptions: [], nextAction: next },
    history: [],
    events: [],
    git: { branch: "epic/pdh-flowchart" },
    tickets: [{ id: "calc-multiply", title: "Add multiplication support to calc CLI", status: "doing" }],
  };
}

const MOCKS: Record<string, () => AppState> = {
  "pd-c-5-needs-human": () =>
    baseState(3, "needs_human", {
      title: "PD-C-5 実装承認 を進める",
      body: "Approve implementation start, reject, or request changes to the plan.",
      actions: [
        { label: "Open Terminal", description: "assist と相談しながら recommendation を作るか、必要な修正をここで進めます。", tone: "neutral", kind: "assist" },
        { label: "Approve", description: "この gate をそのまま通して次へ進めます。", tone: "approve", kind: "gate_approve" },
      ],
    }),
  "pd-c-7-running": () => {
    const state = baseState(5, "active", {
      title: "PD-C-7 品質レビュー 実行中",
      body: "Reviewer agents が並列実行中です。",
      actions: [
        { label: "Open Terminal", description: "現在の実行を観察したり、必要なら手動修正を入れます。", tone: "neutral", kind: "assist" },
      ],
    });
    const v = state.flow.variants.full;
    v.steps[5].processState = {
      activeCount: 2,
      stale: false,
      active: [
        { kind: "reviewer", label: "AC Verifier", reviewerId: "ac_verifier-1", round: 2, alive: true, pid: 12345, startedAt: new Date(Date.now() - 154000).toISOString() },
        { kind: "reviewer", label: "Risk Hunter", reviewerId: "risk_hunter-1", round: 2, alive: true, pid: 12346, startedAt: new Date(Date.now() - 95000).toISOString() },
      ],
      dead: [{ kind: "aggregator", label: "Aggregator", alive: false, pid: 12340, startedAt: new Date(Date.now() - 250000).toISOString() }],
    };
    return state;
  },
  "pd-c-9-failed": () =>
    baseState(7, "failed", {
      title: "PD-C-9 最終検証 失敗",
      body: "Review loop が round 6 で打ち切られました。",
      actions: [
        { label: "Open Terminal", description: "状況確認や手動修正を実施します。", tone: "neutral", kind: "assist" },
      ],
    }),
  "pd-c-10-done": () =>
    baseState(8, "active", {
      title: "PD-C-10 完了承認 を進める",
      body: "通常は run-next だけで、gate や割り込みまで自動で進みます。",
      actions: [
        { label: "Run Next", description: "通常進行です。次の gate / interruption / failure / complete まで自動で進めます。", tone: "approve", kind: "run_next_direct" },
        { label: "Open Terminal", description: "current step の repo state を terminal で確認します。", tone: "neutral", kind: "assist" },
      ],
    }),
};

export function mockState(name: string): AppState {
  const factory = MOCKS[name] ?? MOCKS["pd-c-5-needs-human"];
  return factory();
}

export const MOCK_NAMES = Object.keys(MOCKS);
