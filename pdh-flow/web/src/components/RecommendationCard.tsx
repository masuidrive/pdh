import type { GateView } from "../lib/types";

type Recommendation = {
  id?: string;
  action?: string;
  reason?: string;
  target_step_id?: string | null;
  status?: string;
  updated_at?: string;
};

const ACTION_LABEL: Record<string, string> = {
  approve: "Approve (実装開始)",
  reject: "Reject (却下)",
  "request-changes": "Request changes (差し戻し)",
  "rerun-from": "Rerun from earlier step (やり直し)",
};

const ACTION_TONE: Record<string, string> = {
  approve: "btn-success",
  reject: "btn-error",
  "request-changes": "btn-warning",
  "rerun-from": "btn-warning",
};

type Props = {
  stepId: string;
  gate?: GateView | null;
  onAccept: () => void;
  onOpenTerminal: () => void;
};

export function RecommendationCard({ stepId, gate, onAccept, onOpenTerminal }: Props) {
  const rec = (gate?.recommendation ?? null) as Recommendation | null;
  if (!rec || rec.status !== "pending" || !rec.action) return null;
  const label = ACTION_LABEL[rec.action] ?? rec.action;
  const tone = ACTION_TONE[rec.action] ?? "btn-primary";
  const target = rec.target_step_id;

  return (
    <section className="rounded-box border-2 border-info/60 bg-info/10 p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold text-info">Assist の推奨</h3>
        <span className="badge badge-outline badge-sm">{rec.action}</span>
        {target ? <span className="badge badge-warning badge-sm">→ {target}</span> : null}
      </div>
      <p className="mt-2 text-sm">推奨アクション: <span className="font-semibold">{label}</span></p>
      {rec.reason ? (
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-box border border-base-300 bg-base-100 p-3 text-sm leading-6">
          {rec.reason}
        </pre>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={`btn btn-sm ${tone}`} onClick={onAccept}>
          推奨を反映
        </button>
        <button type="button" className="btn btn-sm btn-outline" onClick={onOpenTerminal}>
          Open Terminal
        </button>
      </div>
      <p className="mt-2 text-xs text-base-content/60">
        {stepId}: 反映すると runtime が自動で次へ進みます。違う方針にしたい場合は Open Terminal で assist と再作業してください。
      </p>
    </section>
  );
}
