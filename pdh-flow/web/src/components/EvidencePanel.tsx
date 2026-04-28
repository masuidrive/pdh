import type { ArtifactEntry, StepView } from "../lib/types";

type Props = {
  step: StepView;
  onOpenArtifact: (name: string) => void;
};

export function EvidencePanel({ step, onOpenArtifact }: Props) {
  const artifacts = step.artifacts ?? [];
  const reviewDiff = step.reviewDiff ?? null;
  const findings = step.reviewFindings ?? [];
  const judgements = step.judgements ?? [];
  const noteSection = step.noteSection ?? "";

  if (!artifacts.length && !reviewDiff?.changedFiles?.length && !findings.length && !judgements.length && !noteSection.trim()) {
    return null;
  }

  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body">
        <h3 className="card-title">判断材料</h3>
        <div className="grid gap-4">
          {reviewDiff?.changedFiles?.length ? (
            <DiffCard reviewDiff={reviewDiff} />
          ) : null}
          {noteSection.trim() ? (
            <NoteSectionCard text={noteSection} stepId={step.id} />
          ) : null}
          {findings.length ? <FindingsCard findings={findings} /> : null}
          {judgements.length ? <JudgementsCard judgements={judgements} /> : null}
          {artifacts.length ? (
            <ArtifactsCard artifacts={artifacts} onOpen={onOpenArtifact} />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function DiffCard({ reviewDiff }: { reviewDiff: NonNullable<StepView["reviewDiff"]> }) {
  const changed = reviewDiff.changedFiles ?? [];
  return (
    <div className="card border border-base-300 bg-base-200">
      <div className="card-body">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="font-bold">変更差分</h4>
            <p className="mt-1 text-sm text-base-content/70">{changed.length} files</p>
            <ul className="mt-2 list-disc pl-5 text-sm text-base-content/70">
              {changed.slice(0, 8).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            {changed.length > 8 ? <p className="text-xs text-base-content/50">+{changed.length - 8} more</p> : null}
          </div>
          <span className="badge badge-ghost">{reviewDiff.baseLabel ?? "diff"}</span>
        </div>
      </div>
    </div>
  );
}

function NoteSectionCard({ text, stepId }: { text: string; stepId: string }) {
  const preview = text.split("\n").slice(0, 6).join("\n");
  return (
    <div className="card border border-base-300 bg-base-200">
      <div className="card-body">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="font-bold">current-note.md</h4>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-6 text-base-content/70">{preview}</pre>
          </div>
          <span className="badge badge-ghost">{stepId}</span>
        </div>
      </div>
    </div>
  );
}

function FindingsCard({ findings }: { findings: NonNullable<StepView["reviewFindings"]> }) {
  return (
    <div className="card border border-base-300 bg-base-200">
      <div className="card-body">
        <h4 className="font-bold">Reviewer findings</h4>
        <ul className="space-y-2">
          {findings.map((f, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className={`badge badge-${severityTone(f.severity)} badge-sm`}>{f.severity}</span>
              <div>
                <div className="font-semibold text-sm">{f.title ?? "(untitled)"}</div>
                {f.evidence ? <div className="text-xs text-base-content/70">{f.evidence}</div> : null}
                {f.recommendation ? <div className="text-xs text-base-content/60">→ {f.recommendation}</div> : null}
                {f.reviewerLabel ? <div className="text-xs text-base-content/50">{f.reviewerLabel}</div> : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function JudgementsCard({ judgements }: { judgements: NonNullable<StepView["judgements"]> }) {
  return (
    <div className="card border border-base-300 bg-base-200">
      <div className="card-body">
        <h4 className="font-bold">Judgement</h4>
        <ul className="space-y-1 text-sm">
          {judgements.map((j) => (
            <li key={j.kind} className="flex items-center gap-3">
              <span className="badge badge-outline">{j.kind}</span>
              <span className="font-semibold">{j.status ?? "—"}</span>
              {j.summary ? <span className="text-base-content/70">{j.summary}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ArtifactsCard({ artifacts, onOpen }: { artifacts: ArtifactEntry[]; onOpen: (name: string) => void }) {
  return (
    <div className="card border border-base-300 bg-base-200">
      <div className="card-body">
        <h4 className="font-bold">Artifacts</h4>
        <ul className="grid gap-2 sm:grid-cols-2">
          {artifacts.map((a) => (
            <li key={a.name}>
              <button
                type="button"
                className="btn btn-sm btn-ghost h-auto w-full justify-between gap-3 border border-base-300 bg-base-100 py-2 text-left font-normal hover:bg-base-200"
                onClick={() => onOpen(a.name)}
              >
                <span className="truncate">{a.name}</span>
                {a.size ? <span className="badge badge-ghost badge-sm">{a.size}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function severityTone(severity: string) {
  switch (severity) {
    case "critical":
    case "major":
      return "error";
    case "minor":
      return "warning";
    default:
      return "neutral";
  }
}
