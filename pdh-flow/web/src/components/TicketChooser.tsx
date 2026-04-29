import type { TicketEntry, TicketRequest } from "../lib/types";

type Props = {
  tickets: TicketEntry[];
  pendingRequests?: TicketRequest[];
  dirty?: boolean;
  statusLines?: string[];
  onStart: (ticketId: string) => void;
  onForceStart: (ticketId: string) => void;
  onOpenTerminal: (ticketId: string) => void;
  onOpenRepoTerminal?: () => void;
};

const STATUS_TONE: Record<string, string> = {
  doing: "badge-info",
  todo: "badge-ghost",
  done: "badge-success",
  canceled: "badge-warning",
};

export function TicketChooser({ tickets, pendingRequests, dirty, statusLines, onStart, onForceStart, onOpenTerminal, onOpenRepoTerminal }: Props) {
  const sorted = [...tickets].sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || (a.priority ?? 99) - (b.priority ?? 99));
  const todos = sorted.filter((t) => t.status === "todo" || t.status === "doing");
  const done = sorted.filter((t) => t.status === "done" || t.status === "canceled");

  return (
    <section className="mx-auto max-w-4xl space-y-6 p-5 lg:p-8">
      <header>
        <p className="text-xs uppercase tracking-wide text-base-content/60">Ticket Chooser</p>
        <h2 className="mt-1 text-3xl font-bold">どのチケットから始める?</h2>
        <p className="mt-2 text-sm text-base-content/70">
          現在 active な flow はありません。新しい ticket を選んで開始するか、過去の done / canceled を確認できます。
        </p>
      </header>

      {dirty ? (
        <section className="rounded-box border border-warning/40 bg-warning/10 p-4 shadow-sm">
          <h3 className="font-bold text-warning">未 commit のファイルがあります</h3>
          <p className="mt-1 text-sm">
            この状態で ticket を開始すると <code>ticket.sh start</code> が dirty チェックで失敗します。Terminal を開いて
            <code className="px-1">git status</code> で確認し、<code>git add &amp;&amp; git commit</code> または
            <code className="px-1">git stash</code> / <code className="px-1">git restore</code> (慎重に) で片付けてください。
          </p>
          {statusLines && statusLines.length ? (
            <pre className="mt-2 max-h-40 overflow-auto rounded-box border border-base-300 bg-base-100 p-2 text-xs leading-5">
              {statusLines.join("\n")}
            </pre>
          ) : null}
          {onOpenRepoTerminal ? (
            <div className="mt-3">
              <button type="button" className="btn btn-warning btn-sm" onClick={onOpenRepoTerminal}>
                Open Terminal
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {pendingRequests?.length ? (
        <section className="space-y-2">
          <h3 className="text-sm font-bold text-warning">Pending start request</h3>
          {pendingRequests.map((req) => (
            <div key={req.ticketId + (req.createdAt ?? "")} className="flex flex-wrap items-center justify-between gap-3 rounded-box border border-warning/40 bg-warning/10 p-3">
              <div>
                <p className="font-semibold">{req.ticketId}</p>
                <p className="text-xs">variant: {req.variant ?? "full"}{req.createdAt ? ` · ${req.createdAt}` : ""}</p>
              </div>
              <button type="button" className="btn btn-warning btn-sm" onClick={() => onStart(req.ticketId)}>
                Start
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <Section title="todo / doing" tickets={todos} onStart={onStart} onForceStart={onForceStart} onOpenTerminal={onOpenTerminal} active />
      <Section title="done / canceled" tickets={done} onStart={onStart} onForceStart={onForceStart} onOpenTerminal={onOpenTerminal} />

      {!sorted.length ? <p className="text-sm text-base-content/50">tickets/ にチケットがありません。<code>./ticket.sh new &lt;slug&gt;</code> で作成してください。</p> : null}
    </section>
  );
}

function Section({
  title,
  tickets,
  onStart,
  onForceStart,
  onOpenTerminal,
  active,
}: {
  title: string;
  tickets: TicketEntry[];
  onStart: (id: string) => void;
  onForceStart: (id: string) => void;
  onOpenTerminal: (id: string) => void;
  active?: boolean;
}) {
  if (!tickets.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-bold text-base-content/70">{title}</h3>
      <ul className="grid gap-3">
        {tickets.map((t) => {
          const tone = STATUS_TONE[t.status ?? "todo"] ?? "badge-neutral";
          const isDoing = t.status === "doing";
          return (
            <li key={t.id} className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{t.title ?? t.id}</span>
                    <span className={`badge ${tone} badge-sm`}>{t.status ?? "todo"}</span>
                  </div>
                  <p className="text-xs font-mono text-base-content/50">{t.id}</p>
                  {t.description ? <p className="mt-1 text-sm text-base-content/70">{t.description}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {active ? (
                    isDoing ? (
                      <button type="button" className="btn btn-warning btn-sm" onClick={() => onForceStart(t.id)}>
                        Force Restart
                      </button>
                    ) : (
                      <button type="button" className="btn btn-success btn-sm" onClick={() => onStart(t.id)}>
                        Start
                      </button>
                    )
                  ) : null}
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => onOpenTerminal(t.id)}>
                    Terminal
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
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
