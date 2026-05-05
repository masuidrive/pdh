import type { ArtifactEntry, NextAction, StepView, HistoryEntry, JudgementEntry, ReviewFinding } from "../lib/types";
import { resolveStepEvidence, type EvidenceItem, type EvidenceKind } from "../lib/evidence-resolver";
import { useMarkdown } from "../lib/markdown";

declare global {
  interface Window {
    markdownit?: (options?: Record<string, unknown>) => { render: (input: string) => string };
  }
}

function MarkdownBody({ text }: { text: string }) {
  const html = useMarkdown(text);
  if (html === null) {
    return (
      <pre className="mt-2 w-full whitespace-pre-wrap break-words text-sm leading-6 text-base-content/60">
        {text}
      </pre>
    );
  }
  return (
    <div
      className="evidence-md mt-2 w-full break-words text-sm leading-6 text-base-content/85"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

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

const NOTE_HEADINGS_BY_STEP: Record<string, string[]> = {
  "PD-C-2": ["PD-C-2. 調査結果"],
  "PD-C-3": ["PD-C-3. 計画"],
  "PD-C-4": ["PD-C-4. 計画レビュー結果", "PD-C-3. 計画"],
  "PD-C-5": ["PD-C-3. 計画", "PD-C-4. 計画レビュー結果"],
  "PD-C-6": ["PD-C-6. 実装"],
  "PD-C-7": ["PD-C-7. 品質検証結果", "PD-C-6. 実装"],
  "PD-C-8": ["PD-C-8. 目的妥当性確認", "AC 裏取り結果"],
  "PD-C-9": ["PD-C-9. AC 裏取り結果", "AC 裏取り結果"],
  "PD-C-10": ["PD-C-9. AC 裏取り結果", "PD-C-8. 目的妥当性確認", "PD-C-7. 品質検証結果"],
};

export function EvidencePanel({ step, next, allSteps, history, documents, onOpenArtifact, onOpenDiff, onOpenDocument }: Props) {
  const resolved = resolveStepEvidence(step, next ?? null, { allSteps, history: history ?? [] });
  // risks are surfaced by UiOutputCard at the top of the page; we deliberately
  // skip rendering them here to avoid duplicating the same data in two places.
  const artifacts = step.artifacts ?? [];
  const findings = step.reviewFindings ?? [];
  const judgements = step.judgements ?? [];
  const docs = documents ?? {};
  void next;

  // diff item is the only mustShow row we render full inline
  const diffItem = resolved.find((it) => it.kind === "diff");

  const noteSection = step.noteSection ?? "";
  const noteText = docs.note?.text ?? "";
  const noteHeadings = NOTE_HEADINGS_BY_STEP[step.id] ?? [];
  const ticketHeading = defaultTicketHeading(step.id);

  const noteHasContent = hasMeaningfulContent(docs.note?.text);
  const ticketHasContent = hasMeaningfulContent(docs.ticket?.text);
  const productBriefHasContent = hasMeaningfulContent(docs.productBrief?.text);
  const epicHasContent = hasMeaningfulContent(docs.epic?.text);

  const showSection =
    !diffItem &&
    !noteHasContent &&
    !ticketHasContent &&
    !productBriefHasContent &&
    !epicHasContent &&
    !artifacts.length &&
    !findings.length &&
    !judgements.length;
  if (showSection) {
    return null;
  }

  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body">
        <h3 className="card-title">判断材料</h3>
        <div className="grid gap-3">
          {diffItem ? (
            <ContractRow item={diffItem} onOpenDiff={onOpenDiff && diffItem.diffStepId ? () => onOpenDiff(diffItem.diffStepId!) : undefined} />
          ) : null}

          {noteHasContent
            ? renderNoteRows(noteText, noteSection, noteHeadings, onOpenDocument)
            : null}

          {ticketHasContent ? (
            <DocumentRow
              label={`current-ticket.md${ticketHeading ? ` > ${ticketHeading}` : " (全文)"}`}
              badge={`current-ticket.md${ticketHeading ? `#${ticketHeading}` : ""}`}
              text={excerptByHeading(docs.ticket!.text, ticketHeading)}
              onOpen={onOpenDocument ? () => onOpenDocument("ticket", ticketHeading) : undefined}
            />
          ) : null}

          {productBriefHasContent ? (
            <CollapsedDocumentRow
              label="product-brief.md"
              onOpen={onOpenDocument ? () => onOpenDocument("productBrief") : undefined}
            />
          ) : null}

          {epicHasContent ? (
            <CollapsedDocumentRow
              label="current-epic.md"
              onOpen={onOpenDocument ? () => onOpenDocument("epic") : undefined}
            />
          ) : null}

          {findings.length ? <FindingsRow findings={findings} /> : null}
          {judgements.length ? <JudgementsRow judgements={judgements} /> : null}

          <DiagnosticsBlock step={step} onOpenArtifact={onOpenArtifact} />
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
      className={`block w-full rounded-box border border-base-300 bg-base-200 p-4 text-left ${onClick ? "cursor-pointer hover:bg-base-300/40" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h4 className="font-bold">{item.label}</h4>
          <span className={`badge badge-${tone} badge-sm`}>{KIND_LABELS[item.kind]}</span>
        </div>
        {item.source ? <span className="badge badge-ghost shrink-0">{item.source}</span> : null}
      </div>
      {item.body ? (
        <pre className="mt-2 w-full whitespace-pre-wrap break-words text-sm leading-6 text-base-content/80">
          {item.body}
        </pre>
      ) : (
        <p className="mt-2 text-xs italic text-base-content/40">未記録</p>
      )}
    </Tag>
  );
}

function DocumentRow({ label, text, onOpen }: { label: string; badge?: string; text: string; onOpen?: () => void }) {
  const Tag = onOpen ? "button" : "div";
  return (
    <Tag
      type={onOpen ? "button" : undefined}
      onClick={onOpen}
      className={`block w-full rounded-box border border-base-300 bg-base-200 p-4 text-left ${onOpen ? "cursor-pointer hover:bg-base-300/40" : ""}`}
    >
      <h4 className="font-bold">{label}</h4>
      {text ? (
        <MarkdownBody text={text} />
      ) : (
        <p className="mt-2 text-xs italic text-base-content/40">未記録</p>
      )}
    </Tag>
  );
}

function CollapsedDocumentRow({ label, onOpen }: { label: string; onOpen?: () => void }) {
  const Tag = onOpen ? "button" : "div";
  return (
    <Tag
      type={onOpen ? "button" : undefined}
      onClick={onOpen}
      className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-box border border-base-300 bg-base-200 p-3 text-left ${onOpen ? "cursor-pointer hover:bg-base-300/40" : ""}`}
    >
      <h4 className="font-bold">{label}</h4>
      <span className="text-xs text-base-content/50">クリックで全文</span>
    </Tag>
  );
}

function renderNoteRows(
  noteText: string,
  noteSection: string,
  headings: string[],
  onOpenDocument?: (docId: string, heading?: string | null) => void
) {
  if (!headings.length) return null;
  return (
    <>
      {headings.map((heading, i) => {
        const excerpt = excerptByHeading(noteText, heading) || (i === 0 ? noteSection : "");
        return (
          <DocumentRow
            key={heading}
            label={`current-note.md > ${heading}`}
            badge={`current-note.md#${heading}`}
            text={excerpt}
            onOpen={onOpenDocument ? () => onOpenDocument("note", heading) : undefined}
          />
        );
      })}
    </>
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

function DiagnosticsBlock({ step, onOpenArtifact }: { step: StepView; onOpenArtifact: (name: string) => void }) {
  const events = step.events ?? [];
  const artifacts = step.artifacts ?? [];

  const hasLogs = events.length > 0;
  const hasArtifacts = artifacts.length > 0;

  if (!hasLogs && !hasArtifacts) return null;

  const subParts: string[] = [];
  if (hasLogs) subParts.push(`logs ${events.length}`);
  if (hasArtifacts) subParts.push(`artifacts ${artifacts.length}`);

  return (
    <details className="rounded-box border border-base-300 bg-base-200 p-4">
      <summary className="flex cursor-pointer items-center justify-between gap-3">
        <span className="font-bold">Diagnostics</span>
        <span className="text-xs text-base-content/60">{subParts.join(" · ")}</span>
      </summary>
      <div className="mt-3 grid gap-3">
        {hasLogs ? <LogsSection events={events} /> : null}
        {hasArtifacts ? <ArtifactsSection artifacts={artifacts} onOpen={onOpenArtifact} /> : null}
      </div>
    </details>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h5 className="text-xs uppercase tracking-wide text-base-content/50">{title}</h5>
      <div className="mt-1.5 grid gap-1">{children}</div>
    </section>
  );
}

function LogsSection({ events }: { events: NonNullable<StepView["events"]> }) {
  const recent = events.slice(-12);
  return (
    <Section title="Logs">
      <ul className="grid gap-1 text-xs">
        {recent.map((event, i) => {
          const ts = (event.ts ?? event.created_at ?? "").replace("T", " ").replace("Z", "");
          const actor = (event.provider ?? "runtime").toUpperCase();
          const highlight =
            event.type === "interrupted" || event.type === "guard_failed" || event.type === "human_gate_resolved";
          const provider = event.provider ?? "runtime";
          return (
            <li
              key={(event as { id?: string }).id ?? `${ts}-${i}`}
              className={`grid grid-cols-[max-content_max-content_1fr] gap-2 rounded border px-2 py-1 ${highlight ? "border-warning/40 bg-warning/10" : "border-base-300/50 bg-base-100"}`}
            >
              <span className="font-mono text-[10px] text-base-content/40">{ts || "—"}</span>
              <span className={`badge badge-sm ${actorBadge(provider)}`}>{actor}</span>
              <span className="break-all">{event.message ?? event.type ?? "—"}</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function ArtifactsSection({ artifacts, onOpen }: { artifacts: ArtifactEntry[]; onOpen: (name: string) => void }) {
  return (
    <Section title="Artifacts">
      <ul className="grid gap-2">
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
    </Section>
  );
}

function actorBadge(provider: string) {
  switch (provider) {
    case "runtime":
      return "badge-info";
    case "claude":
      return "badge-primary";
    case "codex":
      return "badge-warning";
    default:
      return "badge-ghost";
  }
}


function hasMeaningfulContent(text: string | undefined) {
  if (!text) return false;
  const stripped = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^#+\s/.test(l) && l !== "---")
    .join("\n");
  return stripped.length > 0;
}

function preview(text: string, lines = 6) {
  return (text || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, lines)
    .join("\n");
}

function defaultTicketHeading(stepId: string) {
  // PD-C-1 may rewrite any part of the ticket (AC reorganization,
  // process-vs-function split, real-env-required tagging), so the
  // gate viewer needs the full ticket text — not just one section.
  if (stepId === "PD-C-1") return null;
  if (stepId === "PD-C-10" || stepId === "PD-C-8" || stepId === "PD-C-9") return "Product AC";
  return "Implementation Notes";
}

function excerptByHeading(text: string, heading: string | null) {
  if (!text) return "";
  if (!heading) return text;
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
  // Skip the heading line itself — the row already shows the heading in its title/badge
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
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

