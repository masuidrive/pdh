import type { HistoryEntry } from "../lib/types";

type Props = {
  history?: HistoryEntry | null;
};

export function CompletionCard({ history }: Props) {
  if (!history) return null;
  const entry = history as HistoryEntry & { updatedAt?: string; commit?: string; summary?: string; stepId?: string; status?: string };
  const status = entry.status ?? "—";
  const commit = entry.commit ?? "";
  const summary = entry.summary ?? "";
  const ts = entry.updatedAt ?? entry.completed_at ?? entry.started_at ?? "";

  return (
    <section className="rounded-box border border-success/40 bg-success/10 p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold text-success">完了履歴</h3>
        <span className="badge badge-success badge-sm">{status}</span>
        {commit ? <span className="badge badge-ghost badge-sm font-mono">{commit.slice(0, 7)}</span> : null}
        {ts ? <span className="text-xs text-base-content/60">{formatTime(ts)}</span> : null}
      </div>
      {summary ? <p className="mt-2 text-sm">{summary}</p> : null}
    </section>
  );
}

function formatTime(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString();
}
