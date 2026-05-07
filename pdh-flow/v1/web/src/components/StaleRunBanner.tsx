import type { RuntimeBlock, TicketEntry, AppState } from "../lib/types";

type Props = {
  state: AppState;
  onDiscard: () => void;
};

type StaleReason = {
  kind: "ticket" | "epic" | "infra";
  message: string;
};

export function StaleRunBanner({ state, onDiscard }: Props) {
  const reason = detectStale(state);
  if (!reason) return null;
  const subject = reason.kind === "epic" ? "Epic" : "ticket";
  const locations = reason.kind === "epic" ? "epics/ / epic/* branch / epics/done/" : "tickets/ / tickets/done/";
  return (
    <section className="rounded-box border border-warning/40 bg-warning/10 p-4 shadow-sm">
      <h3 className="font-bold text-warning">flow と外部変更がずれています</h3>
      <p className="mt-1 text-sm">{reason.message}</p>
      <p className="mt-1 text-xs text-base-content/70">
        {subject} 自体は既に決着している (close / canceled / 削除) ので、破棄するのは pdh-flow runtime 側の flow 実行状態だけです。reopen 相当は {locations} 上のファイル復元と branch 復元が必要なので Web からは未対応 (`docs/web-ui-inventory.md` 参照)。
      </p>
      <div className="mt-3">
        <button type="button" className="btn btn-error btn-sm" onClick={onDiscard}>
          フローを破棄
        </button>
      </div>
    </section>
  );
}

function detectStale(state: AppState): StaleReason | null {
  const run = state.runtime?.run;
  if (!run?.ticket_id) return null;
  if (run.status === "completed" || run.status === "canceled") return null;

  // pdh-epic-core: ticket_id is "epic-<slug>". Look up in state.git.epics
  // (which lists Epics on main + active epic/* branches). state.tickets only
  // covers PD-C tickets, so the legacy lookup against tickets/ would always
  // false-positive for valid running Epic flows.
  if (run.ticket_id.startsWith("epic-")) {
    const slug = run.ticket_id.slice("epic-".length);
    const epic = (state.git?.epics ?? []).find((e) => e.slug === slug) ?? null;
    if (epic) {
      // Epic file present → not stale. Fall through to infra checks
      // (supervisor stale etc.) below.
    } else {
      return {
        kind: "epic",
        message: `Epic "${slug}" のファイルが epics/ にも epic/* branch にも見つかりません (epics/done/ 行きの可能性)。runtime は ${run.current_step_id ?? "?"} で待機中。`,
      };
    }
    // shared infra checks
    return detectInfraStale(state, run);
  }

  const tickets = state.tickets ?? [];
  const ticket = tickets.find((t: TicketEntry) => t.id === run.ticket_id) ?? null;

  // ticket が done / canceled に移動済み
  if (ticket && (ticket.status === "done" || ticket.status === "canceled")) {
    const where = ticket.path?.startsWith("tickets/done/") ? "tickets/done/" : ticket.path?.startsWith("tickets/canceled/") ? "tickets/canceled/" : ticket.status;
    return {
      kind: "ticket",
      message: `ticket "${run.ticket_id}" は ${where} に移動済みなのに runtime はまだ ${run.current_step_id ?? "?"} で動いています。agent または手動で ticket.sh が実行された可能性があります。`,
    };
  }

  // ticket そのものが見つからない (削除された)
  if (!ticket) {
    return {
      kind: "ticket",
      message: `ticket "${run.ticket_id}" のファイルが tickets/ にも tickets/done/ にも見つかりません。runtime は ${run.current_step_id ?? "?"} で待機中。`,
    };
  }

  // current-ticket.md / current-note.md が必要なのに無い
  const docs = state.documents ?? {};
  const noteText = docs.note?.text ?? "";
  const ticketText = docs.ticket?.text ?? "";
  const noteEmpty = !noteText.trim() || noteText.trim().split(/\r?\n/).every((l) => !l || /^#+\s/.test(l) || l === "---");
  const ticketEmpty = !ticketText.trim();
  if (ticketEmpty && noteEmpty && (run.current_step_id ?? "").startsWith("PD-C-")) {
    return {
      kind: "ticket",
      message: `current-ticket.md と current-note.md が空 / 不在ですが、runtime はまだ ${run.current_step_id} で進行中になっています。`,
    };
  }

  return detectInfraStale(state, run);
}

function detectInfraStale(state: AppState, run: NonNullable<RuntimeBlock["run"]>): StaleReason | null {
  // supervisor が stale (プロセスは死んでいるのに runtime.json が active のまま)
  const supervisor = (state.runtime as RuntimeBlock | undefined)?.supervisor;
  if (supervisor?.status === "stale") {
    return {
      kind: "infra",
      message: `supervisor が stale 状態 (${supervisor.reason ?? "理由不明"})。プロセスは死んでいますが runtime.json は ${run.current_step_id ?? "?"} を指したままです。`,
    };
  }
  return null;
}
