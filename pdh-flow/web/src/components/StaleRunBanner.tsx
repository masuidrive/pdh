import type { RuntimeBlock, TicketEntry, AppState } from "../lib/types";

type Props = {
  state: AppState;
  onDiscard: () => void;
  onOpenTickets: () => void;
};

export function StaleRunBanner({ state, onDiscard, onOpenTickets }: Props) {
  const reason = detectStale(state);
  if (!reason) return null;
  return (
    <div className="alert alert-warning shadow-sm">
      <div>
        <h3 className="font-bold">runtime が外部変更とずれています</h3>
        <p className="text-sm">{reason}</p>
        <p className="mt-1 text-xs text-base-content/70">
          現実的な復旧は「破棄して ticket 選択に戻る」だけです。reopen は CLI でファイル復元と branch 復元が必要なので Web からは未対応 (`docs/web-ui-inventory.md` 参照)。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-error btn-sm" onClick={onDiscard}>
          破棄して ticket 選択に戻る
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onOpenTickets}>
          Tickets を開く
        </button>
      </div>
    </div>
  );
}

function detectStale(state: AppState): string | null {
  const run = state.runtime?.run;
  if (!run?.ticket_id) return null;
  if (run.status === "completed" || run.status === "canceled") return null;

  const tickets = state.tickets ?? [];
  const ticket = tickets.find((t: TicketEntry) => t.id === run.ticket_id) ?? null;

  // ticket が done / canceled に移動済み
  if (ticket && (ticket.status === "done" || ticket.status === "canceled")) {
    const where = ticket.path?.startsWith("tickets/done/") ? "tickets/done/" : ticket.path?.startsWith("tickets/canceled/") ? "tickets/canceled/" : ticket.status;
    return `ticket "${run.ticket_id}" は ${where} に移動済みなのに runtime はまだ ${run.current_step_id ?? "?"} で動いています。agent または手動で ticket.sh が実行された可能性があります。`;
  }

  // ticket そのものが見つからない (削除された)
  if (!ticket) {
    return `ticket "${run.ticket_id}" のファイルが tickets/ にも tickets/done/ にも見つかりません。runtime は ${run.current_step_id ?? "?"} で待機中。`;
  }

  // current-ticket.md / current-note.md が必要なのに無い
  const docs = state.documents ?? {};
  const noteText = docs.note?.text ?? "";
  const ticketText = docs.ticket?.text ?? "";
  const noteEmpty = !noteText.trim() || noteText.trim().split(/\r?\n/).every((l) => !l || /^#+\s/.test(l) || l === "---");
  const ticketEmpty = !ticketText.trim();
  if (ticketEmpty && noteEmpty && (run.current_step_id ?? "").startsWith("PD-C-")) {
    return `current-ticket.md と current-note.md が空 / 不在ですが、runtime はまだ ${run.current_step_id} で進行中になっています。`;
  }

  // supervisor が stale
  const supervisor = (state.runtime as RuntimeBlock | undefined)?.supervisor;
  if (supervisor?.status === "stale") {
    return `supervisor が stale 状態 (${supervisor.reason ?? "理由不明"})。プロセスは死んでいますが runtime.json は ${run.current_step_id ?? "?"} を指したままです。`;
  }

  return null;
}
