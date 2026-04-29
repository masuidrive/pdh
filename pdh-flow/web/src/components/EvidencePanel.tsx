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
  const ready = resolveStepReady(step);
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
    !ready.length &&
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
              label={`current-ticket.md${ticketHeading ? ` > ${ticketHeading}` : ""}`}
              badge={`current-ticket.md${ticketHeading ? `#${ticketHeading}` : ""}`}
              text={excerptByHeading(docs.ticket!.text, ticketHeading)}
              onOpen={onOpenDocument ? () => onOpenDocument("ticket", ticketHeading) : undefined}
            />
          ) : null}

          {productBriefHasContent ? (
            <DocumentRow
              label="product-brief.md"
              badge="product-brief.md"
              text={preview(docs.productBrief!.text)}
              onOpen={onOpenDocument ? () => onOpenDocument("productBrief") : undefined}
            />
          ) : null}

          {epicHasContent ? (
            <DocumentRow
              label="current-epic.md"
              badge="current-epic.md"
              text={preview(docs.epic!.text)}
              onOpen={onOpenDocument ? () => onOpenDocument("epic") : undefined}
            />
          ) : null}

          {ready.length ? <ReadyRow ready={ready} /> : null}
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

function DocumentRow({ label, badge, text, onOpen }: { label: string; badge: string; text: string; onOpen?: () => void }) {
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
            <pre className="mt-2 max-h-40 overflow-hidden whitespace-pre-wrap text-sm leading-6 text-base-content/80">
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

function DiagnosticsBlock({ step, onOpenArtifact }: { step: StepView; onOpenArtifact: (name: string) => void }) {
  const gate = step.gate ?? null;
  const interruptions = step.interruptions ?? [];
  const events = step.events ?? [];
  const artifacts = step.artifacts ?? [];
  const omit = ((step.uiContract as { omit?: string[] } | undefined)?.omit) ?? [];
  const recommendation = (gate?.recommendation as { status?: string } | null | undefined) ?? null;
  const uiRuntime = (step.uiRuntime as { nextCommands?: string[]; parseErrors?: string[]; parseWarnings?: string[] } | null | undefined) ?? null;
  const nextCommands = uiRuntime?.nextCommands ?? [];
  const parseErrors = uiRuntime?.parseErrors ?? [];
  const parseWarnings = uiRuntime?.parseWarnings ?? [];

  const hasState = Boolean(gate?.status === "needs_human") || (recommendation?.status === "pending") || interruptions.length > 0;
  const hasLogs = events.length > 0;
  const hasArtifacts = artifacts.length > 0;
  const hasOmit = omit.length > 0;
  const hasNextCommands = nextCommands.length > 0;
  const hasParse = parseErrors.length > 0 || parseWarnings.length > 0;

  if (!hasState && !hasLogs && !hasArtifacts && !hasOmit && !hasNextCommands && !hasParse) return null;

  const subParts: string[] = [];
  if (hasState) subParts.push("state");
  if (hasLogs) subParts.push(`logs ${events.length}`);
  if (hasArtifacts) subParts.push(`artifacts ${artifacts.length}`);
  if (hasNextCommands) subParts.push(`commands ${nextCommands.length}`);
  if (hasParse) subParts.push(`parse ${parseErrors.length + parseWarnings.length}`);
  if (hasOmit) subParts.push(`omit ${omit.length}`);

  return (
    <details className="rounded-box border border-base-300 bg-base-200 p-4">
      <summary className="flex cursor-pointer items-center justify-between gap-3">
        <span className="font-bold">Diagnostics</span>
        <span className="text-xs text-base-content/60">{subParts.join(" · ")}</span>
      </summary>
      <div className="mt-3 grid gap-3">
        {hasState ? <CurrentStateSection gate={gate} recommendation={recommendation} interruptions={interruptions} /> : null}
        {hasNextCommands ? <NextCommandsSection commands={nextCommands} /> : null}
        {hasLogs ? <LogsSection events={events} /> : null}
        {hasParse ? <ParseSection errors={parseErrors} warnings={parseWarnings} /> : null}
        {hasArtifacts ? <ArtifactsSection artifacts={artifacts} onOpen={onOpenArtifact} /> : null}
        {hasOmit ? <OmitSection items={omit} /> : null}
      </div>
    </details>
  );
}

function NextCommandsSection({ commands }: { commands: string[] }) {
  return (
    <Section title="次に runtime が叩くコマンド">
      <pre className="overflow-x-auto rounded-box border border-base-300 bg-base-100 p-2 text-xs leading-5">{commands.join("\n")}</pre>
    </Section>
  );
}

function ParseSection({ errors, warnings }: { errors: string[]; warnings: string[] }) {
  return (
    <Section title="Parse">
      {errors.length ? (
        <ul className="text-xs text-error">
          {errors.map((e, i) => (
            <li key={`e-${i}`}>error: {e}</li>
          ))}
        </ul>
      ) : null}
      {warnings.length ? (
        <ul className="text-xs text-warning">
          {warnings.map((w, i) => (
            <li key={`w-${i}`}>warn: {w}</li>
          ))}
        </ul>
      ) : null}
    </Section>
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

function CurrentStateSection({
  gate,
  recommendation,
  interruptions,
}: {
  gate: StepView["gate"] | null;
  recommendation: { status?: string } | null;
  interruptions: { kind: string; message?: string; status?: string }[];
}) {
  return (
    <Section title="Current State">
      {gate?.status === "needs_human" ? (
        <Pill name="human gate" sub={gate.decision ?? gate.status ?? ""} />
      ) : null}
      {recommendation?.status === "pending" ? (
        <Pill name="agent recommendation" sub="pending" />
      ) : null}
      {interruptions.map((it, i) => (
        <Pill key={i} name={it.message ?? it.kind ?? "interruption"} sub={it.status ?? it.kind ?? "open"} />
      ))}
    </Section>
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

function OmitSection({ items }: { items: string[] }) {
  return (
    <Section title="Omitted From Main View">
      <ul className="flex flex-wrap gap-1.5 text-xs">
        {items.map((item) => (
          <li key={item}>
            <span className="badge badge-ghost badge-sm">{item}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Pill({ name, sub }: { name: string; sub: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-base-300/50 bg-base-100 px-2 py-1 text-sm">
      <span className="break-all">{name}</span>
      {sub ? <span className="badge badge-ghost badge-sm">{sub}</span> : null}
    </div>
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
  if (stepId === "PD-C-10" || stepId === "PD-C-8" || stepId === "PD-C-9") return "Product AC";
  return "Implementation Notes";
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
