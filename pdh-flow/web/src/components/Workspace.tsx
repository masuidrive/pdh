import { useState } from "react";
import type { ActionButton, NextAction, StepView } from "../lib/types";
import { actions } from "../lib/api";

type Props = {
  step: StepView | null;
  next?: NextAction | null;
  onOpenTerminal: (stepId: string) => void;
};

const TONE_BADGE: Record<string, string> = {
  needs_human: "badge-warning",
  failed: "badge-error",
  active: "badge-info",
  done: "badge-success",
  blocked: "badge-error",
};

const TONE_ALERT: Record<string, string> = {
  needs_human: "alert-warning",
  failed: "alert-error",
  active: "alert-info",
  blocked: "alert-error",
};

export function Workspace({ step, next, onOpenTerminal }: Props) {
  const [pendingKind, setPendingKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!step) {
    return (
      <section className="p-8 text-base-content/60">step を選択してください</section>
    );
  }

  const status = step.progress.status;
  const stepTitle = step.label.replace(/^PD-C-\d+\s+/, "");
  const ack = step.gate?.recommendationText ?? step.gate?.summaryText ?? null;

  async function runAction(action: ActionButton) {
    setPendingKind(action.kind);
    setError(null);
    try {
      switch (action.kind) {
        case "gate_approve":
          await actions.approve(step!.id);
          break;
        case "accept_recommendation":
          await actions.acceptRecommendation(step!.id);
          break;
        case "apply_assist":
          await actions.applyAssist(step!.id);
          break;
        case "assist":
        case "open_terminal":
          onOpenTerminal(step!.id);
          break;
        case "run_next_direct":
          await actions.runNext(false);
          break;
        case "resume_direct":
          await actions.resume(false);
          break;
        case "stop_direct":
          await actions.stop();
          break;
        default:
          setError(`Unsupported action: ${action.kind}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPendingKind(null);
    }
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
            <h2 className="mt-2 text-3xl font-bold">{stepTitle || step.id}</h2>
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

        {error ? (
          <div className="alert alert-error">
            <span>{error}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setError(null)} type="button">Dismiss</button>
          </div>
        ) : null}

        <div className="grid gap-5">
          {step.noteSection ? (
            <section className="card border border-base-300 bg-base-100 shadow-sm">
              <div className="card-body">
                <h3 className="card-title">要点</h3>
                <pre className="whitespace-pre-wrap text-sm leading-7">{step.noteSection.slice(0, 2000)}</pre>
              </div>
            </section>
          ) : null}

          {actionButtons.length ? (
            <section className="card border border-base-300 bg-base-100 shadow-sm">
              <div className="card-body">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="card-title">Next</h3>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  {others.map((btn) => (
                    <ActionTile
                      key={btn.kind + btn.label}
                      action={btn}
                      pending={pendingKind === btn.kind}
                      onClick={() => runAction(btn)}
                    />
                  ))}
                  {primary ? (
                    <ActionTile
                      action={primary}
                      featured
                      pending={pendingKind === primary.kind}
                      onClick={() => runAction(primary)}
                    />
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {ack ? (
            <section className="card border border-base-300 bg-base-100 shadow-sm">
              <div className="card-body">
                <h3 className="card-title">判断材料</h3>
                <pre className="whitespace-pre-wrap text-sm leading-7">{ack}</pre>
              </div>
            </section>
          ) : null}

          {step.judgements && step.judgements.length ? (
            <section className="card border border-base-300 bg-base-100 shadow-sm">
              <div className="card-body">
                <h3 className="card-title">Judgement</h3>
                <ul className="space-y-2">
                  {step.judgements.map((j) => (
                    <li key={j.kind} className="flex items-start gap-3">
                      <span className="badge badge-outline">{j.kind}</span>
                      <div>
                        <div className="font-semibold">{j.status ?? "—"}</div>
                        {j.summary ? <div className="text-sm text-base-content/70">{j.summary}</div> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ActionTile({
  action,
  pending,
  featured,
  onClick,
}: {
  action: ActionButton;
  pending: boolean;
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
          <button className={buttonClass} onClick={onClick} disabled={pending} type="button">
            {pending ? <span className="loading loading-spinner loading-xs" /> : null}
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
      return "ユーザ回答待ち";
    case "active":
      return "実行中";
    case "done":
      return "完了";
    case "failed":
      return "失敗";
    case "blocked":
      return "ブロック";
    case "pending":
      return "未着手";
    default:
      return status;
  }
}
