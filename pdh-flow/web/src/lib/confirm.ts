import type { ConfirmRequest } from "../components/ConfirmModal";
import { actions } from "./api";

type Ctx = {
  stepId?: string;
  stepLabel?: string;
  proposalText?: string;
  ticketId?: string;
};

export function buildConfirmRequest(kind: string, ctx: Ctx): ConfirmRequest | null {
  switch (kind) {
    case "gate_approve":
    case "approve_direct":
      return {
        title: `${ctx.stepLabel ?? ctx.stepId ?? "Gate"} を承認`,
        body: "この gate を通して次の step に進めます。",
        preview: ctx.proposalText,
        confirmLabel: "承認する",
        confirmTone: "approve",
        // Server-side approveGateFromWeb already spawns run-next via
        // spawnRunNextIfClear. Don't chain another runNext call here —
        // the second call races against the spawned process before it
        // acquires the run lock and trips "already locked by pid X".
        onConfirm: () => actions.approve(ctx.stepId!).then(() => {}),
      };
    case "accept_proposal":
      return {
        title: "Assist の提案を反映",
        body: "Assist が出した提案を runtime に渡して次の step を実行します。",
        preview: ctx.proposalText,
        confirmLabel: "Apply & Run",
        confirmTone: "approve",
        // Same as approve: server-side acceptProposalFromWeb auto-fires
        // run-next when the proposal didn't already complete the step.
        onConfirm: () => actions.acceptProposal(ctx.stepId!).then(() => {}),
      };
    case "apply_assist":
      return {
        title: "Assist signal を反映",
        body: "現在の assist signal を取り込んで次の step を実行します。",
        confirmLabel: "Apply",
        confirmTone: "approve",
        onConfirm: () => actions.applyAssist(ctx.stepId!).then(() => {}),
      };
    case "run_next_direct":
      return {
        title: "Run Next を実行",
        body: "通常進行 (run-next) を起動します。次の gate / interruption / failure / complete まで自動で進みます。",
        confirmLabel: "Run Next",
        confirmTone: "approve",
        onConfirm: () => actions.runNext(false).then(() => {}),
      };
    case "run_next_force":
      return {
        title: "Run Next (force)",
        body: "強制再実行します。失敗中の step を再投入します。",
        confirmLabel: "Force Run Next",
        confirmTone: "warning",
        onConfirm: () => actions.runNext(true).then(() => {}),
      };
    case "resume_direct":
      return {
        title: "Resume",
        body: "supervisor の状態を見て、必要なら crash recovery を実行します。",
        confirmLabel: "Resume",
        confirmTone: "approve",
        onConfirm: () => actions.resume(false).then(() => {}),
      };
    case "resume_force":
      return {
        title: "Resume (force recover)",
        body: "supervisor を強制リセットして該当 step を再実行します。",
        confirmLabel: "Force Resume",
        confirmTone: "warning",
        onConfirm: () => actions.resume(true).then(() => {}),
      };
    case "runtime_discard":
      return {
        title: "進行中のフローを破棄",
        body: [
          "ticket は既に決着している (close / canceled / 削除) ので、破棄するのは pdh-flow runtime 上の flow 実行状態だけです。具体的には:",
          " - 進行中の step artifacts (ui-output / review / judgements 等) を archive タグ pdh-flow-archive/<ticket>/<stamp>-<step> に退避",
          " - .pdh-flow/runtime.json を削除して flow をリセット",
          " - ticket ファイル (tickets/done/<id>.md など) と git 履歴は触らない",
          "",
          "リセット後はトップの ticket 選択画面に戻ります。再度同じ ticket をやり直したい場合は CLI で reopen 相当の手順が必要です。",
        ].join("\n"),
        confirmLabel: "フローを破棄",
        confirmTone: "danger",
        onConfirm: () => actions.discard().then(() => {}),
      };
    case "stop_direct":
      return {
        title: "Stop runtime",
        body: "runtime supervisor に停止シグナルを送ります。実行中の provider は終了します。",
        confirmLabel: "Stop",
        confirmTone: "danger",
        onConfirm: () => actions.stop().then(() => {}),
      };
    case "ticket_start": {
      if (!ctx.ticketId) return null;
      return {
        title: `${ctx.ticketId} を開始`,
        body: "新しい ticket run を開始します。",
        confirmLabel: "Start",
        confirmTone: "approve",
        onConfirm: () => actions.startTicket(ctx.ticketId!).then(() => {}),
      };
    }
    case "ticket_force_restart": {
      if (!ctx.ticketId) return null;
      return {
        title: `${ctx.ticketId} を強制再開`,
        body: "現在の run を archive タグに退避して、ticket を最初から再起動します。元には戻せません。",
        confirmLabel: "Force Restart",
        confirmTone: "danger",
        onConfirm: () =>
          actions.startTicket(ctx.ticketId!, { force: true }).then(() => {}),
      };
    }
    default:
      return null;
  }
}
