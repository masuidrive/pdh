import type { ArtifactEntry, NextAction, StepView, HistoryEntry } from "../lib/types";
import { resolveStepEvidence, resolveStepReady, type EvidenceItem, type EvidenceKind } from "../lib/evidence-resolver";

type Props = {
  step: StepView;
  next?: NextAction | null;
  allSteps: StepView[];
  history?: HistoryEntry[];
  onOpenArtifact: (name: string) => void;
  onOpenDiff?: (stepId: string) => void;
  onOpenFile?: (stepId: string, path: string) => void;
};

const KIND_LABELS: Record<EvidenceKind, string> = {
  diff: "diff",
  plan: "plan",
  risk: "risk",
  risks: "risks",
  verification: "verification",
  commands: "CLI",
  note: "note",
  ticket_notes: "ticket",
  provider: "provider",
  guards: "guards",
  interruptions: "interruptions",
  review: "review",
  ac: "AC",
  purpose: "purpose",
  cleanup: "cleanup",
  changed_files: "files",
  ready: "ready",
};

const KIND_TONE: Record<EvidenceKind, string> = {
  diff: "info",
  plan: "ghost",
  risk: "warning",
  risks: "warning",
  verification: "success",
  commands: "neutral",
  note: "ghost",
  ticket_notes: "ghost",
  provider: "info",
  guards: "warning",
  interruptions: "warning",
  review: "info",
  ac: "success",
  purpose: "info",
  cleanup: "neutral",
  changed_files: "info",
  ready: "success",
};

export function EvidencePanel({ step, next, allSteps, history, onOpenArtifact, onOpenDiff }: Props) {
  const resolved = resolveStepEvidence(step, next ?? null, { allSteps, history: history ?? [] });
  const ready = resolveStepReady(step);
  const artifacts = step.artifacts ?? [];
  const findings = step.reviewFindings ?? [];
  const judgements = step.judgements ?? [];

  if (!resolved.length && !ready.length && !artifacts.length && !findings.length && !judgements.length) {
    return null;
  }

  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body">
        <h3 className="card-title">判断材料</h3>
        <div className="grid gap-3">
          {resolved.map((it, i) => (
            <ContractRow
              key={`${it.label}-${i}`}
              item={it}
              onOpenDiff={onOpenDiff && it.kind === "diff" && it.diffStepId ? () => onOpenDiff(it.diffStepId!) : undefined}
            />
          ))}

          {ready.length ? <ReadyRow ready={ready} /> : null}

          {findings.length ? <FindingsRow findings={findings} /> : null}

          {judgements.length ? <JudgementsRow judgements={judgements} /> : null}

          {artifacts.length ? (
            <details className="rounded-box border border-base-300 bg-base-200 p-4">
              <summary className="cursor-pointer text-sm font-bold">Artifacts ({artifacts.length})</summary>
              <ul className="mt-3 grid gap-2">
                {artifacts.map((a) => (
                  <ArtifactRow key={a.name} artifact={a} onOpen={() => onOpenArtifact(a.name)} />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ContractRow({ item, onOpenDiff }: { item: EvidenceItem; onOpenDiff?: () => void }) {
  const tone = KIND_TONE[item.kind] ?? "ghost";
  const onClick = onOpenDiff;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`rounded-box border border-base-300 bg-base-200 p-4 text-left ${onClick ? "cursor-pointer hover:bg-base-300/40" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate font-bold">{item.label}</h4>
            <span className={`badge badge-${tone} badge-sm`}>{KIND_LABELS[item.kind]}</span>
          </div>
          {item.source ? <p className="mt-1 text-xs text-base-content/50">{item.source}</p> : null}
          {item.body ? (
            <pre className="mt-2 max-h-44 overflow-hidden whitespace-pre-wrap text-xs leading-6 text-base-content/80">
              {item.body}
            </pre>
          ) : (
            <p className="mt-2 text-xs italic text-base-content/40">(まだデータなし)</p>
          )}
        </div>
      </div>
    </Tag>
  );
}

function ReadyRow({ ready }: { ready: { label: string; kind: string }[] }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-200 p-4">
      <div className="flex items-center gap-2">
        <h4 className="font-bold">Ready when</h4>
        <span className="badge badge-success badge-sm">{ready.length} items</span>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {ready.map((r, i) => (
          <li key={i} className="flex items-baseline gap-2">
            <span className={`badge badge-${readyTone(r.kind)} badge-sm`}>{r.kind}</span>
            <span className="text-base-content/80">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FindingsRow({ findings }: { findings: NonNullable<StepView["reviewFindings"]> }) {
  const top = findings.slice(0, 5);
  return (
    <div className="rounded-box border border-base-300 bg-base-200 p-4">
      <div className="flex items-center gap-2">
        <h4 className="font-bold">Reviewer findings</h4>
        <span className="badge badge-warning badge-sm">{findings.length} items</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {top.map((f, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={`badge badge-${severityTone(f.severity)} badge-sm`}>{f.severity}</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{f.title ?? "(untitled)"}</div>
              {f.evidence ? <div className="truncate text-xs text-base-content/60">{f.evidence}</div> : null}
              {f.reviewerLabel ? <div className="text-xs text-base-content/40">{f.reviewerLabel}</div> : null}
            </div>
          </li>
        ))}
        {findings.length > top.length ? (
          <li className="text-xs text-base-content/50">+{findings.length - top.length} more</li>
        ) : null}
      </ul>
    </div>
  );
}

function JudgementsRow({ judgements }: { judgements: NonNullable<StepView["judgements"]> }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-200 p-4">
      <div className="flex items-center gap-2">
        <h4 className="font-bold">Judgement</h4>
        <span className="badge badge-info badge-sm">{judgements.length} items</span>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {judgements.map((j) => (
          <li key={j.kind} className="flex flex-wrap items-baseline gap-2">
            <span className="badge badge-outline badge-sm">{j.kind}</span>
            <span className="font-semibold">{j.status ?? "—"}</span>
            {j.summary ? <span className="text-base-content/70">{j.summary}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ArtifactRow({ artifact, onOpen }: { artifact: ArtifactEntry; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        className="btn btn-ghost h-auto w-full justify-between gap-3 border border-base-300 bg-base-100 py-2 text-left font-normal hover:bg-base-200"
        onClick={onOpen}
      >
        <span className="truncate text-sm">{artifact.name}</span>
        <span className="flex items-center gap-2">
          {artifact.size ? <span className="badge badge-ghost badge-sm">{String(artifact.size)}</span> : null}
          <span className="badge badge-outline badge-sm">{artifactKind(artifact.name)}</span>
        </span>
      </button>
    </li>
  );
}

function artifactKind(name: string) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["md", "markdown"].includes(ext)) return "md";
  if (["json"].includes(ext)) return "json";
  if (["yaml", "yml"].includes(ext)) return "yaml";
  if (["patch", "diff"].includes(ext)) return "diff";
  return ext || "file";
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

function readyTone(kind: string) {
  switch (kind) {
    case "ok":
    case "ready":
    case "verified":
      return "success";
    case "fail":
    case "failed":
    case "blocked":
      return "error";
    case "pending":
    case "unverified":
      return "warning";
    default:
      return "ghost";
  }
}
