import type { RuntimeNotice } from "../lib/types";

const KIND_LABEL: Record<string, string> = {
  assist_escalation_opened: "Runtime escalation",
  run_failed: "Run failed",
  guard_failed: "Guard failed",
  human_gate_proposal_failed: "Proposal rejected by runtime",
  human_gate_recommendation_failed: "Proposal rejected by runtime",
};

function formatTs(ts?: string | null) {
  if (!ts) return "";
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return ts ?? "";
  return new Date(t).toLocaleTimeString();
}

export function NoticeBanner({ notice }: { notice: RuntimeNotice | null | undefined }) {
  if (!notice) return null;
  const label = KIND_LABEL[notice.kind] ?? notice.kind;
  return (
    <section className="alert alert-error mb-4 flex items-start gap-3 min-w-0">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="font-bold">{label}</h3>
          {notice.stepId ? <span className="font-mono text-xs opacity-80">{notice.stepId}</span> : null}
          <span className="text-xs opacity-70">{formatTs(notice.ts)}</span>
        </div>
        {notice.message ? <p className="mt-1 text-sm whitespace-pre-line break-words">{notice.message}</p> : null}
        {notice.detail && notice.detail !== notice.message ? (
          <p className="mt-1 text-sm whitespace-pre-line break-words">{notice.detail}</p>
        ) : null}
        {notice.failedGuards?.length ? (
          <ul className="mt-2 list-disc pl-5 text-sm">
            {notice.failedGuards.map((g) => (
              <li key={g} className="font-mono">{g}</li>
            ))}
          </ul>
        ) : null}
        {notice.escalation ? (
          <p className="mt-2 text-xs opacity-70">Escalation: {notice.escalation}</p>
        ) : null}
      </div>
    </section>
  );
}
