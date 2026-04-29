import type { AppState } from "./types";

const headers = { "Content-Type": "application/json" } as const;

export async function fetchState(): Promise<AppState> {
  const r = await fetch("/api/state", { cache: "no-store" });
  if (!r.ok) throw new Error(`/api/state ${r.status}`);
  return r.json();
}

export type ActionResponse = { ok?: boolean; [k: string]: unknown };

async function postAction(path: string): Promise<ActionResponse> {
  const r = await fetch(path, { method: "POST", headers });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(body?.message || body?.error || `${path} ${r.status}`);
    (err as Error & { status?: number }).status = r.status;
    throw err;
  }
  return body;
}

export const actions = {
  approve(stepId: string) {
    return postAction(`/api/gate/approve?step=${encodeURIComponent(stepId)}`);
  },
  acceptRecommendation(stepId: string) {
    return postAction(`/api/recommendation/accept?step=${encodeURIComponent(stepId)}`);
  },
  applyAssist(stepId: string) {
    return postAction(`/api/assist/apply?step=${encodeURIComponent(stepId)}`);
  },
  startTicket(ticketId: string, opts: { variant?: string; force?: boolean } = {}) {
    const params = new URLSearchParams({
      ticket: ticketId,
      variant: opts.variant ?? "full",
      force: opts.force ? "1" : "0",
    });
    return postAction(`/api/ticket/start?${params}`);
  },
  openTicketTerminal(ticketId: string) {
    return postAction(`/api/ticket/terminal?ticket=${encodeURIComponent(ticketId)}`);
  },
  openAssist(stepId: string) {
    return postAction(`/api/assist/open?step=${encodeURIComponent(stepId)}`);
  },
  runNext(force = false) {
    return postAction(`/api/run-next?force=${force ? "1" : "0"}`);
  },
  resume(force = false) {
    return postAction(`/api/runtime/resume?force=${force ? "1" : "0"}`);
  },
  stop() {
    return postAction(`/api/runtime/stop`);
  },
  discard() {
    return postAction("/api/runtime/discard");
  },
  openRepoTerminal() {
    return postAction("/api/repo/terminal");
  },
};

export async function fetchArtifact(stepId: string, name: string) {
  const r = await fetch(
    `/api/artifact?step=${encodeURIComponent(stepId)}&name=${encodeURIComponent(name)}`,
    { cache: "no-store" }
  );
  if (!r.ok) throw new Error(`artifact ${r.status}`);
  return r.json();
}

export async function fetchDiff(stepId: string) {
  const r = await fetch(`/api/diff?step=${encodeURIComponent(stepId)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`diff ${r.status}`);
  return r.json();
}

export async function fetchRepoFile(stepId: string, path: string) {
  const r = await fetch(
    `/api/file?step=${encodeURIComponent(stepId)}&path=${encodeURIComponent(path)}`,
    { cache: "no-store" }
  );
  if (!r.ok) throw new Error(`file ${r.status}`);
  return r.json();
}
