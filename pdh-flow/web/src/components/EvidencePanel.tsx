import type { ArtifactEntry, NextAction, StepView, HistoryEntry, JudgementEntry, ReviewFinding } from "../lib/types";
import { resolveStepEvidence, resolveStepReady, type EvidenceItem, type EvidenceKind } from "../lib/evidence-resolver";

type Props = {
  step: StepView;
  next?: NextAction | null;
  allSteps: StepView[];
  history?: HistoryEntry[];
  documents?: Record<string, { path: string; text: string }>;
  onOpenArtifact: (name: string) => void;
  onOpenDiff?: (stepId: string) => void;
  onOpenDocument?: (docId: string, heading?: string | null) => void;
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

const NOTE_HEADING_BY_STEP: Record<string, string> = {
  "PD-C-2": "PD-C-2",
  "PD-C-3": "PD-C-3",
  "PD-C-4": "PD-C-4",
  "PD-C-5": "PD-C-5",
  "PD-C-6": "PD-C-6",
  "PD-C-7": "PD-C-7",
  "PD-C-8": "PD-C-8",
  "PD-C-9": "PD-C-9",
  "PD-C-10": "PD-C-10",
};

export function EvidencePanel({ step, next, allSteps, history, documents, onOpenArtifact, onOpenDiff, onOpenDocument }: Props) {
  const resolved = resolveStepEvidence(step, next ?? null, { allSteps, history: history ?? [] });
  const ready = resolveStepReady(step);
  const artifacts = step.artifacts ?? [];
  const findings = step.reviewFindings ?? [];
  const judgements = step.judgements ?? [];
  const docs = documents ?? {};

  if (!resolved.length && !ready.length && !artifacts.length && !findings.length && !judgements.length && !Object.keys(docs).length) {
    return null;
  }

  const noteHeading = NOTE_HEADING_BY_STEP[step.id] ?? null;

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

          {docs.note ? (
            <DocumentRow
              docId="note"
              label="current-note.md"
              badge={noteHeading ? `current-note.md#${noteHeading}` : "current-note.md"}
              text={excerptByHeading(docs.note.text, noteHeading)}
              onOpen={onOpenDocument ? () => onOpenDocument("note", noteHeading) : undefined}
            />
          ) : null}

          {docs.ticket ? (
            <DocumentRow
              docId="ticket"
              label="current-ticket.md"
              badge="current-ticket.md"
              text={excerptByHeading(docs.ticket.text, "Acceptance Criteria") || excerptByHeading(docs.ticket.text, "AC") || preview(docs.ticket.text)}
              onOpen={onOpenDocument ? () => onOpenDocument("ticket") : undefined}
            />
          ) : null}

          {docs.productBrief ? (
            <DocumentRow
              docId="productBrief"
              label="product-brief.md"
              badge="product-brief.md"
              text={preview(docs.productBrief.text)}
              onOpen={onOpenDocument ? () => onOpenDocument("productBrief") : undefined}
            />
          ) : null}

          {docs.epic ? (
            <DocumentRow
              docId="epic"
              label="current-epic.md"
              badge="current-epic.md"
              text={preview(docs.epic.text)}
              onOpen={onOpenDocument ? () => onOpenDocument("epic") : undefined}
            />
          ) : null}

          {artifacts.length ? <ArtifactsBlock artifacts={artifacts} onOpen={onOpenArtifact} /> : null}
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
          {item.body ? (
            <pre className="mt-2 max-h-44 overflow-hidden whitespace-pre-wrap text-sm leading-6 text-base-content/80">
              {item.body}
            </pre>
          ) : (
            <p className="mt-2 text-xs italic text-base-content/40">未記録</p>
          )}
        </div>
        {item.source ? <span className="badge badge-ghost shrink-0">{item.source}</span> : null}
      </div>
    </Tag>
  );
}

function DocumentRow({ docId, label, badge, text, onOpen }: { docId: string; label: string; badge: string; text: string; onOpen?: () => void }) {
  void docId;
  const Tag = onOpen ? "button" : "div";
  return (
    <Tag
      type={onOpen ? "button" : undefined}
      onClick={onOpen}
      className={`rounded-box border border-base-300 bg-base-200 p-4 text-left ${onOpen ? "cursor-pointer hover:bg-base-300/40" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="font-bold">{label}</h4>
          {text ? (
            <pre className="mt-2 max-h-32 overflow-hidden whitespace-pre-wrap text-sm leading-6 text-base-content/80">
              {text}
            </pre>
          ) : (
            <p className="mt-2 text-xs italic text-base-content/40">未記録</p>
          )}
        </div>
        <span className="badge badge-ghost shrink-0">{badge}</span>
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

function FindingsRow({ findings }: { findings: ReviewFinding[] }) {
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

function JudgementsRow({ judgements }: { judgements: JudgementEntry[] }) {
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

function ArtifactsBlock({ artifacts, onOpen }: { artifacts: ArtifactEntry[]; onOpen: (name: string) => void }) {
  return (
    <details className="rounded-box border border-base-300 bg-base-200 p-4">
      <summary className="cursor-pointer text-sm font-bold">Artifacts ({artifacts.length})</summary>
      <ul className="mt-3 grid gap-2">
        {artifacts.map((a) => (
          <li key={a.name}>
            <button
              type="button"
              className="btn btn-ghost h-auto w-full justify-between gap-3 border border-base-300 bg-base-100 py-2 text-left font-normal hover:bg-base-200"
              onClick={() => onOpen(a.name)}
            >
              <span className="truncate text-sm">{a.name}</span>
              <span className="flex items-center gap-2">
                {a.size ? <span className="badge badge-ghost badge-sm">{String(a.size)}</span> : null}
                <span className="badge badge-outline badge-sm">{artifactKind(a.name)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function preview(text: string, lines = 6) {
  return (text || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, lines)
    .join("\n");
}

function excerptByHeading(text: string, heading: string | null) {
  if (!text) return "";
  if (!heading) return preview(text);
  const lines = text.split(/\r?\n/);
  const wanted = heading.toLowerCase();
  let start = -1;
  let level = 6;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (!m) continue;
    const t = m[2].toLowerCase().trim();
    if (t === wanted || t.startsWith(wanted) || wanted.startsWith(t)) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return preview(text);
  const out: string[] = [lines[start]];
  for (let i = start + 1; i < lines.length && out.length < 14; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
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
