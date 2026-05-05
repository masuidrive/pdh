import type { AppState } from "./types";

const headers = { "Content-Type": "application/json" } as const;

export class ApiError extends Error {
  status: number;
  code: string | null;
  url: string;
  details: unknown;

  constructor({
    url,
    status,
    code = null,
    message,
    details = null,
  }: {
    url: string;
    status: number;
    code?: string | null;
    message: string;
    details?: unknown;
  }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.url = url;
    this.details = details;
  }
}

export async function fetchState(ticket?: string | null): Promise<AppState> {
  const url = ticket ? `/api/state?ticket=${encodeURIComponent(ticket)}` : "/api/state";
  return requestJson<AppState>(url, { cache: "no-store" });
}

export type ActionResponse = { ok?: boolean; [k: string]: unknown };
export type SessionActionResponse = { sessionId?: string; result?: { sessionId?: string } };
export type TextArtifactResponse = { text?: string; body?: string; [k: string]: unknown };
export type DiffResponse = {
  stepId?: string;
  baseLabel?: string;
  baseCommit?: string;
  changedFiles?: string[];
  diffStat?: { file: string; insertions: number; deletions: number }[];
  patch?: string | null;
};

// Extract the ticket name from /tickets/<name> in the current URL so
// every action call is automatically scoped to that worktree. Without
// this, actions land on the main repo where there is no runtime, and
// pdh-flow throws "No active run found in current-note.md".
function currentTicketFromPath(): string | null {
  const m = window.location.pathname.match(/^\/tickets\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function withTicketScope(path: string): string {
  // Endpoints that operate on the main repo regardless of which page
  // the user is on (ticket creation, ticket file CRUD, repo terminal,
  // ticket-start which itself creates the worktree). For these we do
  // NOT inject ticket — they need to land on the main repo.
  const MAIN_REPO_ENDPOINTS = ["/api/ticket/create", "/api/ticket/raw", "/api/ticket/update", "/api/ticket/start", "/api/repo/terminal"];
  if (MAIN_REPO_ENDPOINTS.some((p) => path.startsWith(p))) return path;
  const ticket = currentTicketFromPath();
  if (!ticket) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}ticket=${encodeURIComponent(ticket)}`;
}

async function postAction(path: string): Promise<ActionResponse> {
  const url = withTicketScope(path);
  return requestJson<ActionResponse>(url, { method: "POST", headers });
}

export const actions = {
  approve(stepId: string) {
    return postAction(`/api/gate/approve?step=${encodeURIComponent(stepId)}`);
  },
  acceptProposal(stepId: string) {
    return postAction(`/api/proposal/accept?step=${encodeURIComponent(stepId)}`);
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
  createTicket(slug: string) {
    return postAction(`/api/ticket/create?slug=${encodeURIComponent(slug)}`);
  },
  async readTicket(ticketId: string): Promise<{ ticketId: string; path: string; content: string }> {
    return requestJson<{ ticketId: string; path: string; content: string }>(
      `/api/ticket/raw?ticket=${encodeURIComponent(ticketId)}`,
      { method: "GET" }
    );
  },
  async updateTicket(ticketId: string, content: string): Promise<unknown> {
    return requestJson<unknown>(`/api/ticket/update?ticket=${encodeURIComponent(ticketId)}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: content,
    });
  },
  openAssist(stepId: string, opts: { force?: boolean } = {}) {
    const params = new URLSearchParams({ step: stepId });
    if (opts.force) params.set("force", "1");
    return postAction(`/api/assist/open?${params}`);
  },
  runNext(force = false) {
    return postAction(`/api/run-next?force=${force ? "1" : "0"}`);
  },
  diagnose(opts: { model?: string } = {}) {
    const params = new URLSearchParams();
    if (opts.model) params.set("model", opts.model);
    const qs = params.toString();
    return postAction(`/api/diagnose${qs ? `?${qs}` : ""}`);
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
  async updateNoteFrontmatter(patch: Record<string, unknown>): Promise<ActionResponse> {
    const url = withTicketScope("/api/note/frontmatter");
    return requestJson<ActionResponse>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  },
};

export async function fetchArtifact(stepId: string, name: string): Promise<TextArtifactResponse> {
  const url = withTicketScope(
    `/api/artifact?step=${encodeURIComponent(stepId)}&name=${encodeURIComponent(name)}`
  );
  return requestJson(url, { cache: "no-store" });
}

export async function fetchDiff(stepId: string): Promise<DiffResponse> {
  const url = withTicketScope(`/api/diff?step=${encodeURIComponent(stepId)}`);
  return requestJson(url, { cache: "no-store" });
}

export async function fetchRepoFile(stepId: string, path: string): Promise<TextArtifactResponse> {
  const url = withTicketScope(
    `/api/file?step=${encodeURIComponent(stepId)}&path=${encodeURIComponent(path)}`
  );
  return requestJson(url, { cache: "no-store" });
}

export function requireSessionId(session: SessionActionResponse) {
  const sessionId = session.sessionId ?? session.result?.sessionId ?? null;
  if (!sessionId) {
    throw new Error("session_id missing");
  }
  return sessionId;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await parseResponseBody(response);
  if (!response.ok) {
    throw buildApiError(url, response, body);
  }
  return body as T;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildApiError(url: string, response: Response, body: unknown) {
  const message = extractErrorMessage(body) ?? `${url} ${response.status}`;
  const code =
    body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : null;
  const details =
    body && typeof body === "object" && "details" in body
      ? body.details
      : null;
  return new ApiError({
    url,
    status: response.status,
    code,
    message,
    details,
  });
}

function extractErrorMessage(body: unknown) {
  if (typeof body === "string") {
    return body.trim() || null;
  }
  if (body && typeof body === "object") {
    if ("message" in body && typeof body.message === "string" && body.message.trim()) {
      return body.message.trim();
    }
    if ("error" in body && typeof body.error === "string" && body.error.trim()) {
      return body.error.trim();
    }
  }
  return null;
}
