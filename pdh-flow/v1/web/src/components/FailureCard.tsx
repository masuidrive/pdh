import { useState } from "react";
import type { StepView, Interruption } from "../lib/types";
import { actions } from "../lib/api";
import { useNotifications } from "../lib/notifications";
import { useSingleFlight } from "../lib/use-single-flight";

type Props = {
  step: StepView;
  interruptions?: Interruption[];
  onOpenTerminal: () => void;
};

export function FailureCard({ step, interruptions, onOpenTerminal }: Props) {
  const [diagnoseError, setDiagnoseError] = useState<string | null>(null);
  const flights = useSingleFlight();
  const { notify, notifyError } = useNotifications();
  const diagnosing = flights.isPending("diagnose");
  if (step.progress.status !== "failed" && step.progress.status !== "blocked") return null;
  const attempt = (step.latestAttempt as { provider?: string; attempt?: number; status?: string; finalMessage?: string; exitCode?: number } | null | undefined) ?? null;
  const guards = ((step.uiRuntime as { guards?: { id: string; status: string; evidence?: string }[] } | undefined)?.guards) ?? [];
  const failedGuards = guards.filter((g) => g.status === "failed" || g.status === "fail");
  const findings = step.reviewFindings ?? [];
  const diagnosis = inferDiagnosis(step);

  const handleDiagnose = async () => {
    setDiagnoseError(null);
    try {
      await flights.run("diagnose", () => actions.diagnose());
      notify({
        tone: "info",
        title: "自動診断を起動しました",
        message: "診断結果はこの step の proposal / event に反映されます。",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDiagnoseError(message);
      notifyError(err, { title: "自動診断を起動できませんでした" });
    }
  };

  return (
    <section className="card min-w-0 border border-error/40 bg-error/5 shadow-sm">
      <div className="card-body min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="card-title text-error">失敗診断</h3>
          <span className="badge badge-error badge-sm">{step.progress.status}</span>
          <button
            type="button"
            className="btn btn-warning btn-sm ml-auto"
            onClick={handleDiagnose}
            disabled={diagnosing}
            title="claude に状況を読ませて自動で propose-* シグナルを提案させる (gate.proposal に書き込まれます)"
          >
            {diagnosing ? "🤖 診断中…" : "🤖 自動診断"}
          </button>
          <button type="button" className="btn btn-error btn-sm" onClick={onOpenTerminal}>
            Open Terminal
          </button>
        </div>
        {diagnoseError ? (
          <div className="alert alert-warning mt-3 text-sm">
            <span>自動診断の起動に失敗しました: {diagnoseError}</span>
          </div>
        ) : null}
        {diagnosis ? <div className="alert alert-error mt-3 text-sm">{diagnosis}</div> : null}

        {attempt ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Field label="provider" value={attempt.provider ?? "—"} />
            <Field label="attempt" value={attempt.attempt != null ? String(attempt.attempt) : "—"} />
            <Field label="status" value={attempt.status ?? "—"} />
            {attempt.exitCode != null ? <Field label="exit" value={String(attempt.exitCode)} /> : null}
          </div>
        ) : null}

        {attempt?.finalMessage ? (
          <div className="mt-3 min-w-0">
            <p className="text-xs uppercase tracking-wide text-base-content/50">final message</p>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-box border border-error/30 bg-base-100 p-2 text-xs">{attempt.finalMessage}</pre>
          </div>
        ) : null}

        {failedGuards.length ? (
          <div className="mt-3 min-w-0">
            <p className="text-xs uppercase tracking-wide text-base-content/50">失敗 guards</p>
            <ul className="mt-1 space-y-1 text-sm">
              {failedGuards.map((g) => (
                <li key={g.id} className="flex flex-wrap items-baseline gap-2 min-w-0">
                  <span className="badge badge-error badge-sm shrink-0">{g.status}</span>
                  <span className="font-semibold break-words">{g.id}</span>
                  {g.evidence ? <span className="text-xs text-base-content/60 break-words">{g.evidence}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {findings.length ? (
          <div className="mt-3 min-w-0">
            <p className="text-xs uppercase tracking-wide text-base-content/50">残っている指摘</p>
            <ul className="mt-1 space-y-1 text-sm">
              {findings.slice(0, 5).map((f, i) => (
                <li key={i} className="flex items-baseline gap-2 min-w-0">
                  <span className={`badge badge-${f.severity === "critical" || f.severity === "major" ? "error" : "warning"} badge-sm shrink-0`}>{f.severity}</span>
                  <span className="break-words">{f.title ?? "(untitled)"}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {interruptions?.length ? (
          <div className="mt-3">
            <p className="text-xs uppercase tracking-wide text-base-content/50">割り込み</p>
            <ul className="mt-1 space-y-1 text-sm">
              {interruptions.slice(0, 4).map((it, i) => (
                <li key={i} className="flex items-baseline gap-2">
                  <span className="badge badge-warning badge-sm">{it.kind}</span>
                  <span>{it.message ?? ""}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-base-content/50">{label}</p>
      <p className="font-mono text-sm">{value}</p>
    </div>
  );
}

function inferDiagnosis(step: StepView): string {
  const attempt = (step.latestAttempt as { finalMessage?: string } | null | undefined) ?? null;
  const message = String(attempt?.finalMessage ?? "");
  if (/not logged in/i.test(message) && step.provider === "claude" && step.mode === "review") {
    return "Claude reviewer subprocess failed in a non-interactive auth path. Open the terminal, log in once, then rerun this step.";
  }
  if (/api error: 401/i.test(message)) {
    return "API auth failed. Refresh credentials in the assist terminal and rerun.";
  }
  return "";
}
