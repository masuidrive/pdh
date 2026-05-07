import type { TicketEntry, TicketRequest } from "../lib/types";

type Props = {
  open: boolean;
  tickets: TicketEntry[];
  pendingRequests?: TicketRequest[];
  activeTicketId?: string | null;
  onClose: () => void;
  onStart: (ticketId: string, force: boolean) => void;
  onOpenTicketTerminal: (ticketId: string) => void;
};

const STATUS_TONE: Record<string, string> = {
  doing: "badge-info",
  todo: "badge-ghost",
  done: "badge-success",
  canceled: "badge-warning",
};

export function TicketDrawer({ open, tickets, pendingRequests, activeTicketId, onClose, onStart, onOpenTicketTerminal }: Props) {
  if (!open) return null;
  const sorted = [...tickets].sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || (a.priority ?? 99) - (b.priority ?? 99));
  return (
    <div className="fixed inset-0 z-40 flex">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="閉じる"
        onClick={onClose}
      />
      <aside className="relative ml-auto h-full w-full max-w-md overflow-auto border-l border-base-300 bg-base-100 p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-base-content/60">Tickets</p>
            <h2 className="text-xl font-bold">チケット一覧</h2>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>閉じる</button>
        </div>

        {pendingRequests?.length ? (
          <div className="mt-4 space-y-2">
            <h3 className="text-sm font-bold text-warning">Pending start request</h3>
            {pendingRequests.map((req) => (
              <div key={req.ticketId + (req.createdAt ?? "")} className="alert alert-warning">
                <div>
                  <p className="font-semibold">{req.ticketId}</p>
                  <p className="text-xs">variant: {req.variant ?? "full"}{req.createdAt ? ` · ${req.createdAt}` : ""}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-warning btn-sm"
                  onClick={() => onStart(req.ticketId, false)}
                >
                  Start
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <ul className="mt-5 space-y-3">
          {sorted.map((t) => {
            const isActive = activeTicketId === t.id;
            const tone = STATUS_TONE[t.status ?? "todo"] ?? "badge-neutral";
            return (
              <li
                key={t.id}
                className={`rounded-box border ${isActive ? "border-primary bg-primary/5" : "border-base-300 bg-base-200"} p-4`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{t.title ?? t.id}</span>
                      <span className={`badge ${tone} badge-sm`}>{t.status ?? "todo"}</span>
                      {isActive ? <span className="badge badge-primary badge-sm">active</span> : null}
                    </div>
                    <p className="text-xs font-mono text-base-content/50">{t.id}</p>
                    {t.description ? <p className="mt-1 text-xs text-base-content/70 line-clamp-2">{t.description}</p> : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  {t.status === "doing" || isActive ? (
                    <button
                      type="button"
                      className="btn btn-warning btn-xs"
                      onClick={() => onStart(t.id, true)}
                    >
                      Force Restart
                    </button>
                  ) : null}
                  {t.status !== "done" && t.status !== "canceled" ? (
                    <button
                      type="button"
                      className="btn btn-success btn-xs"
                      disabled={isActive}
                      onClick={() => onStart(t.id, false)}
                    >
                      {isActive ? "実行中" : "Start"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-outline btn-xs"
                    onClick={() => onOpenTicketTerminal(t.id)}
                  >
                    Terminal
                  </button>
                </div>
              </li>
            );
          })}
          {!sorted.length ? <li className="text-sm text-base-content/50">tickets/ にチケットがありません</li> : null}
        </ul>
      </aside>
    </div>
  );
}

function statusOrder(status?: string) {
  switch (status) {
    case "doing":
      return 0;
    case "todo":
      return 1;
    case "canceled":
      return 2;
    case "done":
      return 3;
    default:
      return 99;
  }
}
