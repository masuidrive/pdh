import type { RuntimeBlock, TicketEntry, AppState } from "../lib/types";

type Props = {
  state: AppState;
  onDiscard: () => void;
};

export function StaleRunBanner({ state, onDiscard }: Props) {
  const reason = detectStale(state);
  if (!reason) return null;
  return (
    <section className="rounded-box border border-warning/40 bg-warning/10 p-4 shadow-sm">
      <h3 className="font-bold text-warning">flow と外部変更がずれています</h3>
      <p className="mt-1 text-sm">{reason}</p>
      <p className="mt-1 text-xs text-base-content/70">
        ticket 自体は既に決着している (close / canceled / 削除) ので、破棄するのは pdh-flow runtime 側の flow 実行状態だけです。reopen 相当はファイル復元と branch 復元が必要なので Web からは未対応 (`docs/web-ui-inventory.md` 参照)。
      </p>
      <div className="mt-3">
        <button type="button" className="btn btn-error btn-sm" onClick={onDiscard}>
          フローを破棄
        </button>
      </div>
    </section>
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
