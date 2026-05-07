export function statusBadgeTone(status: string) {
  switch (status) {
    case "needs_human":
    case "waiting":
    case "interrupted":
      return "badge-warning";
    case "failed":
    case "blocked":
      return "badge-error";
    case "active":
    case "running":
      return "badge-info";
    case "done":
    case "completed":
      return "badge-success";
    case "pending":
    default:
      return "badge-neutral";
  }
}

export function statusAlertTone(status: string) {
  switch (status) {
    case "needs_human":
    case "waiting":
    case "interrupted":
      return "alert-warning";
    case "failed":
    case "blocked":
      return "alert-error";
    case "active":
    case "running":
      return "alert-info";
    default:
      return "alert-info";
  }
}

export function statusLabel(status: string) {
  switch (status) {
    case "needs_human":
    case "waiting":
      return "ユーザ回答待ち";
    case "active":
    case "running":
      return "実行中";
    case "done":
    case "completed":
      return "完了";
    case "failed":
      return "失敗";
    case "blocked":
      return "ブロック";
    case "pending":
      return "未着手";
    case "interrupted":
      return "割り込み";
    default:
      return status;
  }
}
