import { useState } from "react";
import { useNotifications } from "../lib/notifications";
import { useSingleFlight } from "../lib/use-single-flight";
import type { EpicBranch, TicketEntry, TicketRequest } from "../lib/types";

type Tab = "active" | "archive" | "epics";

type Props = {
  tickets: TicketEntry[];
  pendingRequests?: TicketRequest[];
  dirty?: boolean;
  statusLines?: string[];
  currentBranch?: string;
  epicBranches?: EpicBranch[];
  repoPath?: string;
  onStart: (ticketId: string) => void;
  onForceStart: (ticketId: string) => void;
  onOpenTerminal: (ticketId: string) => void;
  onOpenRepoTerminal?: () => void;
  onCreate?: (slug: string) => Promise<{ slug: string }>;
  onEdit?: (ticketId: string) => void;
};

const STATUS_TONE: Record<string, string> = {
  doing: "badge-info",
  todo: "badge-ghost",
  done: "badge-success",
  canceled: "badge-warning",
};

const SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function TicketChooser({ tickets, pendingRequests, dirty, statusLines, currentBranch, epicBranches, repoPath, onStart, onForceStart, onOpenTerminal, onOpenRepoTerminal, onCreate, onEdit }: Props) {
  const sorted = [...tickets].sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || (a.priority ?? 99) - (b.priority ?? 99));
  const todos = sorted.filter((t) => t.status === "todo" || t.status === "doing");
  const done = sorted.filter((t) => t.status === "done" || t.status === "canceled");

  const [tab, setTab] = useState<Tab>("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const flights = useSingleFlight();
  const { notify, notifyError } = useNotifications();
  const submitting = flights.isPending("ticket-create");
  const slugValid = SLUG_RE.test(slug);
  const epics = epicBranches ?? [];

  async function handleCreate() {
    if (!onCreate || !slugValid || submitting) return;
    setError(null);
    try {
      const created = await flights.run("ticket-create", () => onCreate(slug));
      setCreateOpen(false);
      setSlug("");
      notify({
        tone: "success",
        title: "チケットを作成しました",
        message: created?.slug ? created.slug : slug,
      });
      // After creation, hand the new ticket to the editor so the user can
      // fill in title / description / Acceptance Criteria right away. The
      // server uses ticket.sh which prefixes a timestamp to the slug, so we
      // rely on the response to know the actual ticket id.
      if (onEdit && created?.slug) {
        // The server returns the original slug; resolve via tickets list later.
        // For now, reload triggers App to refresh; user can click 編集.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      notifyError(err, { title: "チケット作成に失敗しました" });
    }
  }

  return (
    <section className="mx-auto max-w-4xl space-y-6 p-5 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-base-content/60">Ticket Chooser</p>
          <h2 className="mt-1 text-3xl font-bold">どのチケットから始める?</h2>
          <p className="mt-2 text-sm text-base-content/70">
            現在 active な flow はありません。新しい ticket を選んで開始するか、過去の done / canceled を確認できます。
          </p>
        </div>
        {onCreate ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setError(null); setCreateOpen(true); }}>
            + 新規チケット
          </button>
        ) : null}
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

      <div role="tablist" className="tabs tabs-boxed w-fit">
        <button type="button" role="tab" className={`tab ${tab === "active" ? "tab-active" : ""}`} onClick={() => setTab("active")}>
          Active
          {todos.length ? <span className="badge badge-sm ml-2">{todos.length}</span> : null}
        </button>
        <button type="button" role="tab" className={`tab ${tab === "archive" ? "tab-active" : ""}`} onClick={() => setTab("archive")}>
          Archive
          {done.length ? <span className="badge badge-sm ml-2">{done.length}</span> : null}
        </button>
        <button type="button" role="tab" className={`tab ${tab === "epics" ? "tab-active" : ""}`} onClick={() => setTab("epics")}>
          Epic
          {epics.length ? <span className="badge badge-sm ml-2">{epics.length}</span> : null}
        </button>
      </div>

      {tab === "active" ? (
        <>
          <Section title="todo / doing" tickets={todos} onStart={onStart} onForceStart={onForceStart} onOpenTerminal={onOpenTerminal} onEdit={onEdit} active />
          {!todos.length ? <p className="text-sm text-base-content/50">アクティブな ticket はありません。「+ 新規チケット」または <code>./ticket.sh new &lt;slug&gt;</code> で作成してください。</p> : null}
        </>
      ) : null}

      {tab === "archive" ? (
        <>
          <Section title="done / canceled" tickets={done} onStart={onStart} onForceStart={onForceStart} onOpenTerminal={onOpenTerminal} onEdit={onEdit} />
          {!done.length ? <p className="text-sm text-base-content/50">アーカイブはありません。close した ticket がここに集まります。</p> : null}
        </>
      ) : null}

      {tab === "epics" ? (
        <EpicList epics={epics} currentBranch={currentBranch} repoPath={repoPath} />
      ) : null}

      {createOpen ? (
        <div className="modal modal-open" role="dialog" aria-modal="true">
          <div className="modal-box max-w-md">
            <h3 className="text-lg font-bold">新規チケットを作成</h3>
            <p className="mt-1 text-sm text-base-content/70">
              slug は小文字英数字とハイフン (例: <code>calc-modulo</code>)。<code>tickets/&lt;slug&gt;.md</code> が作られます。本文はその後 terminal でも編集できます。
            </p>
            <div className="form-control mt-4">
              <label className="label py-1" htmlFor="ticket-create-slug">
                <span className="label-text">Slug</span>
              </label>
              <input
                id="ticket-create-slug"
                className={`input input-bordered ${slug.length > 0 && !slugValid ? "input-error" : ""}`}
                type="text"
                autoFocus
                placeholder="my-new-ticket"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && slugValid && !submitting) handleCreate();
                  if (e.key === "Escape" && !submitting) { setCreateOpen(false); setError(null); }
                }}
                disabled={submitting}
              />
              {slug.length > 0 && !slugValid ? (
                <span className="mt-1 text-xs text-error">小文字英数字とハイフン、頭は英字、1〜64文字。</span>
              ) : null}
              {error ? <span className="mt-2 text-xs text-error whitespace-pre-line">{error}</span> : null}
            </div>
            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={() => { setCreateOpen(false); setError(null); }} disabled={submitting}>
                キャンセル
              </button>
              <button type="button" className="btn btn-primary" onClick={handleCreate} disabled={!slugValid || submitting}>
                {submitting ? "作成中…" : "作成"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Section({
  title,
  tickets,
  onStart,
  onForceStart,
  onOpenTerminal,
  onEdit,
  active,
}: {
  title: string;
  tickets: TicketEntry[];
  onStart: (id: string) => void;
  onForceStart: (id: string) => void;
  onOpenTerminal: (id: string) => void;
  onEdit?: (id: string) => void;
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
                  {onEdit ? (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => onEdit(t.id)}>
                      編集
                    </button>
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

function EpicList({ epics, currentBranch, repoPath }: { epics: EpicBranch[]; currentBranch?: string; repoPath?: string }) {
  if (!epics.length) {
    return (
      <section className="space-y-2">
        <p className="text-sm text-base-content/60">
          Epic ブランチ (<code>epic/&lt;slug&gt;</code>) はありません。
          terminal で <code>git checkout -b epic/&lt;slug&gt;</code> 等で作成すると、ここに並びます。
        </p>
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <p className="text-sm text-base-content/60">
        Epic 切り替えは現状 terminal から: <code>git switch &lt;epic-branch&gt;</code> (uncommitted があると失敗する点に注意)。
      </p>
      <ul className="grid gap-3">
        {epics.map((epic) => {
          const isCurrent = currentBranch === epic.name;
          return (
            <li key={epic.name} className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{epic.name}</span>
                    {isCurrent ? <span className="badge badge-info badge-sm">current</span> : null}
                  </div>
                  {epic.lastSubject ? <p className="mt-1 text-sm text-base-content/70 break-all">{epic.lastSubject}</p> : null}
                  <p className="mt-1 font-mono text-xs text-base-content/50">
                    {epic.lastCommit ?? "—"}
                    {epic.lastCommittedAt ? ` · ${epic.lastCommittedAt}` : ""}
                  </p>
                </div>
                {!isCurrent ? (
                  <pre className="rounded-box border border-base-300 bg-base-200 px-2 py-1 text-xs leading-5">
                    git -C {repoPath ?? "."} switch {epic.name}
                  </pre>
                ) : null}
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
