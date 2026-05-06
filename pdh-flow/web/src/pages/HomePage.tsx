import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppState } from "../lib/use-app-state";
import { Navbar } from "../components/Navbar";
import { TicketChooser, pathToTab, tabToPath } from "../components/TicketChooser";
import { TicketEditModal } from "../components/TicketEditModal";
import { TerminalModal } from "../components/TerminalModal";
import { ConfirmModal, type ConfirmRequest } from "../components/ConfirmModal";
import { actions, requireSessionId, type SessionActionResponse } from "../lib/api";
import { useNotifications } from "../lib/notifications";
import { useSingleFlight } from "../lib/use-single-flight";

export function HomePage() {
  const slot = useAppState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const tab = pathToTab(location.pathname);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [ticketEditing, setTicketEditing] = useState<string | null>(null);
  const [terminalTicket, setTerminalTicket] = useState<{ ticketId: string; sessionId: string } | null>(null);
  const [terminalRepo, setTerminalRepo] = useState<{ sessionId: string } | null>(null);
  const flights = useSingleFlight();
  const { notifyError } = useNotifications();

  function startTicket(ticketId: string, force = false) {
    setConfirm({
      title: force ? `${ticketId} を強制再開` : `${ticketId} を開始`,
      body: force
        ? "現在の run を archive タグに退避して、ticket を最初から再起動します。"
        : "新しい ticket run を開始します。worktree が無ければ ticket.sh start --worktree で作成されます。",
      confirmLabel: force ? "Force Restart" : "Start",
      confirmTone: force ? "danger" : "approve",
      onConfirm: async () => {
        await actions.startTicket(ticketId, force ? { force: true } : {});
        navigate(`/tickets/${encodeURIComponent(ticketId)}`);
      },
    });
  }

  function startEpic(slug: string, variant: "full" | "light") {
    setConfirm({
      title: `Epic ${slug} を close`,
      body:
        variant === "light"
          ? "PD-D-1 (Exit Criteria 確認) → PD-D-3 (UCS) → PD-D-4 (Close gate) を回します。承認後 finalize-epic で squash merge + branch 削除が走ります。"
          : "PD-D-1 (Exit Criteria 確認) → PD-D-2 (ゼロベースレビュー) → PD-D-3 (UCS) → PD-D-4 (Close gate) を回します。承認後 finalize-epic で squash merge + branch 削除が走ります。",
      confirmLabel: variant === "light" ? "Start (light)" : "Start (full)",
      confirmTone: "approve",
      onConfirm: async () => {
        await actions.startEpic(slug, { variant });
        const ticketLabel = `epic-${slug}`;
        navigate(`/tickets/${encodeURIComponent(ticketLabel)}`);
      },
    });
  }

  async function openTicketTerminal(ticketId: string) {
    try {
      const session = await flights.run(
        `home-open-ticket-terminal:${ticketId}`,
        () => actions.openTicketTerminal(ticketId) as Promise<SessionActionResponse>
      );
      const sessionId = requireSessionId(session);
      if (!sessionId) return;
      setTerminalTicket({ ticketId, sessionId });
    } catch (err) {
      notifyError(err, { title: `${ticketId} の Terminal を開けませんでした` });
    }
  }

  async function openRepoTerminal() {
    try {
      const session = await flights.run(
        "home-open-repo-terminal",
        () => actions.openRepoTerminal() as Promise<SessionActionResponse>
      );
      const sessionId = requireSessionId(session);
      if (!sessionId) return;
      setTerminalRepo({ sessionId });
    } catch (err) {
      notifyError(err, { title: "Repo Terminal を開けませんでした" });
    }
  }

  function openExistingTicket(ticketId: string) {
    navigate(`/tickets/${encodeURIComponent(ticketId)}`);
  }

  if (slot.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }
  if (slot.status === "error" || !slot.state) {
    return (
      <div className="p-8">
        <div className="alert alert-error">
          <span>{slot.status === "error" ? slot.error : "状態を取得できませんでした"}</span>
        </div>
      </div>
    );
  }

  const tickets = slot.state.tickets ?? [];
  const workspaces = (slot.state as { workspaces?: Record<string, { runId?: string; currentStepId?: string; status?: string; updatedAt?: string } | null> }).workspaces ?? {};
  // tickets[] can carry the same id twice when a freshly-created ticket
  // shares an id with one already moved to tickets/done/. The workspace
  // map is keyed by id alone, so the active filter would match both
  // entries and render duplicate buttons. Dedup by id, preferring the
  // non-done entry so the live one wins.
  const seen = new Set<string>();
  const activeTickets = tickets
    .filter((t) => workspaces[t.id]?.runId)
    .sort((a, b) => Number(a.status === "done") - Number(b.status === "done"))
    .filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  return (
    <>
      <Navbar
        ticketId={null}
        ticketTitle={null}
        branch={slot.state.git?.branch}
        onOpenFlow={undefined}
        onOpenTickets={undefined}
        runtime={slot.state.runtime}
        generatedAt={slot.state.generatedAt}
      />
      <main className="min-h-[calc(100vh-4rem)]">
        {activeTickets.length > 0 ? (
          <div className="px-5 pt-4 lg:px-8">
            <section className="rounded-box border border-info/40 bg-info/10 px-4 py-3 shadow-sm">
              <p className="mb-2 text-sm font-semibold text-info">進行中の ticket</p>
              <div className="flex flex-wrap gap-2">
                {activeTickets.map((t) => {
                  const ws = workspaces[t.id]!;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => openExistingTicket(t.id)}
                    >
                      {t.id} ({ws.currentStepId} / {ws.status})
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        ) : null}
        <TicketChooser
          tickets={tickets}
          pendingRequests={slot.state.ticketRequests}
          dirty={slot.state.git?.clean === false}
          statusLines={slot.state.git?.statusLines}
          currentBranch={slot.state.git?.branch}
          epics={slot.state.git?.epics}
          repoPath={slot.state.repo}
          tab={tab}
          onTabChange={(next) => navigate(tabToPath(next))}
          onStart={(id) => startTicket(id, false)}
          onForceStart={(id) => startTicket(id, true)}
          onOpenTerminal={openTicketTerminal}
          onOpenRepoTerminal={openRepoTerminal}
          onCreate={async (slug) => (await actions.createTicket(slug)) as { slug: string }}
          onEdit={(id) => setTicketEditing(id)}
          onEpicStart={startEpic}
          hasActiveRun={Boolean(slot.state.runtime?.run?.id)}
        />
      </main>
      <ConfirmModal request={confirm} onClose={() => setConfirm(null)} />
      <TicketEditModal
        open={ticketEditing !== null}
        ticketId={ticketEditing}
        onClose={() => setTicketEditing(null)}
      />
      <TerminalModal
        open={terminalTicket !== null || terminalRepo !== null}
        stepId={null}
        forceReprompt={false}
        ticketId={terminalTicket?.ticketId ?? null}
        sessionId={terminalTicket?.sessionId ?? terminalRepo?.sessionId ?? null}
        onClose={() => {
          setTerminalTicket(null);
          setTerminalRepo(null);
        }}
      />
    </>
  );
}
