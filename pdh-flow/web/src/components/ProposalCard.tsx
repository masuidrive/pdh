import type { GateView, StepView } from "../lib/types";

type Proposal = {
  id?: string;
  action?: string;
  reason?: string;
  target_step_id?: string | null;
  status?: string;
  updated_at?: string;
};

const ACTION_TONE: Record<string, string> = {
  approve: "btn-success text-white",
  reject: "btn-error",
  request_changes: "btn-warning",
  rerun_from: "btn-warning",
};

type Props = {
  stepId: string;
  step?: StepView | null;
  gate?: GateView | null;
  // Disable the accept button while the runtime is mid-flight so the
  // user can't double-fire the proposal.
  runtimeBusy?: boolean;
  onAccept: () => void;
  onOpenTerminal: () => void;
};

export function ProposalCard({ stepId, step, gate, runtimeBusy = false, onAccept, onOpenTerminal }: Props) {
  const proposal = (gate?.proposal ?? null) as Proposal | null;
  if (!proposal || proposal.status !== "pending" || !proposal.action) return null;
  const label = labelForAction(proposal.action, step);
  const tone = ACTION_TONE[proposal.action] ?? "btn-primary";
  const target = proposal.target_step_id;

  return (
    <section className="rounded-box border-2 border-info/60 bg-info/10 p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold text-info">Assist の提案</h3>
        <span className="badge badge-outline badge-sm">{proposal.action}</span>
        {target ? <span className="badge badge-warning badge-sm">→ {target}</span> : null}
      </div>
      <p className="mt-2 text-sm">提案アクション: <span className="font-semibold">{label}</span></p>
      {proposal.reason ? (
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-box border border-base-300 bg-base-100 p-3 text-sm leading-6">
          {proposal.reason}
        </pre>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={`btn btn-sm ${tone}`} onClick={onAccept} disabled={runtimeBusy}>
          {runtimeBusy ? <span className="loading loading-spinner loading-xs" /> : null}
          {runtimeBusy ? "実行中…" : "提案を反映"}
        </button>
        <button type="button" className="btn btn-sm btn-neutral" onClick={onOpenTerminal}>
          Open Terminal
        </button>
      </div>
      <p className="mt-2 text-xs text-base-content/60">
        {stepId}: 反映すると runtime が自動で次へ進みます。違う方針にしたい場合は Open Terminal で assist と再作業してください。
      </p>
    </section>
  );
}

function labelForAction(action: string, step?: StepView | null): string {
  if (action === "approve") {
    const fromYaml = (step?.display as { approve?: { label?: string } } | null | undefined)?.approve?.label;
    return `Approve (${fromYaml || "次へ進める"})`;
  }
  if (action === "reject") return "Reject (却下)";
  if (action === "request_changes") return "Request changes (差し戻し)";
  if (action === "rerun_from") return "Rerun from earlier step (やり直し)";
  return action;
}
