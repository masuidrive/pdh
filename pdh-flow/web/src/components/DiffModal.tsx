import { useEffect, useRef, useState } from "react";
import { fetchDiff, type DiffResponse } from "../lib/api";

type Props = {
  open: boolean;
  stepId: string | null;
  onClose: () => void;
};

export function DiffModal({ open, stepId, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [payload, setPayload] = useState<DiffResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"pretty" | "raw">("pretty");

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  useEffect(() => {
    if (!open || !stepId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);
    setMode("pretty");
    (async () => {
      try {
        const body = await fetchDiff(stepId);
        if (!cancelled) setPayload(body);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, stepId]);

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <div className="modal-box w-11/12 max-w-6xl flex flex-col" style={{ maxHeight: "min(90dvh, calc(100dvh - 32px))", height: "min(90dvh, calc(100dvh - 32px))" }}>
        <div className="flex items-center justify-between gap-3 pb-2">
          <div className="min-w-0">
            <h3 className="font-bold">変更差分 · {stepId}</h3>
            {payload?.baseLabel ? <p className="text-xs text-base-content/50">base: {payload.baseLabel}{payload.baseCommit ? ` · ${payload.baseCommit.slice(0, 7)}` : ""}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <div className="join">
              <button
                type="button"
                className={`btn btn-xs join-item ${mode === "pretty" ? "btn-primary" : "btn-outline"}`}
                onClick={() => setMode("pretty")}
              >
                pretty
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

        {payload?.changedFiles?.length ? (
          <details className="rounded-box border border-base-300 bg-base-200 p-3 mb-2">
            <summary className="cursor-pointer text-sm font-bold">{payload.changedFiles.length} files</summary>
            <ul className="mt-2 grid gap-1 text-xs font-mono">
              {payload.changedFiles.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="flex-1 overflow-auto rounded-box border border-base-300 bg-base-100">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <span className="loading loading-spinner" />
            </div>
          ) : error ? (
            <div className="alert alert-error m-3">{error}</div>
          ) : payload?.patch ? (
            mode === "raw" ? (
              <pre className="p-3 text-xs leading-5 whitespace-pre-wrap break-words">{payload.patch}</pre>
            ) : (
              <DiffPretty patch={payload.patch} />
            )
          ) : (
            <p className="p-3 text-sm text-base-content/60">差分なし</p>
          )}
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}

function DiffPretty({ patch }: { patch: string }) {
  return (
    <div className="font-mono text-xs leading-5">
      {patch.split(/\r?\n/).map((line, i) => {
        const kind = classifyDiffLine(line);
        return (
          <div key={i} className={diffLineClass(kind)}>
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}

function classifyDiffLine(line: string): "hunk" | "add" | "remove" | "meta" | "context" {
  if (line.startsWith("@@")) return "hunk";
  if ((line.startsWith("+") && !line.startsWith("+++")) || line.startsWith("rename to ")) return "add";
  if ((line.startsWith("-") && !line.startsWith("---")) || line.startsWith("rename from ")) return "remove";
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("new file mode") ||
    line.startsWith("deleted file mode")
  ) {
    return "meta";
  }
  return "context";
}

function diffLineClass(kind: ReturnType<typeof classifyDiffLine>) {
  const base = "px-3";
  switch (kind) {
    case "add":
      return `${base} bg-success/15 text-success-content`;
    case "remove":
      return `${base} bg-error/15 text-error-content`;
    case "hunk":
      return `${base} bg-info/10 text-info-content font-semibold`;
    case "meta":
      return `${base} text-base-content/50 italic`;
    default:
      return `${base} text-base-content/80`;
  }
}
