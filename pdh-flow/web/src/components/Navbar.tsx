import { useEffect, useState } from "react";
import type { RuntimeBlock, StepView } from "../lib/types";

type Props = {
  ticketId?: string | null;
  ticketTitle?: string | null;
  branch?: string;
  collapsed: boolean;
  onToggle: () => void;
  onOpenFlow?: () => void;
  onOpenTickets?: () => void;
  pendingTicketCount?: number;
  runtime?: RuntimeBlock | null;
  steps?: StepView[];
  currentStepId?: string | null;
  onSelectStep?: (stepId: string) => void;
  generatedAt?: string;
};

const STATUS_DOT: Record<string, string> = {
  done: "bg-success",
  completed: "bg-success",
  running: "bg-info animate-pulse",
  active: "bg-info animate-pulse",
  waiting: "bg-warning",
  needs_human: "bg-warning",
  blocked: "bg-error",
  failed: "bg-error",
  interrupted: "bg-warning",
  pending: "bg-base-300",
  skipped: "bg-base-200",
};

export function Navbar({ ticketId, ticketTitle, branch, collapsed, onToggle, onOpenFlow, onOpenTickets, pendingTicketCount, runtime, steps, currentStepId, onSelectStep, generatedAt }: Props) {
  const elapsed = useRelativeTime(generatedAt);
  const run = runtime?.run ?? null;
  const visibleSteps = (steps ?? []).filter((s) => s.progress.status !== "skipped");
  return (
    <div className="navbar sticky top-0 z-30 border-b border-base-300 bg-base-100 gap-3">
      <div className="navbar-start gap-3 shrink-0">
        <button
          className="btn btn-ghost btn-square btn-sm"
          aria-label={collapsed ? "タイムラインを開く" : "タイムラインを折りたたむ"}
          aria-expanded={!collapsed}
          onClick={onToggle}
          type="button"
        >
          <span className="text-xl">{collapsed ? "›" : "☰"}</span>
        </button>
        <div>
          <p className="text-base font-bold leading-tight">PDH Dev</p>
          <div className="breadcrumbs hidden p-0 text-xs sm:block">
            <ul>
              {branch ? <li>{branch}</li> : null}
              {ticketId ? <li>{ticketId}</li> : null}
            </ul>
          </div>
        </div>
      </div>

      {visibleSteps.length > 0 ? (
        <div className="navbar-center hidden flex-1 min-w-0 md:flex">
          <ol className="flex flex-1 items-center gap-1 overflow-x-auto px-2">
            {visibleSteps.map((s, i) => {
              const status = s.progress.status;
              const isCurrent = s.id === currentStepId;
              const dot = STATUS_DOT[status] ?? "bg-base-300";
              return (
                <li key={s.id} className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-base-200 ${isCurrent ? "bg-base-200 font-semibold" : "text-base-content/70"}`}
                    title={`${s.id} ${s.label} — ${status}`}
                    onClick={() => onSelectStep?.(s.id)}
                  >
                    <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
                    <span className="font-mono">{shortStepId(s.id)}</span>
                  </button>
                  {i < visibleSteps.length - 1 ? (
                    <span className="text-base-content/30">›</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      <div className="navbar-end gap-2 shrink-0">
        {elapsed ? <span className="hidden text-xs text-base-content/50 lg:inline">updated {elapsed}</span> : null}
        {onOpenTickets ? (
          <button type="button" className="btn btn-ghost btn-sm gap-1" onClick={onOpenTickets}>
            Tickets
            {pendingTicketCount ? <span className="badge badge-warning badge-sm">{pendingTicketCount}</span> : null}
          </button>
        ) : null}
        {onOpenFlow ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenFlow}>
            Flow
          </button>
        ) : null}
        {ticketTitle ? (
          <div className="hidden flex-col items-end leading-tight md:flex">
            <span className="text-sm font-semibold text-base-content/80 truncate max-w-xs">{ticketTitle}</span>
            {run?.status ? <span className="text-xs text-base-content/50">{run.status}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function shortStepId(id: string) {
  // PD-C-7 → C-7 / PD-D-2 → D-2
  const m = /^PD-([A-Z])-(\d+)$/.exec(id);
  return m ? `${m[1]}-${m[2]}` : id;
}

function useRelativeTime(iso?: string) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  void tick;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}
