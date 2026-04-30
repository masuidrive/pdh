import { useEffect, useMemo, useState } from "react";
import { useAppState } from "./lib/use-app-state";
import { Navbar } from "./components/Navbar";
import { Workspace } from "./components/Workspace";
import { BottomBar } from "./components/BottomBar";
import { TerminalModal } from "./components/TerminalModal";
import { ArtifactModal } from "./components/ArtifactModal";
import { ConfirmModal, type ConfirmRequest } from "./components/ConfirmModal";
import { buildConfirmRequest } from "./lib/confirm";
import { DiffModal } from "./components/DiffModal";
import { MermaidModal } from "./components/MermaidModal";
import { RepoFileModal } from "./components/RepoFileModal";
import { TicketDrawer } from "./components/TicketDrawer";
import { StaleRunBanner } from "./components/StaleRunBanner";
import { TicketChooser } from "./components/TicketChooser";
import { actions } from "./lib/api";
import { DocumentModal } from "./components/DocumentModal";
import { useUrlState } from "./lib/use-url-state";

export function App() {
  const slot = useAppState();
  const [urlState, updateUrl] = useUrlState();
  const [terminalStep, setTerminalStep] = useState<string | null>(null);
  const [terminalTicket, setTerminalTicket] = useState<{ ticketId: string; sessionId: string } | null>(null);
  const [terminalRepo, setTerminalRepo] = useState<{ sessionId: string } | null>(null);
  const [artifactTarget, setArtifactTarget] = useState<{ stepId: string; name: string } | null>(null);
  const [selectedStep, setSelectedStep] = useState<string | null>(urlState.step);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [diffStep, setDiffStep] = useState<string | null>(null);
  const [mermaidOpen, setMermaidOpen] = useState(false);
  const [fileTarget, setFileTarget] = useState<{ stepId: string; path: string } | null>(null);
  const [ticketsOpen, setTicketsOpen] = useState(false);

  function requestConfirm(kind: string, ctx: { stepId?: string; stepLabel?: string; recommendationText?: string; ticketId?: string }) {
    const req = buildConfirmRequest(kind, ctx);
    if (req) setConfirm(req);
  }

  // ⌘/Ctrl+Enter triggers the primary nextAction
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        const next = slot.state?.current?.nextAction;
        const primary = next?.actions?.find((a) => a.tone === "approve");
        if (primary && focusedStep) {
          e.preventDefault();
          if (primary.kind === "assist" || primary.kind === "open_terminal") {
            setTerminalStep(focusedStep.id);
          } else {
            requestConfirm(primary.kind, { stepId: focusedStep.id, stepLabel: focusedStep.label });
          }
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function startTicket(ticketId: string, force: boolean) {
    requestConfirm(force ? "ticket_force_restart" : "ticket_start", { ticketId });
  }

  async function openRepoTerminal() {
    try {
      const session = (await actions.openRepoTerminal()) as { sessionId?: string; result?: { sessionId?: string } };
      const sessionId = session.sessionId ?? session.result?.sessionId;
      if (!sessionId) {
        console.error("repo terminal: session_id missing", session);
        return;
      }
      setTerminalRepo({ sessionId });
    } catch (err) {
      console.error(err);
    }
  }

  async function openTicketTerminal(ticketId: string) {
    try {
      const session = (await actions.openTicketTerminal(ticketId)) as { sessionId?: string; result?: { sessionId?: string } };
      const sessionId = session.sessionId ?? session.result?.sessionId;
      if (!sessionId) {
        console.error("ticket terminal: session_id missing", session);
        return;
      }
      setTicketsOpen(false);
      setTerminalTicket({ ticketId, sessionId });
    } catch (err) {
      console.error(err);
    }
  }

  const variant = useMemo(() => {
    if (!slot.state) return null;
    const flow = slot.state.flow;
    return flow.variants[flow.activeVariant] ?? flow.variants[Object.keys(flow.variants)[0]] ?? null;
  }, [slot.state]);

  const focusedStepId =
    selectedStep ?? urlState.step ?? slot.state?.runtime?.run?.current_step_id ?? variant?.steps?.[0]?.id ?? null;
  const focusedStep = variant?.steps.find((s) => s.id === focusedStepId) ?? null;
  const currentStepId = slot.state?.runtime?.run?.current_step_id ?? null;
  const currentStep = currentStepId ? variant?.steps.find((s) => s.id === currentStepId) ?? null : null;
  const next = focusedStep?.current ? slot.state?.current?.nextAction ?? null : null;

  if (slot.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }
  if (slot.status === "error" || !slot.state || !variant) {
    return (
      <div className="p-8">
        <div className="alert alert-error">
          <span>{slot.status === "error" ? slot.error : "状態を取得できませんでした"}</span>
        </div>
      </div>
    );
  }

  const hasActiveRun = Boolean(slot.state.runtime?.run?.id && slot.state.runtime?.run?.current_step_id);
  if (!hasActiveRun) {
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
          <TicketChooser
            tickets={slot.state.tickets ?? []}
            pendingRequests={slot.state.ticketRequests}
            dirty={slot.state.git?.clean === false}
            statusLines={slot.state.git?.statusLines}
            onStart={(id) => startTicket(id, false)}
            onForceStart={(id) => startTicket(id, true)}
            onOpenTerminal={openTicketTerminal}
            onOpenRepoTerminal={openRepoTerminal}
          />
        </main>
        <ConfirmModal request={confirm} onClose={() => setConfirm(null)} />
        <TerminalModal
          open={terminalStep !== null || terminalTicket !== null || terminalRepo !== null}
          stepId={terminalStep}
          ticketId={terminalTicket?.ticketId ?? null}
          sessionId={terminalTicket?.sessionId ?? terminalRepo?.sessionId ?? null}
          onClose={() => {
            setTerminalStep(null);
            setTerminalTicket(null);
            setTerminalRepo(null);
          }}
        />
      </>
    );
  }

  return (
    <>
      <Navbar
        ticketId={slot.state.runtime?.run?.ticket_id ?? null}
        ticketTitle={slot.state.tickets?.find((t) => t.id === slot.state?.runtime?.run?.ticket_id)?.title ?? null}
        branch={slot.state.git?.branch}
        onOpenFlow={() => setMermaidOpen(true)}
        onOpenTickets={() => setTicketsOpen(true)}
        pendingTicketCount={slot.state.ticketRequests?.length ?? 0}
        runtime={slot.state.runtime}
        steps={variant?.steps}
        currentStepId={focusedStepId}
        onSelectStep={(id) => setSelectedStep(id)}
        generatedAt={slot.state.generatedAt}
      />
      <div className="px-5 pt-4 lg:px-8">
        <StaleRunBanner
          state={slot.state}
          onDiscard={() => requestConfirm("runtime_discard", {})}
        />
      </div>
      <main id="workspace" className="min-h-[calc(100vh-4rem)] min-w-0 overflow-x-hidden">
        <Workspace
          step={focusedStep}
          next={next}
          allSteps={variant.steps}
          history={slot.state.history}
          interruptions={slot.state.current?.interruptions}
          documents={slot.state.documents}
          onOpenTerminal={(id) => setTerminalStep(id)}
          onOpenArtifact={(stepId, name) => setArtifactTarget({ stepId, name })}
          onOpenDiff={(stepId) => setDiffStep(stepId)}
          onOpenFile={(stepId, p) => setFileTarget({ stepId, path: p })}
          onOpenDocument={(docId, heading) => updateUrl({ doc: docId, heading: heading ?? null })}
          onConfirm={requestConfirm}
        />
      </main>
      <BottomBar
        step={currentStep ?? focusedStep}
        ticketId={slot.state.runtime?.run?.ticket_id ?? null}
        events={slot.state.events}
        onJumpToCurrent={currentStepId ? () => {
          setSelectedStep(currentStepId);
          updateUrl({ step: null });
          window.scrollTo({ top: 0, behavior: "smooth" });
        } : undefined}
      />
      <TerminalModal
        open={terminalStep !== null || terminalTicket !== null || terminalRepo !== null}
        stepId={terminalStep}
        ticketId={terminalTicket?.ticketId ?? null}
        sessionId={terminalTicket?.sessionId ?? terminalRepo?.sessionId ?? null}
        onClose={() => {
          setTerminalStep(null);
          setTerminalTicket(null);
          setTerminalRepo(null);
        }}
      />
      <ArtifactModal
        open={artifactTarget !== null}
        stepId={artifactTarget?.stepId ?? null}
        name={artifactTarget?.name ?? null}
        onClose={() => setArtifactTarget(null)}
      />
      <ConfirmModal request={confirm} onClose={() => setConfirm(null)} />
      <DiffModal open={diffStep !== null} stepId={diffStep} onClose={() => setDiffStep(null)} />
      <MermaidModal open={mermaidOpen} variant={slot.state.flow.activeVariant} onClose={() => setMermaidOpen(false)} />
      <RepoFileModal open={fileTarget !== null} stepId={fileTarget?.stepId ?? null} path={fileTarget?.path ?? null} onClose={() => setFileTarget(null)} />
      <TicketDrawer
        open={ticketsOpen}
        tickets={slot.state.tickets ?? []}
        pendingRequests={slot.state.ticketRequests}
        activeTicketId={slot.state.runtime?.run?.ticket_id ?? null}
        onClose={() => setTicketsOpen(false)}
        onStart={(id, force) => {
          setTicketsOpen(false);
          startTicket(id, force);
        }}
        onOpenTicketTerminal={openTicketTerminal}
      />
      <DocumentModal
        open={Boolean(urlState.doc)}
        docId={urlState.doc}
        heading={urlState.heading}
        text={resolveDocText(slot.state, urlState.doc)}
        onClose={() => updateUrl({ doc: null, heading: null, mode: null })}
      />
    </>
  );
}

function resolveDocText(state: { documents?: Record<string, { text?: string }> } | null, docId: string | null) {
  if (!state || !docId) return "";
  const doc = state.documents?.[docId];
  return doc?.text ?? "";
}
