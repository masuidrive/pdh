import { useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  variant?: string;
  onClose: () => void;
};

export function MermaidModal({ open, variant, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [svg, setSvg] = useState<string>("");
  const [code, setCode] = useState<string>("");
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
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSvg("");
    setCode("");
    setMode("render");
    (async () => {
      try {
        const url = `/api/flow.mmd${variant ? `?variant=${encodeURIComponent(variant)}` : ""}`;
        const text = await (await fetch(url)).text();
        if (cancelled) return;
        setCode(text);
        const svgRes = await fetch(`/api/render-mermaid?code=${encodeURIComponent(text)}`);
        if (!svgRes.ok) throw new Error(`render-mermaid ${svgRes.status}`);
        const svgText = await svgRes.text();
        if (!cancelled) setSvg(svgText);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, variant]);

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <div className="modal-box w-11/12 max-w-6xl flex flex-col" style={{ maxHeight: "min(90dvh, calc(100dvh - 32px))", height: "min(90dvh, calc(100dvh - 32px))" }}>
        <div className="flex items-center justify-between gap-3 pb-2">
          <h3 className="font-bold">Flow diagram</h3>
          <div className="flex items-center gap-2">
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
            <form method="dialog">
              <button className="btn btn-sm btn-ghost" type="submit">Close</button>
            </form>
          </div>
        </div>
        <div className="flex-1 overflow-auto rounded-box border border-base-300 bg-base-100 p-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <span className="loading loading-spinner" />
            </div>
          ) : error ? (
            <div className="alert alert-error">{error}</div>
          ) : mode === "raw" ? (
            <pre className="text-xs whitespace-pre-wrap">{code}</pre>
          ) : (
            <div className="flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />
          )}
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}
