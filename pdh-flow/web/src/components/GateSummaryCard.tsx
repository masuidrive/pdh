import { useEffect, useRef, useState } from "react";
import type { GateView } from "../lib/types";

declare global {
  interface Window {
    markdownit?: (options?: Record<string, unknown>) => { render: (input: string) => string };
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) return resolve();
    const el = document.createElement("script");
    el.src = src;
    el.dataset.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
}

type Props = {
  gate: GateView;
  defaultOpen?: boolean;
};

export function GateSummaryCard({ gate, defaultOpen = true }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const text = gate.summaryText ?? "";
  const recText = gate.recommendationText ?? "";

  useEffect(() => {
    if (!text) {
      setHtml("");
      return;
    }
    let cancelled = false;
    (async () => {
      await loadScript("/assets/markdown-it.js");
      if (cancelled) return;
      const md = window.markdownit?.({ html: false, linkify: true });
      if (md) setHtml(md.render(text));
    })();
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!text && !recText && !gate.decision) return null;

  return (
    <details
      className="rounded-box border border-warning/40 bg-warning/5 shadow-sm"
      open={defaultOpen}
    >
      <summary className="cursor-pointer list-none px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-warning">Gate summary</span>
          {gate.status ? <span className="badge badge-warning badge-sm">{gate.status}</span> : null}
          {gate.baseline?.commit ? (
            <span className="badge badge-ghost badge-sm font-mono">
              base {gate.baseline.commit.slice(0, 7)}
              {gate.baseline.step_id ? ` · ${gate.baseline.step_id}` : ""}
            </span>
          ) : null}
          {gate.decision ? <span className="badge badge-info badge-sm">decision: {gate.decision}</span> : null}
          <span className="ml-auto text-xs text-base-content/50">クリックで折り畳み</span>
        </div>
      </summary>

      <div className="space-y-3 px-4 pb-4">
        {gate.rerun_requirement?.target_step_id ? (
          <div className="alert alert-warning text-sm">
            <div>
              <p className="font-semibold">rerun required → {gate.rerun_requirement.target_step_id}</p>
              {gate.rerun_requirement.reason ? <p>{gate.rerun_requirement.reason}</p> : null}
              {gate.rerun_requirement.changed_ticket_sections?.length ? (
                <p className="text-xs">ticket sections: {gate.rerun_requirement.changed_ticket_sections.join(", ")}</p>
              ) : null}
              {gate.rerun_requirement.changed_note_sections?.length ? (
                <p className="text-xs">note sections: {gate.rerun_requirement.changed_note_sections.join(", ")}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {recText ? (
          <div className="rounded-box border border-base-300 bg-base-100 p-3">
            <p className="text-xs uppercase tracking-wide text-base-content/50">recommendation</p>
            <pre className="mt-1 whitespace-pre-wrap text-sm">{recText}</pre>
          </div>
        ) : null}

        {html ? (
          <article
            ref={articleRef}
            className="prose prose-sm max-w-none rounded-box border border-base-300 bg-base-100 p-4"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : null}
      </div>
    </details>
  );
}
