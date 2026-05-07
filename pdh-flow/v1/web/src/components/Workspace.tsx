import type { ActionButton, HistoryEntry, Interruption, NextAction, RunRecord, StepView } from "../lib/types";
import { EvidencePanel } from "./EvidencePanel";
import { FailureCard } from "./FailureCard";
import { UiOutputCard } from "./UiOutputCard";
import { GateContextCard } from "./GateContextCard";
import { ProposalCard } from "./ProposalCard";
import { CompletionCard } from "./CompletionCard";
import { AssistSignalBanner } from "./AssistSignalBanner";
import { RunCompositionPanel } from "./RunCompositionPanel";
import { InterpretationCard } from "./InterpretationCard";
import { PromptPanel } from "./PromptPanel";
import { statusAlertTone, statusBadgeTone, statusLabel } from "../lib/status";

type Props = {
  step: StepView | null;
  next?: NextAction | null;
  allSteps: StepView[];
  history?: HistoryEntry[];
  interruptions?: Interruption[];
  documents?: Record<string, { path: string; text: string }>;
  run?: RunRecord | null;
  // True while the runtime supervisor is actively running. Used to
  // disable run-launching buttons (Approve / Apply / Run-next) so the
  // user can't double-fire while a step is in flight.
  runtimeBusy?: boolean;
  onOpenTerminal: (stepId: string) => void;
  onOpenArtifact: (stepId: string, name: string) => void;
  onOpenDiff?: (stepId: string) => void;
  onOpenFile?: (stepId: string, path: string) => void;
  onOpenDocument?: (docId: string, heading?: string | null) => void;
  onConfirm: (kind: string, ctx: { stepId?: string; stepLabel?: string; proposalText?: string }) => void;
  onRefresh?: () => void;
};

