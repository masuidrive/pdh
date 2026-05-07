import { useEffect, useRef, useState } from "react";
import { fetchArtifact } from "../lib/api";

type Props = {
  open: boolean;
  stepId: string | null;
  name: string | null;
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

export function ArtifactModal({ open, stepId, name, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [body, setBody] = useState<string>("");
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  useEffect(() => {
    if (!open || !stepId || !name) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBody("");
    setRenderedHtml(null);
    (async () => {
      try {
        const payload = await fetchArtifact(stepId, name);
        if (cancelled) return;
        const text = String(payload?.text ?? payload?.body ?? "");
        const isMd = name.endsWith(".md") || name.endsWith(".markdown");
        const isJson = name.endsWith(".json");
        setBody(text);
        if (isMd) {
          await loadScript("/assets/markdown-it.js");
          if (cancelled) return;
          const md = window.markdownit?.({ html: false, linkify: true });
          if (md) setRenderedHtml(md.render(text));
        } else if (isJson) {
          try {
            setBody(JSON.stringify(JSON.parse(text), null, 2));
          } catch {
            // keep raw text
          }
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
  }, [open, stepId, name]);

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <div className="modal-box w-11/12 max-w-5xl" style={{ maxHeight: "min(85dvh, calc(100dvh - 32px))" }}>
        <div className="flex items-center justify-between gap-3 pb-3">
          <div>
            <h3 className="font-bold">{name ?? ""}</h3>
            {stepId ? <p className="text-xs text-base-content/60">{stepId}</p> : null}
          </div>
          <form method="dialog">
            <button className="btn btn-sm btn-ghost" type="submit">Close</button>
          </form>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <span className="loading loading-spinner" />
          </div>
        ) : null}
        {error ? <div className="alert alert-error">{error}</div> : null}
        {!loading && !error ? (
          renderedHtml ? (
            <article
              className="evidence-md max-w-none overflow-auto rounded-box border border-base-300 bg-base-100 p-4 text-sm leading-6"
              style={{ maxHeight: "70dvh" }}
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          ) : (
            <pre
              className="overflow-auto whitespace-pre-wrap break-words rounded-box border border-base-300 bg-base-200 p-4 text-xs leading-6"
              style={{ maxHeight: "70dvh" }}
            >
              {body}
            </pre>
          )
        ) : null}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}
