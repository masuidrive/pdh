import { useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  docId: string | null;
  heading: string | null;
  text: string;
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

export function DocumentModal({ open, docId, heading, text, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [mode, setMode] = useState<"render" | "raw">("render");

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRenderedHtml(null);
    setMode("render");
    (async () => {
      await loadScript("/assets/markdown-it.js");
      if (cancelled) return;
      const md = window.markdownit?.({ html: false, linkify: true });
      if (md) setRenderedHtml(md.render(text || ""));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, text]);

  useEffect(() => {
    if (!open || !heading || mode !== "render" || !articleRef.current) return;
    const target = findHeading(articleRef.current, heading);
    if (target) {
      target.scrollIntoView({ block: "start", behavior: "smooth" });
      target.classList.add("ring-2", "ring-warning", "ring-offset-2", "rounded-md");
      const id = setTimeout(() => target.classList.remove("ring-2", "ring-warning", "ring-offset-2", "rounded-md"), 1800);
      return () => clearTimeout(id);
    }
  }, [open, heading, mode, renderedHtml]);

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <div className="modal-box w-11/12 max-w-5xl flex flex-col" style={{ maxHeight: "min(85dvh, calc(100dvh - 32px))", height: "min(85dvh, calc(100dvh - 32px))" }}>
        <div className="flex items-center justify-between gap-3 pb-2">
          <div className="min-w-0">
            <h3 className="font-bold">{docLabel(docId)}</h3>
            {heading ? <p className="text-xs text-base-content/50">#{heading}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <div className="join">
              <button type="button" className={`btn btn-xs join-item ${mode === "render" ? "btn-primary" : "btn-outline"}`} onClick={() => setMode("render")}>render</button>
              <button type="button" className={`btn btn-xs join-item ${mode === "raw" ? "btn-primary" : "btn-outline"}`} onClick={() => setMode("raw")}>raw</button>
            </div>
            <form method="dialog">
              <button className="btn btn-sm btn-ghost" type="submit">Close</button>
            </form>
          </div>
        </div>
        <div className="flex-1 overflow-auto rounded-box border border-base-300 bg-base-100">
          {mode === "render" && renderedHtml ? (
            <article
              ref={articleRef}
              className="evidence-md max-w-none p-4 text-sm leading-6"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          ) : (
            <pre className="p-3 text-xs leading-5 whitespace-pre-wrap break-words">{text}</pre>
          )}
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}

function docLabel(docId: string | null) {
  switch (docId) {
    case "note":
      return "current-note.md";
    case "ticket":
      return "current-ticket.md";
    case "productBrief":
      return "product-brief.md";
    case "epic":
      return "current-epic.md";
    default:
      return docId ?? "document";
  }
}

function findHeading(root: HTMLElement, heading: string) {
  const wanted = heading.toLowerCase().trim();
  const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6")) as HTMLElement[];
  return headings.find((el) => {
    const t = (el.textContent ?? "").toLowerCase().trim();
    return t === wanted || t.startsWith(wanted) || wanted.startsWith(t);
  });
}
