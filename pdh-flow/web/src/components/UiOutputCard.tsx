import type { StepView } from "../lib/types";
import { MarkdownContent } from "./MarkdownContent";
import { normalizeRisks } from "../lib/evidence-resolver";

type UiOutput = {
  summary?: string[];
  // risks may be a list of either strings (legacy) or
  // { description, severity, defer_to_step } objects. We normalize both
  // shapes via normalizeRisks before rendering.
  risks?: unknown;
  notes?: string;
  judgement?: { status?: string; summary?: string; details?: string };
  parseErrors?: string[];
  parseWarnings?: string[];
};

const RISK_BADGE: Record<string, string> = {
  critical: "badge-error",
  major: "badge-warning",
  minor: "badge-info",
  note: "badge-ghost"
};

type Props = {
  step: StepView;
};

export function UiOutputCard({ step }: Props) {
  const ui = (step.uiOutput as UiOutput | null | undefined) ?? null;
  if (!ui) return null;
  const summary = ui.summary ?? [];
  const risks = normalizeRisks(ui.risks);
  const notes = (ui.notes ?? "").trim();
  const judgement = ui.judgement ?? null;
  const parseErrors = ui.parseErrors ?? [];
  const parseWarnings = ui.parseWarnings ?? [];

  if (!summary.length && !risks.length && !notes && !judgement && !parseErrors.length && !parseWarnings.length) {
    return null;
  }

  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="card-title">この step の出力</h3>
          {judgement?.status ? <span className="badge badge-info badge-sm">judgement: {judgement.status}</span> : null}
        </div>

        {summary.length ? (
          <Section title="要点">
            <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
              {summary.map((s, i) => (
                <li key={i} className="break-words">{s}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        {risks.length ? (
          <Section title="リスク">
            <ul className="list-none space-y-1 text-sm leading-6">
              {risks.map((r, i) => (
                <li key={i} className="flex items-baseline gap-2 break-words">
                  <span className={`badge ${RISK_BADGE[r.severity] ?? "badge-ghost"} badge-sm shrink-0`}>{r.severity}</span>
                  <span>
                    {r.description}
                    {r.defer_to_step ? (
                      <span className="ml-2 text-xs text-base-content/60">→ {r.defer_to_step}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {judgement?.summary || judgement?.details ? (
          <Section title="判定">
            {judgement.summary ? <p className="text-sm">{judgement.summary}</p> : null}
            {judgement.details ? <pre className="whitespace-pre-wrap text-xs leading-5 text-base-content/70">{judgement.details}</pre> : null}
          </Section>
        ) : null}

        {notes ? (
          <Section title="Notes">
            <NotesMarkdown text={notes} />
          </Section>
        ) : null}

        {parseErrors.length || parseWarnings.length ? (
          <Section title="Parse">
            {parseErrors.length ? (
              <ul className="text-xs text-error">
                {parseErrors.map((e, i) => (
                  <li key={i}>error: {e}</li>
                ))}
              </ul>
            ) : null}
            {parseWarnings.length ? (
              <ul className="text-xs text-warning">
                {parseWarnings.map((w, i) => (
                  <li key={i}>warn: {w}</li>
                ))}
              </ul>
            ) : null}
          </Section>
        ) : null}
      </div>
    </section>
  );
}

function NotesMarkdown({ text }: { text: string }) {
  return (
    <MarkdownContent
      text={text}
      className="evidence-md text-sm leading-6 text-base-content/85"
      fallbackClassName="whitespace-pre-wrap text-xs leading-5 text-base-content/80"
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-2">
      <h4 className="text-xs font-bold uppercase tracking-wide text-base-content/60">{title}</h4>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}
