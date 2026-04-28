import { useEffect, useRef } from "react";
import type { StepView } from "../lib/types";

type Props = {
  steps: StepView[];
  currentStepId?: string | null;
  onSelect: (stepId: string) => void;
};

const STATUS_DOT: Record<string, { btn: string; box: string; tone: string; rail: string }> = {
  done: { btn: "btn-success", box: "bg-success/10", tone: "text-success", rail: "bg-success" },
  active: { btn: "btn-primary", box: "border-primary bg-primary/10", tone: "text-primary", rail: "bg-warning" },
  needs_human: { btn: "btn-warning", box: "border-warning bg-warning/10", tone: "text-warning", rail: "bg-warning" },
  failed: { btn: "btn-error", box: "border-error bg-error/10", tone: "text-error", rail: "bg-error" },
  blocked: { btn: "btn-error", box: "bg-error/5", tone: "text-error", rail: "bg-error" },
  pending: { btn: "btn-disabled", box: "bg-base-200 text-base-content/50", tone: "", rail: "" },
};

const STATUS_ICON: Record<string, string> = {
  done: "✓",
  active: "▶",
  needs_human: "?",
  failed: "!",
  blocked: "■",
  pending: "",
};

export function Timeline({ steps, currentStepId, onSelect }: Props) {
  const activeRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentStepId]);

  return (
    <ul className="timeline timeline-vertical timeline-compact">
      {steps.map((step, i) => {
        const status = step.progress.status;
        const tone = STATUS_DOT[status] ?? STATUS_DOT.pending;
        const icon = STATUS_ICON[status] ?? "";
        const isCurrent = step.id === currentStepId;
        const prevStatus = steps[i - 1]?.progress.status ?? "";
        const prevRail = STATUS_DOT[prevStatus]?.rail ?? "";
        return (
          <li key={step.id} ref={isCurrent ? activeRef : undefined}>
            {i > 0 ? <hr className={prevRail} /> : null}
            <div className="timeline-middle">
              <button
                className={`btn btn-circle btn-sm ${tone.btn} ${isCurrent ? "ring-2 ring-offset-2 ring-offset-base-100" : ""}`}
                onClick={() => onSelect(step.id)}
                aria-current={isCurrent ? "step" : undefined}
                type="button"
              >
                {icon}
              </button>
            </div>
            <button
              type="button"
              onClick={() => onSelect(step.id)}
              className={`timeline-end timeline-box w-full text-left ${tone.box} ${isCurrent ? "ring-2 ring-base-content/20" : ""}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className={`font-bold ${tone.tone}`}>{step.label.replace(/^PD-C-\d+\s+/, "") || step.label}</span>
                <span className="text-xs font-semibold text-base-content/50">{step.id}</span>
              </div>
              {step.progress.note ? <p className="mt-1 text-xs text-base-content/60">{step.progress.note}</p> : null}
            </button>
            {i < steps.length - 1 ? <hr className={tone.rail} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
