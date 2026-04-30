import type { StepView } from "../lib/types";
import { useMarkdown } from "../lib/markdown";

type UiOutput = {
  summary?: string[];
  risks?: string[];
  notes?: string;
  judgement?: { status?: string; summary?: string; details?: string };
  parseErrors?: string[];
  parseWarnings?: string[];
};

type Props = {
  step: StepView;
};

export function UiOutputCard({ step }: Props) {
  const ui = (step.uiOutput as UiOutput | null | undefined) ?? null;
  if (!ui) return null;
  const summary = ui.summary ?? [];
  const risks = ui.risks ?? [];
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
            <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
              {risks.map((r, i) => (
                <li key={i} className="break-words">{r}</li>
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
  const html = useMarkdown(text);
  if (html) {
    return <div className="evidence-md text-sm leading-6 text-base-content/85" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <pre className="whitespace-pre-wrap text-xs leading-5 text-base-content/80">{text}</pre>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-2">
      <h4 className="text-xs font-bold uppercase tracking-wide text-base-content/60">{title}</h4>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}
