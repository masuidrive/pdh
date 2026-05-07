import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EventEntry, StepView } from "../lib/types";

type Props = {
  step: StepView | null;
  events?: EventEntry[];
  limit?: number;
  inline?: boolean;
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
  "aggregator_started",
  "aggregator_finished",
]);

const ACTIVITY_PREFIXES = [
  "reviewer_tool_",
  "reviewer_message",
  "reviewer_status",
  "review_repair_tool_",
  "review_repair_message",
  "review_repair_status",
  "aggregator_tool_",
  "aggregator_message",
  "aggregator_status",
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
  aggregator_started: "aggregator",
  aggregator_finished: "aggregator done",
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
  if (type.startsWith("aggregator_tool_started")) return "aggregator tool";
  if (type.startsWith("aggregator_tool_finished")) return "aggregator tool done";
  if (type.startsWith("aggregator_message") || type.startsWith("aggregator_status")) return "aggregator";
  return type || "event";
}

function truncateInline(value: string, limit = 140): string {
  if (value.length <= limit) return value;
  return value.slice(0, limit - 1) + "…";
}

export function EventsFeed({ step, events, limit = 3, inline = false }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);
  if (!step || step.progress.status !== "running" && step.progress.status !== "active") return null;
  const all = events ?? [];
  const filtered = all
    .filter((e) => isActivity(e))
    .filter((e) => !e.stepId || e.stepId === step.id)
    .map((e) => {
      const message = String(e.message ?? "").trim();
      if (!message || /claude user event/i.test(message)) return null;
      const label = activityLabel(e.type ?? e.kind ?? "");
      const provider = (e.provider ?? "").trim();
      return {
        prefix: provider ? `${provider} · ${label}` : label,
        message: truncateInline(message, inline ? 80 : 140),
        ts: e.ts ?? e.created_at,
      };
    })
    .filter((x): x is { prefix: string; message: string; ts: string | undefined } => Boolean(x));

  if (inline) {
    return <InlineLiveFeed lines={filtered.slice(-INLINE_BUFFER)} />;
  }

  const lines = filtered.slice(-limit);
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
            <li key={i} className="break-all">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-base-content/50">{formatTime(l.ts)}</span>
                <span className="badge badge-ghost badge-xs shrink-0">{l.prefix}</span>
              </div>
              <p className="mt-0.5 text-base-content/80">{l.message}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

type InlineLine = { prefix: string; message: string; ts: string | undefined };

const ROW_HEIGHT_PX = 18;
const VISIBLE_ROWS = 3;
const STEP_INTERVAL_MS = 260;
const MAX_KEEP = 100;
const INLINE_BUFFER = 100;

function lineKey(l: InlineLine) {
  return `${l.ts ?? ""}-${l.prefix}-${l.message}`;
}

function InlineLiveFeed({ lines: target }: { lines: InlineLine[] }) {
  // committed = lines actually rendered in the DOM. Last VISIBLE_ROWS are visible.
  // pendingRef = queue of lines waiting to be promoted into committed, paced one per STEP.
  // seenKeyRef = key of the latest target line we've already routed (initial mount or pending or committed).
  const [committed, setCommitted] = useState<InlineLine[]>(() => target.slice(-VISIBLE_ROWS));
  const pendingRef = useRef<InlineLine[]>([]);
  const seenKeyRef = useRef<string | null>(
    target.length ? lineKey(target[target.length - 1]) : null
  );
  const tickRef = useRef<number | null>(null);
  const ulRef = useRef<HTMLUListElement>(null);
  const initialMountRef = useRef(true);

  function scheduleTick() {
    if (tickRef.current !== null) return;
    tickRef.current = window.setTimeout(() => {
      tickRef.current = null;
      const next = pendingRef.current.shift();
      if (!next) return;
      setCommitted((prev) => [...prev, next].slice(-MAX_KEEP));
      if (pendingRef.current.length > 0) scheduleTick();
    }, STEP_INTERVAL_MS);
  }

  // Detect new arrivals in target and append to pending queue.
  useEffect(() => {
    if (target.length === 0) return;
    const lastKey = lineKey(target[target.length - 1]);
    if (lastKey === seenKeyRef.current) return;
    let newLines: InlineLine[];
    if (seenKeyRef.current) {
      const idx = target.findIndex((l) => lineKey(l) === seenKeyRef.current);
      newLines = idx >= 0 ? target.slice(idx + 1) : [target[target.length - 1]];
    } else {
      newLines = [target[target.length - 1]];
    }
    seenKeyRef.current = lastKey;
    if (newLines.length === 0) return;
    pendingRef.current.push(...newLines);
    scheduleTick();
  }, [target]);

  // Cleanup pending tick on unmount only (no per-update cleanup — that would
  // cancel the in-flight tick on every state change and stall the queue).
  useEffect(() => {
    return () => {
      if (tickRef.current !== null) {
        window.clearTimeout(tickRef.current);
        tickRef.current = null;
      }
    };
  }, []);

  // Animate the column on each committed change. The list is bottom-anchored,
  // so adding a row natively shifts all rows up by one ROW_HEIGHT_PX. We replay
  // that shift as an animation: start at translateY(+ROW) (the previous visual
  // position) and ease to translateY(0) (the new natural position).
  useLayoutEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      return;
    }
    const ul = ulRef.current;
    if (!ul) return;
    ul.animate(
      [
        { transform: `translateY(${ROW_HEIGHT_PX}px)` },
        { transform: "translateY(0)" }
      ],
      { duration: STEP_INTERVAL_MS, easing: "ease-out" }
    );
  }, [committed]);

  return (
    <div
      className="relative min-w-0 overflow-hidden"
      style={{ height: `${ROW_HEIGHT_PX * VISIBLE_ROWS}px` }}
    >
      <ul
        ref={ulRef}
        className="absolute inset-x-0 bottom-0 flex min-w-0 flex-col text-xs"
      >
        {committed.map((l) => {
          const key = lineKey(l);
          return (
            <li
              key={key}
              className="flex min-w-0 items-center gap-2"
              style={{ height: `${ROW_HEIGHT_PX}px`, lineHeight: `${ROW_HEIGHT_PX}px` }}
            >
              <span className="font-mono text-[10px] text-base-content/50 shrink-0">{formatTime(l.ts)}</span>
              <span className="badge badge-ghost badge-xs shrink-0">{l.prefix}</span>
              <span className="truncate text-base-content/80">{l.message}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatTime(iso?: string) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day ago`;
}
