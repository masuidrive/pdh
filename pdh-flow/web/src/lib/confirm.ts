import type { ConfirmRequest } from "../components/ConfirmModal";
import { actions } from "./api";

type Ctx = {
  stepId?: string;
  stepLabel?: string;
  recommendationText?: string;
  ticketId?: string;
};

export function buildConfirmRequest(kind: string, ctx: Ctx): ConfirmRequest | null {
  switch (kind) {
    case "gate_approve":
    case "approve_direct":
      return {
        title: `${ctx.stepLabel ?? ctx.stepId ?? "Gate"} を承認`,
        body: "この gate を通して次の step に進めます。承認理由を残しておくと履歴で追えます。",
        preview: ctx.recommendationText,
        reasonLabel: "承認メモ (省略可)",
        reasonPlaceholder: "実装方針で問題なし、AC も妥当",
        confirmLabel: "承認する",
        confirmTone: "approve",
        onConfirm: (reason) => actions.approve(ctx.stepId!, reason || undefined).then(() => {}),
      };
    case "accept_recommendation":
      return {
        title: "Recommendation を反映",
        body: "Assist が出した recommendation を runtime に渡して次の step を実行します。",
        preview: ctx.recommendationText,
        confirmLabel: "Apply & Run",
        confirmTone: "approve",
        onConfirm: () => actions.acceptRecommendation(ctx.stepId!).then(() => {}),
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
        reasonLabel: "理由",
        reasonRequired: true,
        reasonPlaceholder: "前回失敗の原因を修正済み",
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
        reasonLabel: "理由",
        reasonRequired: true,
        onConfirm: () => actions.resume(true).then(() => {}),
      };
    case "stop_direct":
      return {
        title: "Stop runtime",
        body: "runtime supervisor に停止シグナルを送ります。実行中の provider は終了します。",
        confirmLabel: "Stop",
        confirmTone: "danger",
        reasonLabel: "停止理由",
        reasonRequired: true,
        reasonPlaceholder: "user_stopped",
        onConfirm: (reason) => actions.stop(reason).then(() => {}),
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
        reasonLabel: "再開理由",
        reasonRequired: true,
        reasonPlaceholder: "前回 run のリセットが必要",
        onConfirm: () =>
          actions.startTicket(ctx.ticketId!, { force: true }).then(() => {}),
      };
    }
    default:
      return null;
  }
}
