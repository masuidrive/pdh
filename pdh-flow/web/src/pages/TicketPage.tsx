import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../lib/use-app-state";
import { Navbar } from "../components/Navbar";
import { Timeline } from "../components/Timeline";
import { Workspace } from "../components/Workspace";
import { BottomBar } from "../components/BottomBar";
import { TerminalModal } from "../components/TerminalModal";
import { ArtifactModal } from "../components/ArtifactModal";
import { ConfirmModal, type ConfirmRequest } from "../components/ConfirmModal";
import { buildConfirmRequest } from "../lib/confirm";
import { DiffModal } from "../components/DiffModal";
import { MermaidModal } from "../components/MermaidModal";
import { RepoFileModal } from "../components/RepoFileModal";
import { TicketDrawer } from "../components/TicketDrawer";
import { StaleRunBanner } from "../components/StaleRunBanner";
import { NoticeBanner } from "../components/NoticeBanner";
import { actions, requireSessionId, type SessionActionResponse } from "../lib/api";
import { DocumentModal } from "../components/DocumentModal";
import { useNotifications } from "../lib/notifications";
import { useSingleFlight } from "../lib/use-single-flight";
import { useUrlState } from "../lib/use-url-state";

export function TicketPage() {
  const { name: routeTicket = null } = useParams<{ name: string }>();
  const ticket = routeTicket ? decodeURIComponent(routeTicket) : null;
  const slot = useAppState(ticket);
  const navigate = useNavigate();
  const [urlState, updateUrl] = useUrlState();
  const [terminalStep, setTerminalStep] = useState<{ stepId: string; force?: boolean } | null>(null);
  const [terminalTicket, setTerminalTicket] = useState<{ ticketId: string; sessionId: string } | null>(null);
  const [terminalRepo, setTerminalRepo] = useState<{ sessionId: string } | null>(null);
  const [artifactTarget, setArtifactTarget] = useState<{ stepId: string; name: string } | null>(null);
  const [selectedStep, setSelectedStep] = useState<string | null>(urlState.step);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [diffStep, setDiffStep] = useState<string | null>(null);
  const [mermaidOpen, setMermaidOpen] = useState(false);
  const [fileTarget, setFileTarget] = useState<{ stepId: string; path: string } | null>(null);
  const [ticketsOpen, setTicketsOpen] = useState(false);
  const flights = useSingleFlight();
  const { notifyError } = useNotifications();

  // Whenever a confirm action kicks the runtime forward, we want focus
  // to follow the new current_step_id once SSE pushes it. Clearing
  // selectedStep + url ?step= lets focusedStepId fall through to
  // current_step_id automatically.
  const RUN_KINDS = new Set([
    "accept_proposal",
    "gate_approve",
    "approve_direct",
    "apply_assist",
    "run_next_direct",
    "run_next_force",
    "resume_direct",
    "resume_force",
  ]);
  function jumpToCurrent() {
    setSelectedStep(null);
    updateUrl({ step: null });
  }

  function requestConfirm(kind: string, ctx: { stepId?: string; stepLabel?: string; proposalText?: string; ticketId?: string }) {
    const req = buildConfirmRequest(kind, ctx);
    if (!req) return;
    const augmented = RUN_KINDS.has(kind)
      ? { ...req, onCompleted: jumpToCurrent }
      : req;
    if (kind === "accept_proposal" && ctx.stepId) {
      const stepId = ctx.stepId;
      setConfirm({
        ...augmented,
        secondaryAction: {
          label: "Open Terminal",
          onClick: () => setTerminalStep({ stepId, force: true }),
        },
      });
      return;
    }
    setConfirm(augmented);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        const next = slot.state?.current?.nextAction;
        const primary = next?.actions?.find((a) => a.tone === "approve");
        if (primary && focusedStep) {
          e.preventDefault();
          if (primary.kind === "assist" || primary.kind === "open_terminal") {
            setTerminalStep({ stepId: focusedStep.id });
          } else {
            requestConfirm(primary.kind, { stepId: focusedStep.id, stepLabel: focusedStep.label });
          }
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function openTicketTerminal(ticketId: string) {
    try {
      const session = await flights.run(
        `ticket-open-terminal:${ticketId}`,
        () => actions.openTicketTerminal(ticketId) as Promise<SessionActionResponse>
      );
      const sessionId = requireSessionId(session);
      if (!sessionId) return;
      setTicketsOpen(false);
      setTerminalTicket({ ticketId, sessionId });
    } catch (err) {
      notifyError(err, { title: `${ticketId} の Terminal を開けませんでした` });
    }
  }

  const variant = useMemo(() => {
    if (!slot.state) return null;
    const flow = slot.state.flow;
    return flow.variants[flow.activeVariant] ?? flow.variants[Object.keys(flow.variants)[0]] ?? null;
  }, [slot.state]);

  // Merge the active variant's steps with any step that exists in the
  // full variant but is excluded from the active one (e.g. PD-C-4 /
  // PD-C-8 during a `light` run). The out-of-variant entries are marked
  // `skipped` so the timeline can render them as muted but still
  // clickable — the prompt panel resolves their preview against the
  // full variant.
  const timelineSteps = useMemo(() => {
    if (!slot.state || !variant) return [];
    const flow = slot.state.flow;
    const active = variant;
    const full = flow.variants.full;
    if (!full || flow.activeVariant === "full") return active.steps;
    const activeById = new Map(active.steps.map((s) => [s.id, s] as const));
    return full.steps.map((s) =>
      activeById.get(s.id) ?? {
        ...s,
        progress: { status: "skipped", note: `(${flow.activeVariant} 対象外)` },
        current: false,
      }
    );
  }, [slot.state, variant]);

  const shownProposalId = useRef<string | null>(null);
  useEffect(() => {
    const currentId = slot.state?.runtime?.run?.current_step_id;
    if (!currentId || !variant) {
      shownProposalId.current = null;
      return;
    }
    const step = variant.steps.find((s) => s.id === currentId);
    const proposal = step?.gate?.proposal;
    if (!proposal || proposal.status !== "pending" || !proposal.id) {
      shownProposalId.current = null;
      return;
    }
    if (shownProposalId.current === proposal.id) return;
    shownProposalId.current = proposal.id;
    setTerminalStep(null);
    setTerminalTicket(null);
    setTerminalRepo(null);
    requestConfirm("accept_proposal", { stepId: step!.id, stepLabel: step!.label });
  }, [slot.state, variant]);

  const focusedStepId =
    selectedStep ?? urlState.step ?? slot.state?.runtime?.run?.current_step_id ?? variant?.steps?.[0]?.id ?? null;
  const focusedStep = timelineSteps.find((s) => s.id === focusedStepId) ?? variant?.steps.find((s) => s.id === focusedStepId) ?? null;
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
        <div className="mt-4">
          <Link to="/" className="btn btn-sm">← ticket 一覧へ戻る</Link>
        </div>
      </div>
    );
  }

  const hasActiveRun = Boolean(slot.state.runtime?.run?.id && slot.state.runtime?.run?.current_step_id);
  if (!hasActiveRun) {
    return (
      <div className="p-8">
        <div className="alert alert-warning">
          <span>{ticket} は未開始 (worktree が無い、または runtime が走っていません)</span>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate("/")}>
            ticket 一覧へ戻って Start
          </button>
        </div>
      </div>
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
        generatedAt={slot.state.generatedAt}
      />
      <div className="lg:flex lg:items-stretch">
        {/*
          Step timeline. On lg+ it lives in a sticky left sidebar so the
          step list is always visible next to the workspace. On sm/md
          it stacks above the main content (block flow) and scrolls
          inline with the page.
        */}
        <aside className="border-base-300 lg:sticky lg:top-12 lg:h-[calc(100vh-3rem)] lg:w-72 lg:shrink-0 lg:overflow-y-auto lg:border-r">
          <div className="px-3 pt-3 pb-2 lg:px-4">
            <Link to="/" className="link link-hover text-sm">← ticket 一覧</Link>
          </div>
          <div className="px-3 pb-4 lg:px-4">
            <Timeline
              steps={timelineSteps}
              currentStepId={focusedStepId}
              onSelect={(id) => setSelectedStep(id)}
            />
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="px-5 pt-4 lg:px-8">
            <StaleRunBanner
              state={slot.state}
              onDiscard={() => requestConfirm("runtime_discard", {})}
            />
            <NoticeBanner notice={slot.state.current?.notice ?? null} />
          </div>
          <main id="workspace" className="min-h-[calc(100vh-4rem)] min-w-0 overflow-x-hidden">
            <Workspace
              step={focusedStep}
              next={next}
              allSteps={variant.steps}
              history={slot.state.history}
              interruptions={slot.state.current?.interruptions}
              documents={slot.state.documents}
              run={slot.state.runtime?.run ?? null}
              runtimeBusy={slot.state.runtime?.supervisor?.running === true}
              onOpenTerminal={(id) => setTerminalStep({ stepId: id })}
              onOpenArtifact={(stepId, name) => setArtifactTarget({ stepId, name })}
              onOpenDiff={(stepId) => setDiffStep(stepId)}
              onOpenFile={(stepId, p) => setFileTarget({ stepId, path: p })}
              onOpenDocument={(docId, heading) => updateUrl({ doc: docId, heading: heading ?? null })}
              onConfirm={requestConfirm}
            />
          </main>
        </div>
      </div>
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
        stepId={terminalStep?.stepId ?? null}
        forceReprompt={terminalStep?.force ?? false}
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
        onStart={(id) => {
          setTicketsOpen(false);
          navigate(`/tickets/${encodeURIComponent(id)}`);
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
