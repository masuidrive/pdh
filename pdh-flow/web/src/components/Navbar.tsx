import { useEffect, useState } from "react";
import type { RuntimeBlock } from "../lib/types";

type Props = {
  ticketId?: string | null;
  ticketTitle?: string | null;
  branch?: string;
  onOpenFlow?: () => void;
  onOpenTickets?: () => void;
  pendingTicketCount?: number;
  runtime?: RuntimeBlock | null;
  generatedAt?: string;
};

export function Navbar({ ticketId, ticketTitle, branch, onOpenFlow, onOpenTickets, pendingTicketCount, runtime, generatedAt }: Props) {
  const elapsed = useRelativeTime(generatedAt);
  const run = runtime?.run ?? null;
  return (
    <div className="sticky top-0 z-30 border-b border-base-300 bg-base-100">
      <div className="flex flex-col gap-2 px-3 py-2 lg:flex-row lg:items-center lg:gap-3 lg:px-4 lg:py-1.5 lg:min-h-12">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="min-w-0">
            <p className="text-base font-bold leading-tight">PDH Dev</p>
            <div className="breadcrumbs hidden p-0 text-xs sm:block max-w-full">
              <ul>
                {branch ? <li className="truncate">{branch}</li> : null}
                {ticketId ? <li className="truncate">{ticketId}</li> : null}
              </ul>
            </div>
          </div>
          {ticketTitle ? (
            <div className="hidden min-w-0 flex-col items-start leading-tight lg:flex">
              <span className="text-sm font-semibold text-base-content/80 truncate max-w-xs">{ticketTitle}</span>
              {run?.status ? <span className="text-xs text-base-content/50">{run.status}</span> : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 min-w-0 flex-wrap">
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
        </div>
      </div>
    </div>
  );
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
