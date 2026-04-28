import type { StepView, ProcessEntry } from "../lib/types";

type Props = {
  step: StepView | null;
  ticketId?: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  needs_human: "badge-warning",
  failed: "badge-error",
  active: "badge-info",
  done: "badge-success",
  blocked: "badge-error",
  pending: "badge-neutral",
};

export function BottomBar({ step, ticketId }: Props) {
  if (!step) return null;
  const status = step.progress.status;
  const badge = STATUS_BADGE[status] ?? "badge-neutral";
  const stepTitle = step.label;
  const elapsed = formatElapsed(step.latestAttempt?.startedAt ?? step.historyEntry?.started_at);
  const processSummary = describeProcess(step.processState?.active ?? []);
  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-base-300 bg-base-100/95 px-5 py-3 backdrop-blur">
      <div className="flex items-center justify-between gap-4 text-sm">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {ticketId ? <span className="font-medium text-base-content/80">{ticketId}</span> : null}
            <strong className="truncate">{stepTitle}</strong>
            {elapsed ? <span className="font-normal text-base-content/60">· {elapsed}</span> : null}
            <span className={`badge ${badge} badge-outline shrink-0`}>{labelForStatus(status)}</span>
          </div>
          <span className="block truncate text-base-content/60">
            <span className="font-medium text-base-content/80">Process: </span>
            {processSummary || "active provider なし"}
          </span>
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
  switch (status) {
    case "needs_human":
      return "needs_human";
    case "active":
      return "running";
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "blocked":
      return "blocked";
    case "pending":
      return "pending";
    default:
      return status;
  }
}
