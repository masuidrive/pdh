import type { ActionButton, HistoryEntry, Interruption, NextAction, StepView } from "../lib/types";
import { EvidencePanel } from "./EvidencePanel";
import { FailureCard } from "./FailureCard";
import { GateSummaryCard } from "./GateSummaryCard";
import { UiOutputCard } from "./UiOutputCard";
import { CompletionCard } from "./CompletionCard";
import { AssistSignalBanner } from "./AssistSignalBanner";

type Props = {
  step: StepView | null;
  next?: NextAction | null;
  allSteps: StepView[];
  history?: HistoryEntry[];
  interruptions?: Interruption[];
  documents?: Record<string, { path: string; text: string }>;
  onOpenTerminal: (stepId: string) => void;
  onOpenArtifact: (stepId: string, name: string) => void;
  onOpenDiff?: (stepId: string) => void;
  onOpenFile?: (stepId: string, path: string) => void;
  onOpenDocument?: (docId: string, heading?: string | null) => void;
  onConfirm: (kind: string, ctx: { stepId?: string; stepLabel?: string; recommendationText?: string }) => void;
};

const TONE_BADGE: Record<string, string> = {
  needs_human: "badge-warning",
  waiting: "badge-warning",
  failed: "badge-error",
  active: "badge-info",
  running: "badge-info",
  done: "badge-success",
  completed: "badge-success",
  blocked: "badge-error",
  interrupted: "badge-warning",
};

const TONE_ALERT: Record<string, string> = {
  needs_human: "alert-warning",
  waiting: "alert-warning",
  failed: "alert-error",
  active: "alert-info",
  running: "alert-info",
  blocked: "alert-error",
  interrupted: "alert-warning",
};

export function Workspace({ step, next, allSteps, history, interruptions, documents, onOpenTerminal, onOpenArtifact, onOpenDiff, onOpenDocument, onConfirm }: Props) {
  if (!step) {
    return <section className="p-8 text-base-content/60">step を選択してください</section>;
  }

  const status = step.progress.status;
  const recommendationText = step.gate?.recommendationText ?? step.gate?.summaryText ?? undefined;

  function runAction(action: ActionButton) {
    if (action.kind === "assist" || action.kind === "open_terminal") {
      onOpenTerminal(step!.id);
      return;
    }
    onConfirm(action.kind, { stepId: step!.id, stepLabel: step!.label, recommendationText });
  }

  const actionButtons = next?.actions ?? [];
  const primary = actionButtons.find((a) => a.tone === "approve") ?? null;
  const others = actionButtons.filter((a) => a !== primary);

  return (
    <section className="min-w-0 p-5 pb-28 lg:p-8 lg:pb-28">
      <div className="mx-auto grid max-w-7xl gap-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="breadcrumbs p-0 text-sm text-base-content/60">
              <ul>
                <li>{step.id}</li>
                {step.mode ? <li>{step.mode}</li> : null}
                {status ? <li>{labelForStatus(status)}</li> : null}
              </ul>
            </div>
            <h2 className="mt-2 text-3xl font-bold">{step.label}</h2>
            {step.summary ? <p className="mt-2 max-w-3xl text-sm text-base-content/70">{step.summary}</p> : null}
            {status ? (
              <div className={`badge ${TONE_BADGE[status] ?? "badge-neutral"} badge-soft mt-4 gap-2`}>
                <span className="status status-warning"></span>
                {labelForStatus(status)}
              </div>
            ) : null}
          </div>
        </div>

        {next ? (
          <div className={`alert ${TONE_ALERT[status] ?? "alert-info"}`}>
            <span className="badge badge-lg">!</span>
            <div>
              <h3 className="font-bold">{next.title}</h3>
              {next.body ? <div className="text-sm whitespace-pre-line">{next.body}</div> : null}
            </div>
          </div>
        ) : null}

        <div className="grid gap-5">
          <FailureCard step={step} interruptions={interruptions} onOpenTerminal={() => onOpenTerminal(step.id)} />
          <AssistSignalBanner signal={step.assistSignal} />
          {step.gate?.summaryText || step.gate?.recommendationText ? <GateSummaryCard gate={step.gate} /> : null}
          {step.progress.status === "done" || step.progress.status === "completed" ? (
            <CompletionCard history={step.historyEntry} />
          ) : null}
          <UiOutputCard step={step} />
          {actionButtons.length ? (
            <section className="card border border-base-300 bg-base-100 shadow-sm">
              <div className="card-body">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="card-title">Next</h3>
                  {next?.commands?.length ? (
                    <details className="dropdown dropdown-end">
                      <summary className="btn btn-ghost btn-xs">CLI で実行</summary>
                      <pre className="mt-2 max-w-md overflow-auto rounded-box border border-base-300 bg-base-200 p-3 text-xs">
                        {next.commands.join("\n")}
                      </pre>
                    </details>
                  ) : null}
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  {others.map((btn) => (
                    <ActionTile
                      key={btn.kind + btn.label}
                      action={btn}
                      onClick={() => runAction(btn)}
                    />
                  ))}
                  {primary ? (
                    <ActionTile
                      action={primary}
                      featured
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
  onClick,
}: {
  action: ActionButton;
  featured?: boolean;
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
          <button className={buttonClass} onClick={onClick} type="button">
            {action.label}
          </button>
        </div>
      </div>
    </div>
  );
}

function toneToBtn(tone: string | undefined, featured?: boolean) {
  if (featured || tone === "approve") return "btn-success";
  switch (tone) {
    case "warning":
      return "btn-warning";
    case "danger":
    case "reject":
      return "btn-error";
    case "neutral":
    default:
      return "btn-outline";
  }
}

function labelForStatus(status: string) {
  switch (status) {
    case "needs_human":
    case "waiting":
      return "ユーザ回答待ち";
    case "active":
    case "running":
      return "実行中";
    case "done":
    case "completed":
      return "完了";
    case "failed":
      return "失敗";
    case "blocked":
      return "ブロック";
    case "pending":
      return "未着手";
    case "interrupted":
      return "割り込み";
    default:
      return status;
  }
}
