import { useEffect, useRef, useState } from "react";
import { useNotifications } from "../lib/notifications";
import { useSingleFlight } from "../lib/use-single-flight";

export type ConfirmRequest = {
  title: string;
  body?: string;
  preview?: string;
  confirmLabel: string;
  confirmTone?: "approve" | "warning" | "danger" | "neutral";
  cancelLabel?: string;
  onConfirm: () => Promise<void> | void;
  // Fires once after onConfirm resolves successfully and the modal closes.
  // Used to e.g. shift focus to the new current step after a run/apply.
  onCompleted?: () => void;
  secondaryAction?: { label: string; onClick: () => void };
};

type Props = {
  request: ConfirmRequest | null;
  onClose: () => void;
};

export function ConfirmModal({ request, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flights = useSingleFlight();
  const { notifyError } = useNotifications();
  const pending = flights.isPending("confirm");

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (request && !dlg.open) {
      setError(null);
      dlg.showModal();
    } else if (!request && dlg.open) {
      dlg.close();
    }
  }, [request]);

  if (!request) {
    return (
      <dialog ref={dialogRef} className="modal" onClose={onClose}>
        <div className="modal-box" />
      </dialog>
    );
  }

  async function submit() {
    if (!request) return;
    setError(null);
    try {
      await flights.run("confirm", () => request.onConfirm());
      const completed = request.onCompleted;
      onClose();
      completed?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      notifyError(err, { title: request.title });
    }
  }

  const confirmBtn = `btn ${toneToBtn(request.confirmTone)}`;
  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <div className="modal-box max-w-2xl">
        <h3 className="font-bold text-lg">{request.title}</h3>
        {request.body ? <p className="mt-2 whitespace-pre-line text-sm text-base-content/70">{request.body}</p> : null}
        {request.preview ? (
          <pre className="mt-4 max-h-60 overflow-auto whitespace-pre-wrap rounded-box border border-base-300 bg-base-200 p-3 text-xs leading-6">
            {request.preview}
          </pre>
        ) : null}
        {error ? (
          <div className="alert alert-error mt-3 text-sm">
            <span>{error}</span>
          </div>
        ) : null}
        <div className="modal-action">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={pending}
            onClick={onClose}
          >
            {request.cancelLabel ?? "キャンセル"}
          </button>
          {request.secondaryAction && error ? (
            <button
              type="button"
              className="btn btn-neutral"
              disabled={pending}
              onClick={() => {
                request.secondaryAction!.onClick();
                onClose();
              }}
            >
              {request.secondaryAction.label}
            </button>
          ) : null}
          {error ? null : (
            <button
              type="button"
              className={confirmBtn}
              onClick={submit}
              disabled={pending}
            >
              {pending ? <span className="loading loading-spinner loading-xs" /> : null}
              {request.confirmLabel}
            </button>
          )}
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}

function toneToBtn(tone?: ConfirmRequest["confirmTone"]) {
  switch (tone) {
    case "approve":
      return "btn-success text-white";
    case "warning":
      return "btn-warning";
    case "danger":
      return "btn-error";
    default:
      return "btn-primary";
  }
}
