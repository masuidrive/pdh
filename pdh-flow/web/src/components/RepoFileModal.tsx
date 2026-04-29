import { useEffect, useRef, useState } from "react";
import { fetchRepoFile } from "../lib/api";

type Props = {
  open: boolean;
  stepId: string | null;
  path: string | null;
  onClose: () => void;
};

declare global {
  interface Window {
    markdownit?: (options?: Record<string, unknown>) => { render: (input: string) => string };
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.dataset.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
}

export function RepoFileModal({ open, stepId, path, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [body, setBody] = useState("");
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"render" | "raw">("render");

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  useEffect(() => {
    if (!open || !stepId || !path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBody("");
    setRenderedHtml(null);
    setMode("render");
    (async () => {
      try {
        const payload = (await fetchRepoFile(stepId, path)) as { text?: string; body?: string };
        if (cancelled) return;
        const text = String(payload?.text ?? payload?.body ?? "");
        setBody(text);
        if (path.endsWith(".md") || path.endsWith(".markdown")) {
          await loadScript("/assets/markdown-it.js");
          if (cancelled) return;
          const md = window.markdownit?.({ html: false, linkify: true });
          if (md) setRenderedHtml(md.render(text));
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, stepId, path]);

  const isMarkdown = path?.endsWith(".md") || path?.endsWith(".markdown");

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <div className="modal-box w-11/12 max-w-5xl flex flex-col" style={{ maxHeight: "min(85dvh, calc(100dvh - 32px))", height: "min(85dvh, calc(100dvh - 32px))" }}>
        <div className="flex items-center justify-between gap-3 pb-2">
          <div className="min-w-0">
            <h3 className="font-bold truncate">{path ?? ""}</h3>
            {stepId ? <p className="text-xs text-base-content/50">{stepId}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {isMarkdown ? (
              <div className="join">
                <button
                  type="button"
                  className={`btn btn-xs join-item ${mode === "render" ? "btn-primary" : "btn-outline"}`}
                  onClick={() => setMode("render")}
                >
                  render
                </button>
                <button
                  type="button"
                  className={`btn btn-xs join-item ${mode === "raw" ? "btn-primary" : "btn-outline"}`}
                  onClick={() => setMode("raw")}
                >
                  raw
                </button>
              </div>
            ) : null}
            <form method="dialog">
              <button className="btn btn-sm btn-ghost" type="submit">Close</button>
            </form>
          </div>
        </div>
        <div className="flex-1 overflow-auto rounded-box border border-base-300 bg-base-100">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <span className="loading loading-spinner" />
            </div>
          ) : error ? (
            <div className="alert alert-error m-3">{error}</div>
          ) : isMarkdown && mode === "render" && renderedHtml ? (
            <article
              className="evidence-md max-w-none p-4 text-sm leading-6"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          ) : (
            <pre className="p-3 text-xs leading-5 whitespace-pre-wrap break-words">{body}</pre>
          )}
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}
