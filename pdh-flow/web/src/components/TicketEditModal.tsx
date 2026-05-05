import { useEffect, useState } from "react";
import { actions } from "../lib/api";
import { useNotifications } from "../lib/notifications";
import { useSingleFlight } from "../lib/use-single-flight";

type Props = {
  open: boolean;
  ticketId: string | null;
  onClose: () => void;
  onSaved?: () => void;
};

export function TicketEditModal({ open, ticketId, onClose, onSaved }: Props) {
  const [content, setContent] = useState("");
  const [path, setPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const flights = useSingleFlight();
  const { notify, notifyError } = useNotifications();

  useEffect(() => {
    if (!open || !ticketId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDirty(false);
    setContent("");
    setPath(null);
    (async () => {
      try {
        const result = await actions.readTicket(ticketId);
        if (cancelled) return;
        setContent(result.content);
        setPath(result.path);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, ticketId]);

  async function handleSave() {
    if (!ticketId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await flights.run(`ticket-save:${ticketId}`, () => actions.updateTicket(ticketId, content));
      setDirty(false);
      notify({
        tone: "success",
        title: "チケットを保存しました",
        message: ticketId,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      notifyError(err, { title: "チケット保存に失敗しました" });
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    if (dirty && !window.confirm("変更を破棄して閉じますか?")) return;
    onClose();
  }

  if (!open) return null;

  return (
    <div className="modal modal-open" role="dialog" aria-modal="true">
      <div className="modal-box w-11/12 max-w-4xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold">チケット編集</h3>
            {ticketId ? <p className="font-mono text-xs text-base-content/60 break-all">{path ?? `tickets/${ticketId}.md`}</p> : null}
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={handleClose} disabled={saving}>
            ×
          </button>
        </div>

        {loading ? (
          <div className="my-6 flex items-center gap-2 text-sm text-base-content/60">
            <span className="loading loading-spinner loading-sm"></span>
            読み込み中…
          </div>
        ) : (
          <>
            <textarea
              className="textarea textarea-bordered mt-3 w-full font-mono text-xs leading-5"
              rows={22}
              value={content}
              onChange={(e) => { setContent(e.target.value); setDirty(true); }}
              spellCheck={false}
              disabled={saving}
            />
            <p className="mt-2 text-xs text-base-content/60">
              フロントマターも含めて編集可能。frontmatter の <code>started_at</code> / <code>closed_at</code> は runtime が管理するので手で書き換えると整合性が崩れる可能性があります。
            </p>
          </>
        )}

        {error ? <p className="mt-3 whitespace-pre-line text-xs text-error">{error}</p> : null}

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={handleClose} disabled={saving}>
            キャンセル
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={loading || saving || !dirty}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
