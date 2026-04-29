import type { EventEntry, StepView } from "../lib/types";

type Props = {
  step: StepView | null;
  events?: EventEntry[];
  limit?: number;
};

const ACTIVITY_TYPES = new Set([
  "message",
  "tool_started",
  "tool_finished",
  "file_changed",
  "run_failed",
  "reviewer_started",
  "reviewer_finished",
  "review_repair_started",
  "review_repair_finished",
]);

const ACTIVITY_PREFIXES = [
  "reviewer_tool_",
  "reviewer_message",
  "reviewer_status",
  "review_repair_tool_",
  "review_repair_message",
  "review_repair_status",
];

const LABEL_BY_TYPE: Record<string, string> = {
  tool_started: "tool",
  tool_finished: "tool done",
  message: "message",
  file_changed: "file",
  run_failed: "error",
  reviewer_started: "reviewer",
  reviewer_finished: "reviewer done",
  review_repair_started: "repair",
  review_repair_finished: "repair done",
};

function isActivity(event: EventEntry): boolean {
  const t = event.type ?? event.kind ?? "";
  if (ACTIVITY_TYPES.has(t)) return true;
  return ACTIVITY_PREFIXES.some((p) => t.startsWith(p));
}

function activityLabel(type: string): string {
  if (LABEL_BY_TYPE[type]) return LABEL_BY_TYPE[type];
  if (type.startsWith("reviewer_tool_started")) return "reviewer tool";
  if (type.startsWith("reviewer_tool_finished")) return "reviewer tool done";
  if (type.startsWith("reviewer_message") || type.startsWith("reviewer_status")) return "reviewer";
  if (type.startsWith("review_repair_tool_started")) return "repair tool";
  if (type.startsWith("review_repair_tool_finished")) return "repair tool done";
  if (type.startsWith("review_repair_message") || type.startsWith("review_repair_status")) return "repair";
  return type || "event";
}

function truncateInline(value: string, limit = 140): string {
  if (value.length <= limit) return value;
  return value.slice(0, limit - 1) + "…";
}

export function EventsFeed({ step, events, limit = 3 }: Props) {
  if (!step || step.progress.status !== "running" && step.progress.status !== "active") return null;
  const all = events ?? [];
  const lines = all
    .filter((e) => isActivity(e))
    .filter((e) => !e.stepId || e.stepId === step.id)
    .map((e) => {
      const message = String(e.message ?? "").trim();
      if (!message || /claude user event/i.test(message)) return null;
      const label = activityLabel(e.type ?? e.kind ?? "");
      const provider = (e.provider ?? "").trim();
      return {
        prefix: provider ? `${provider} · ${label}` : label,
        message: truncateInline(message, 140),
        ts: e.ts ?? e.created_at,
      };
    })
    .filter((x): x is { prefix: string; message: string; ts: string | undefined } => Boolean(x))
    .slice(-limit);

  if (!lines.length) return null;

  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body">
        <div className="flex items-center gap-2">
          <h3 className="card-title text-base">Live</h3>
          <span className="badge badge-info badge-sm animate-pulse">running</span>
        </div>
        <ul className="space-y-1.5 text-xs">
          {lines.map((l, i) => (
            <li key={i} className="flex items-baseline gap-2 break-all">
              <span className="font-mono text-base-content/50">{formatTime(l.ts)}</span>
              <span className="badge badge-ghost badge-xs shrink-0">{l.prefix}</span>
              <span className="text-base-content/80">{l.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function formatTime(iso?: string) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  return d.toLocaleTimeString();
}
