import type { StepView, ProcessEntry, EventEntry } from "../lib/types";
import { EventsFeed } from "./EventsFeed";

type Props = {
  step: StepView | null;
  ticketId?: string | null;
  events?: EventEntry[];
  onJumpToCurrent?: () => void;
};

const STATUS_BADGE: Record<string, string> = {
  needs_human: "badge-warning",
  waiting: "badge-warning",
  failed: "badge-error",
  active: "badge-info",
  running: "badge-info",
  done: "badge-success",
  completed: "badge-success",
  blocked: "badge-error",
  interrupted: "badge-warning",
  pending: "badge-neutral",
};

export function BottomBar({ step, ticketId, events, onJumpToCurrent }: Props) {
  if (!step) return null;
  const status = step.progress.status;
  const badge = STATUS_BADGE[status] ?? "badge-neutral";
  const stepTitle = step.label;
  const elapsed = formatElapsed(step.latestAttempt?.startedAt ?? step.historyEntry?.started_at);
  const processSummary = describeProcess(step.processState?.active ?? []);
  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-base-300 bg-base-100/60 px-5 py-2 backdrop-blur-md">
      <div className="flex items-start gap-4 text-sm">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <button
            type="button"
            className="flex min-w-0 flex-wrap items-center gap-2 rounded text-left hover:bg-base-200/60 disabled:cursor-default disabled:hover:bg-transparent"
            onClick={onJumpToCurrent}
            disabled={!onJumpToCurrent}
            title={onJumpToCurrent ? "現在のステップに移動" : undefined}
          >
            {ticketId ? <span className="font-medium text-base-content/80 shrink-0">{ticketId}</span> : null}
            <strong className="truncate">{stepTitle}</strong>
            {elapsed ? <span className="font-normal text-base-content/60 shrink-0">· {elapsed}</span> : null}
            <span className={`badge ${badge} badge-outline badge-sm shrink-0`}>{labelForStatus(status)}</span>
          </button>
          <span className="truncate text-xs text-base-content/60">
            <span className="font-medium text-base-content/80">Process: </span>
            {processSummary || "active provider なし"}
          </span>
        </div>
        <div className="hidden min-w-0 flex-1 sm:block">
          <EventsFeed step={step} events={events} inline limit={3} />
        </div>
      </div>
    </footer>
  );
}

function describeProcess(active: ProcessEntry[]) {
  if (!active.length) return "";
  const groups = new Map<string, { count: number; longest: number }>();
  const now = Date.now();
  for (const e of active) {
    const key = e.kind ?? "unknown";
    const startedMs = e.startedAt ? Date.parse(e.startedAt) : now;
    const elapsed = Math.max(0, Math.floor((now - startedMs) / 1000));
    const slot = groups.get(key) ?? { count: 0, longest: 0 };
    slot.count += 1;
    slot.longest = Math.max(slot.longest, elapsed);
    groups.set(key, slot);
  }
  return Array.from(groups.entries())
    .map(([kind, slot]) => `${kindLabel(kind)}${slot.count > 1 ? ` ×${slot.count}` : ""} (${formatSeconds(slot.longest)})`)
    .join(", ");
}

function kindLabel(kind: string) {
  switch (kind) {
    case "reviewer":
      return "reviewer";
    case "aggregator":
      return "aggregator";
    case "repair":
      return "repair";
    case "provider":
      return "provider";
    default:
      return kind;
  }
}

function formatSeconds(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function formatElapsed(iso?: string) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return formatSeconds(Math.max(0, Math.floor((Date.now() - t) / 1000)));
}

function labelForStatus(status: string) {
  return status;
}
