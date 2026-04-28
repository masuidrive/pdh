import type { ArtifactEntry, JudgementEntry, ReviewDiff, ReviewFinding, StepView } from "../lib/types";

type Props = {
  step: StepView;
  onOpenArtifact: (name: string) => void;
};

export function EvidencePanel({ step, onOpenArtifact }: Props) {
  const artifacts = step.artifacts ?? [];
  const reviewDiff = step.reviewDiff ?? null;
  const findings = step.reviewFindings ?? [];
  const judgements = step.judgements ?? [];
  const noteSection = (step.noteSection ?? "").trim();
  const hasDiff = (reviewDiff?.changedFiles?.length ?? 0) > 0;

  if (!artifacts.length && !hasDiff && !findings.length && !judgements.length && !noteSection) {
    return null;
  }

  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body">
        <h3 className="card-title">判断材料</h3>
        <div className="grid gap-3">
          {hasDiff ? <DiffRow reviewDiff={reviewDiff!} /> : null}
          {noteSection ? <NoteRow text={noteSection} stepId={step.id} /> : null}
          {findings.length ? <FindingsRow findings={findings} /> : null}
          {judgements.length ? <JudgementsRow judgements={judgements} /> : null}
          {artifacts.map((a) => (
            <ArtifactRow key={a.name} artifact={a} onOpen={() => onOpenArtifact(a.name)} />
          ))}
        </div>
      </div>
    </section>
  );
}

function EvidenceRow({
  title,
  badge,
  badgeTone = "ghost",
  description,
  meta,
  onClick,
  children,
}: {
  title: string;
  badge?: string;
  badgeTone?: string;
  description?: string;
  meta?: string;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const baseClass = "rounded-box border border-base-300 bg-base-200 p-4 text-left transition-colors";
  const hover = onClick ? "cursor-pointer hover:bg-base-300/40" : "";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={`${baseClass} ${hover}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate font-bold">{title}</h4>
            {meta ? <span className="text-xs text-base-content/50">{meta}</span> : null}
          </div>
          {description ? <p className="mt-1 text-sm text-base-content/70">{description}</p> : null}
          {children}
        </div>
        {badge ? <span className={`badge badge-${badgeTone} shrink-0`}>{badge}</span> : null}
      </div>
    </Tag>
  );
}

function DiffRow({ reviewDiff }: { reviewDiff: ReviewDiff }) {
  const changed = reviewDiff.changedFiles ?? [];
  const preview = changed.slice(0, 6).join(" · ");
  const extra = changed.length > 6 ? ` · +${changed.length - 6} more` : "";
  return (
    <EvidenceRow
      title="変更差分"
      badge={reviewDiff.baseLabel ?? "diff"}
      meta={`${changed.length} files`}
      description={preview ? preview + extra : undefined}
    />
  );
}

function NoteRow({ text, stepId }: { text: string; stepId: string }) {
  const preview = text.split("\n").filter(Boolean).slice(0, 4).join("\n");
  return (
    <EvidenceRow title="current-note.md" badge={stepId}>
      <pre className="mt-2 max-h-32 overflow-hidden whitespace-pre-wrap text-xs leading-6 text-base-content/70">
        {preview}
      </pre>
    </EvidenceRow>
  );
}

function FindingsRow({ findings }: { findings: ReviewFinding[] }) {
  const top = findings.slice(0, 5);
  return (
    <EvidenceRow title="Reviewer findings" badge={`${findings.length} items`} badgeTone="warning">
      <ul className="mt-2 space-y-1.5">
        {top.map((f, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={`badge badge-${severityTone(f.severity)} badge-sm`}>{f.severity}</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{f.title ?? "(untitled)"}</div>
              {f.evidence ? <div className="truncate text-xs text-base-content/60">{f.evidence}</div> : null}
            </div>
          </li>
        ))}
        {findings.length > top.length ? (
          <li className="text-xs text-base-content/50">+{findings.length - top.length} more</li>
        ) : null}
      </ul>
    </EvidenceRow>
  );
}

function JudgementsRow({ judgements }: { judgements: JudgementEntry[] }) {
  return (
    <EvidenceRow title="Judgement" badge={`${judgements.length} items`}>
      <ul className="mt-2 space-y-1 text-sm">
        {judgements.map((j) => (
          <li key={j.kind} className="flex flex-wrap items-baseline gap-2">
            <span className="badge badge-outline badge-sm">{j.kind}</span>
            <span className="font-semibold">{j.status ?? "—"}</span>
            {j.summary ? <span className="text-base-content/70">{j.summary}</span> : null}
          </li>
        ))}
      </ul>
    </EvidenceRow>
  );
}

function ArtifactRow({ artifact, onOpen }: { artifact: ArtifactEntry; onOpen: () => void }) {
  return (
    <EvidenceRow
      title={artifact.name}
      badge={artifactKind(artifact.name)}
      meta={artifact.size ? String(artifact.size) : undefined}
      description={artifactHint(artifact.name)}
      onClick={onOpen}
    />
  );
}

function artifactKind(name: string) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["md", "markdown"].includes(ext)) return "markdown";
  if (["json"].includes(ext)) return "json";
  if (["yaml", "yml"].includes(ext)) return "yaml";
  if (["txt", "log"].includes(ext)) return ext;
  if (["patch", "diff"].includes(ext)) return "diff";
  return "file";
}

function artifactHint(name: string) {
  if (name.endsWith("/manifest.json")) return "Assist セッションのメタ情報";
  if (name.endsWith("/prompt.md")) return "Provider に渡された run プロンプト";
  if (name.endsWith("/session.json")) return "Provider 実行セッションのログ";
  if (name.endsWith("/system-prompt.txt")) return "system prompt の内容";
  if (name.endsWith("ui-output.json")) return "step の UI 出力";
  if (name.endsWith("ui-runtime.json")) return "runtime が観測した UI 状態";
  if (name.endsWith("human-gate-summary.md")) return "Gate に提示する要点まとめ";
  if (name.includes("review")) return "Review round の出力";
  if (name.includes("aggregate")) return "Aggregator のまとめ";
  if (name.includes("repair")) return "Repair round の出力";
  return "クリックで全文表示";
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
