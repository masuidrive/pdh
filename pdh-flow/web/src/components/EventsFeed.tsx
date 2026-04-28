import type { EventEntry } from "../lib/types";

type Props = { events?: EventEntry[] };

export function EventsFeed({ events }: Props) {
  if (!events?.length) return null;
  const recent = events.slice(-12).reverse();
  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body">
        <h3 className="card-title">最近のイベント</h3>
        <ul className="space-y-1 text-sm">
          {recent.map((e, i) => (
            <li key={e.id ?? i} className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-xs text-base-content/50">{formatTime(e.ts ?? e.created_at)}</span>
              <span className="badge badge-ghost badge-sm">{e.type ?? e.kind ?? "event"}</span>
              {e.stepId ? <span className="text-xs text-base-content/50">{e.stepId}</span> : null}
              <span className="text-base-content/80">{e.message ?? ""}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function formatTime(iso?: string) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  return d.toLocaleTimeString();
}
