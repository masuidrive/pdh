import { useEffect, useRef, useState } from "react";
import { useMarkdown } from "../lib/markdown";

type Props = {
  text: string;
  className?: string;
  fallbackClassName?: string;
};

// Shared markdown viewer used by NotesMarkdown / EvidencePanel etc.
//
// On top of the existing markdown-it pipeline (handled in useMarkdown,
// which also rewrites <img src=".pdh-flow/runs/..."> into the scoped
// /api/run-file endpoint), this component layers two interactions:
//   1. clicking an inline <img> opens a lightbox modal showing the
//      full-size image with the alt text as caption.
//   2. clicking outside the image (or pressing ESC, since we use the
//      native <dialog>) closes the modal.
//
// We use event delegation on the wrapper <div> rather than mounting
// React handlers per <img>, because the markdown HTML is injected via
// dangerouslySetInnerHTML — there are no React-managed children.
export function MarkdownContent({ text, className, fallbackClassName }: Props) {
  const html = useMarkdown(text);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const img = target.closest("img") as HTMLImageElement | null;
    if (!img) return;
    event.preventDefault();
    setLightbox({ src: img.src, alt: img.alt || "" });
  }

  if (html === null) {
    return (
      <pre className={fallbackClassName ?? "whitespace-pre-wrap text-xs leading-5 text-base-content/80"}>
        {text}
      </pre>
    );
  }
  return (
    <>
      <div
        className={className}
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <ImageLightbox lightbox={lightbox} onClose={() => setLightbox(null)} />
    </>
  );
}

function ImageLightbox({ lightbox, onClose }: { lightbox: { src: string; alt: string } | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (lightbox && !dlg.open) dlg.showModal();
    if (!lightbox && dlg.open) dlg.close();
  }, [lightbox]);

  // The browser fires a "close" event when the user dismisses the
  // <dialog> via ESC; mirror that into our React state so the next
  // open call works.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    const handler = () => onClose();
    dlg.addEventListener("close", handler);
    return () => dlg.removeEventListener("close", handler);
  }, [onClose]);

  return (
    <dialog ref={dialogRef} className="modal" onClick={(e) => { if (e.target === dialogRef.current) onClose(); }}>
      <div className="modal-box max-w-5xl bg-base-100">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-bold text-base">{lightbox?.alt || "image"}</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="close">×</button>
        </div>
        {lightbox ? (
          <div className="mt-3 flex justify-center">
            <img
              src={lightbox.src}
              alt={lightbox.alt}
              className="max-h-[80vh] w-auto max-w-full rounded border border-base-300 bg-base-200"
            />
          </div>
        ) : null}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="submit" aria-label="close">close</button>
      </form>
    </dialog>
  );
}
