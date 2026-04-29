import type { RuntimeBlock, TicketEntry } from "../lib/types";

type Props = {
  runtime?: RuntimeBlock | null;
  tickets?: TicketEntry[];
  onApprove: () => void;
  onStop: () => void;
  onOpenTickets: () => void;
};

export function StaleRunBanner({ runtime, tickets, onApprove, onStop, onOpenTickets }: Props) {
  const run = runtime?.run;
  if (!run?.ticket_id) return null;
  const ticket = tickets?.find((t) => t.id === run.ticket_id);
  const ticketClosed = ticket && (ticket.status === "done" || ticket.status === "canceled");
  const runActive = run.status !== "completed" && run.status !== "canceled";
  if (!ticketClosed || !runActive) return null;

  const stuckAtClose = run.current_step_id === "PD-C-10";
  return (
    <div className="alert alert-info shadow-sm">
      <div>
        <h3 className="font-bold">
          ticket は {ticket.status === "done" ? "close 済み" : "canceled"}
        </h3>
        <p className="text-sm">
          {ticket.path ? `${ticket.path} に移動済みです。` : null}
          {stuckAtClose
            ? " runtime はまだ PD-C-10 待ちなので、Approve で完了させるか Stop で破棄してください。"
            : " runtime は古い状態のままです。新しい ticket を開始するか Stop で片付けてください。"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {stuckAtClose ? (
          <button type="button" className="btn btn-success btn-sm" onClick={onApprove}>
            Approve close
          </button>
        ) : null}
        <button type="button" className="btn btn-error btn-sm" onClick={onStop}>
          Stop runtime
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onOpenTickets}>
          別の ticket を選ぶ
        </button>
      </div>
    </div>
  );
}