export function Workspace({ step, next, allSteps, history, interruptions, documents, run, runtimeBusy = false, onOpenTerminal, onOpenArtifact, onOpenDiff, onOpenDocument, onConfirm, onRefresh }: Props) {
  if (!step) {
    return <section className="p-8 text-base-content/60">step を選択してください</section>;
  }

  const status = step.progress.status;
  const proposalText: string | undefined = undefined;

  function runAction(action: ActionButton) {
    if (action.kind === "assist" || action.kind === "open_terminal") {
      onOpenTerminal(step!.id);
      return;
    }
    onConfirm(action.kind, { stepId: step!.id, stepLabel: step!.label, proposalText });
  }

  const actionButtons = next?.actions ?? [];
  const primary = actionButtons.find((a) => a.tone === "approve") ?? null;
  const others = actionButtons.filter((a) => a !== primary);

  return (
    <section className="min-w-0 p-5 pb-28 lg:p-8 lg:pb-28">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-base-content/60">
              <span className="font-mono">{step.id}</span>
            </div>
            <h2 className="mt-2 text-3xl font-bold">{step.label}</h2>
            {step.summary ? <p className="mt-2 max-w-3xl text-sm text-base-content/70">{step.summary}</p> : null}
            {status ? (
              <div className={`badge ${statusBadgeTone(status)} badge-soft mt-4 gap-2`}>
                <span className="status status-warning"></span>
                {statusLabel(status)}
              </div>
            ) : null}
          </div>
        </div>

        {next && !hasPendingProposal(step) && next.body ? (
          <div className={`alert ${statusAlertTone(status)} min-w-0`}>
            <span className="badge badge-lg shrink-0">!</span>
            <div className="min-w-0">
              <h3 className="font-bold">{next.title}</h3>
              <div className="text-sm whitespace-pre-line break-words">{next.body}</div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-5">
          <PromptPanel stepId={step.id} />
          <FailureCard step={step} interruptions={interruptions} onOpenTerminal={() => onOpenTerminal(step.id)} />
          <ProposalCard
            stepId={step.id}
            step={step}
            gate={step.gate}
            runtimeBusy={runtimeBusy}
            onAccept={() => onConfirm("accept_proposal", { stepId: step.id, stepLabel: step.label, proposalText })}
            onOpenTerminal={() => onOpenTerminal(step.id)}
          />
          <AssistSignalBanner signal={step.assistSignal} />
          {step.gate ? <GateContextCard step={step} gate={step.gate} /> : null}
          {step.id === "PD-C-1" ? <InterpretationCard step={step} /> : null}
          {step.id === "PD-C-1" ? (
            <RunCompositionPanel
              run={run ?? null}
              steps={allSteps}
              readOnly={
                // Lock the editor only when execution has truly progressed
                // beyond PD-C-1 — i.e. the run advanced to a later step or
                // the variant lock engaged. PD-C-1's human gate sits with
                // status `waiting` (and earlier `pending` / `needs_human`),
                // and during all of those the user is still allowed to
                // tweak the composition before pressing Approve.
                run?.flow_variant_locked === true
                || (run?.current_step_id ?? "PD-C-1") !== "PD-C-1"
                || !(
                  step.progress.status === "pending"
                  || step.progress.status === "needs_human"
                  || step.progress.status === "waiting"
                )
              }
              onApplied={() => onRefresh?.()}
            />
          ) : null}
          {step.progress.status === "done" || step.progress.status === "completed" ? (
            <CompletionCard history={step.historyEntry} />
          ) : null}
          <UiOutputCard step={step} />
          {actionButtons.length ? (
            <section className="card border border-base-300 bg-base-100 shadow-sm">
              <div className="card-body">
                <h3 className="card-title flex items-center gap-2">
                  Next
                  {runtimeBusy ? (
                    <span className="badge badge-info badge-soft gap-2">
                      <span className="loading loading-spinner loading-xs" />
                      実行中
                    </span>
                  ) : null}
                </h3>
                <div className="grid gap-4 md:grid-cols-2">
                  {others.map((btn) => (
                    <ActionTile
                      key={btn.kind + btn.label}
                      action={btn}
                      busy={runtimeBusy}
                      onClick={() => runAction(btn)}
                    />
                  ))}
                  {primary ? (
                    <ActionTile
                      action={primary}
                      featured
                      busy={runtimeBusy}
                      onClick={() => runAction(primary)}
                    />
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          <EvidencePanel
            step={step}
            next={next}
            allSteps={allSteps}
            history={history}
            documents={documents}
            onOpenArtifact={(name) => onOpenArtifact(step.id, name)}
            onOpenDiff={onOpenDiff}
            onOpenDocument={onOpenDocument}
          />
        </div>
      </div>
    </section>
  );
}

function ActionTile({
  action,
  featured,
  busy,
  onClick,
}: {
  action: ActionButton;
  featured?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  const cardClass = featured
    ? "card border border-success bg-success/10"
    : "card border border-base-300 bg-base-200";
  const buttonClass = `btn btn-sm ${toneToBtn(action.tone, featured)}`;
  return (
    <div className={cardClass}>
      <div className="card-body">
        <h4 className="card-title text-base">{action.label}</h4>
        {action.description ? <p className="text-sm">{action.description}</p> : null}
        <div className="card-actions justify-end">
          <button className={buttonClass} onClick={onClick} type="button" disabled={busy}>
            {busy ? <span className="loading loading-spinner loading-xs" /> : null}
            {busy ? "実行中…" : action.label}
          </button>
        </div>
      </div>
    </div>
  );
}

function toneToBtn(tone: string | undefined, featured?: boolean) {
  if (featured || tone === "approve") return "btn-success text-white";
  switch (tone) {
    case "warning":
      return "btn-warning";
    case "danger":
    case "reject":
      return "btn-error";
    case "neutral":
    default:
      return "btn-neutral";
  }
}

function hasPendingProposal(step: StepView): boolean {
  return step.gate?.proposal?.status === "pending";
}
