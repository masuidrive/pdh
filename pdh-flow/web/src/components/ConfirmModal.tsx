import { useEffect, useRef, useState } from "react";

export type ConfirmRequest = {
  title: string;
  body?: string;
  preview?: string;
  reasonLabel?: string;
  reasonRequired?: boolean;
  reasonPlaceholder?: string;
  confirmLabel: string;
  confirmTone?: "approve" | "warning" | "danger" | "neutral";
  cancelLabel?: string;
  onConfirm: (reason: string) => Promise<void> | void;
};

type Props = {
  request: ConfirmRequest | null;
  onClose: () => void;
};

export function ConfirmModal({ request, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (request && !dlg.open) {
      setReason("");
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
    if (request.reasonRequired && !reason.trim()) {
      setError("理由を入力してください");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await request.onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
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
        {request.reasonLabel || request.reasonRequired ? (
          <label className="form-control mt-4 w-full">
            <span className="label">
              <span className="label-text">{request.reasonLabel ?? "理由"}</span>
              {request.reasonRequired ? <span className="label-text-alt text-error">必須</span> : null}
            </span>
            <textarea
              className="textarea textarea-bordered w-full"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={request.reasonPlaceholder ?? ""}
              disabled={pending}
            />
          </label>
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
          <button
            type="button"
            className={confirmBtn}
            onClick={submit}
            disabled={pending}
          >
            {pending ? <span className="loading loading-spinner loading-xs" /> : null}
            {request.confirmLabel}
          </button>
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
      return "btn-success";
    case "warning":
      return "btn-warning";
    case "danger":
      return "btn-error";
    default:
      return "btn-primary";
  }
}
