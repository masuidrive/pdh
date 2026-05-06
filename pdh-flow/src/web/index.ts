import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { URL, fileURLToPath } from "node:url";
import { renderMermaidSVG } from "beautiful-mermaid";
import { parse as parseYaml } from "yaml";
import { clearTicketStartRequest, loadLatestAssistSignal, loadPendingTicketStartRequests } from "../runtime/assist/runtime.ts";
import { createAssistTerminalManager } from "../runtime/assist/terminal.ts";
import { evaluateAcVerificationTable } from "../flow/guards/ac-verification.ts";
import { buildFlowView, getStep, loadFlow, nextStep, renderMermaidFlow, resolveStepReviewPlan } from "../flow/load.ts";
import { expandReviewerInstances } from "../runtime/review.ts";
import { renderStepPrompt } from "../flow/prompts/step.ts";
import { renderReviewerPrompt } from "../flow/prompts/reviewer.ts";
import { renderReviewRepairPrompt } from "../flow/prompts/repair.ts";
import { loadStepInterruptions } from "../runtime/interruptions.ts";
import { loadJudgements } from "../flow/guards/judgement-artifact.ts";
import { extractSection, loadCurrentNote, parseStepHistory } from "../repo/note.ts";
import { parseNoteOverrides, writeNoteOverrides } from "../repo/note-overrides.ts";
import { CommandExecutionError, commandErrorDetails, formatCommandForDisplay, runCommandResult } from "../support/command.ts";
import { createRedactor } from "../repo/redaction.ts";
import { loadReviewerOutputsForStep } from "../runtime/review.ts";
import { loadStepUiOutput } from "../flow/prompts/ui-output.ts";
import { loadStepUiRuntime } from "../runtime/ui.ts";
import { appendProgressEvent, hasCompletedProviderAttempt, latestAttemptResult, latestHumanGate, listTrackedProcesses, loadRuntime, readProgressEvents, runtimeMetaPath, stepDir } from "../runtime/state.ts";
import { archivePriorRunTag, findTicketWorktreePath } from "../runtime/actions.ts";
import type { AnyRecord } from "../types.ts";

const MAX_TEXT = 120000;
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const TEXT_ARTIFACT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".patch", ".diff", ".log", ".mmd"]);
const XTERM_JS_PATH = fileURLToPath(new URL("../../node_modules/@xterm/xterm/lib/xterm.js", import.meta.url));
const XTERM_CSS_PATH = fileURLToPath(new URL("../../node_modules/@xterm/xterm/css/xterm.css", import.meta.url));
const XTERM_FIT_JS_PATH = fileURLToPath(new URL("../../node_modules/@xterm/addon-fit/lib/addon-fit.js", import.meta.url));
const XTERM_WEB_LINKS_JS_PATH = fileURLToPath(new URL("../../node_modules/@xterm/addon-web-links/lib/addon-web-links.js", import.meta.url));
const MARKDOWN_IT_JS_PATH = fileURLToPath(new URL("../../node_modules/markdown-it/dist/markdown-it.min.js", import.meta.url));
const CLI_EXT = import.meta.url.endsWith(".js") ? ".js" : ".ts";
const CLI_PATH = fileURLToPath(new URL(`../cli/index${CLI_EXT}`, import.meta.url));
const WEB_DIST_DIR = fileURLToPath(new URL("../../web/bundle/", import.meta.url));
const SPA_INDEX_PATH = join(WEB_DIST_DIR, "index.html");
const SPA_AVAILABLE = existsSync(SPA_INDEX_PATH);
const LEGACY_ASSET_ROUTES = new Set([
  "/assets/xterm.js",
  "/assets/xterm.css",
  "/assets/xterm-addon-fit.js",
  "/assets/xterm-addon-web-links.js",
  "/assets/markdown-it.js"
]);
const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".ts": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

// Each ticket runs in its own git worktree under
// <main>/../<project>.worktrees/<ticket>/. The web server treats the
// CLI's --repo as the *main* repo and resolves a per-ticket workspace
// from the URL's `ticket` query param. When no ticket is specified the
// workspace falls back to the main repo (which is fine for endpoints
// that operate on tickets/ list, ticket files, or git status — none
// of those care about the worktree).
function resolveWorkspace({ mainRepo, ticket }) {
  if (!ticket) return mainRepo;
  const wt = findTicketWorktreePath({ repoPath: mainRepo, ticket });
  return wt ? resolve(wt) : mainRepo;
}

function ticketFromRequest(url) {
  const t = url.searchParams.get("ticket");
  return t && t.trim() ? t.trim() : null;
}

function collectWorkspaceSummaries({ mainRepo, ticketIds }) {
  const summaries = {};
  for (const ticket of ticketIds) {
    const wt = findTicketWorktreePath({ repoPath: mainRepo, ticket });
    if (!wt) {
      summaries[ticket] = null;
      continue;
    }
    try {
      const runtime = loadRuntime(resolve(wt), { normalizeStaleRunning: false });
      summaries[ticket] = runtime.run ? {
        runId: runtime.run.id ?? null,
        currentStepId: runtime.run.current_step_id ?? null,
        status: runtime.run.status ?? null,
        flowVariant: runtime.run.flow_variant ?? null,
        updatedAt: runtime.run.updated_at ?? null,
        worktreePath: wt
      } : { worktreePath: wt };
    } catch (error) {
      process.stderr.write(`pdh-flow: warning: failed to load workspace summary for ${ticket}: ${error?.message || String(error)}\n`);
      summaries[ticket] = {
        worktreePath: wt,
        error: error?.message || String(error),
      };
    }
  }
  return summaries;
}

export function startWebServer({ repoPath = process.cwd(), host = "127.0.0.1", port = 8765 } = {}) {
  const repo = resolve(repoPath);
  const assistTerminalManager = createAssistTerminalManager({ repoPath: repo });
  const server = createServer((request, response) => {
    handleRequest({ request, response, repo, assistTerminalManager });
  });
  server.on("upgrade", (request, socket, head) => {
    if (assistTerminalManager.handleUpgrade(request, socket, head)) {
      return;
    }
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  });
  server.on("close", () => {
    assistTerminalManager.closeAll();
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(Number(port), host, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to determine bound web server address"));
        return;
      }
      const actualHost = address.address === "::" ? "localhost" : address.address;
      resolveServer({
        server,
        repo,
        url: `http://${actualHost}:${address.port}/`
      });
    });
  });
}

function handleRequest({ request, response, repo: mainRepo, assistTerminalManager }) {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD" && !(method === "POST" && (request.url?.startsWith("/api/assist/open") || request.url?.startsWith("/api/assist/apply") || request.url?.startsWith("/api/proposal/accept") || request.url?.startsWith("/api/gate/approve") || request.url?.startsWith("/api/ticket/start") || request.url?.startsWith("/api/ticket/terminal") || request.url?.startsWith("/api/ticket/create") || request.url?.startsWith("/api/ticket/update") || request.url?.startsWith("/api/note/frontmatter") || request.url?.startsWith("/api/run-next") || request.url?.startsWith("/api/diagnose") || request.url?.startsWith("/api/runtime/resume") || request.url?.startsWith("/api/runtime/stop") || request.url?.startsWith("/api/runtime/discard") || request.url?.startsWith("/api/repo/terminal")))) {
    sendJson(response, 405, { error: "read_only_web_ui" });
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  const ticket = ticketFromRequest(url);
  // Workspace = the per-ticket worktree when a ticket is named, else
  // the main repo. Endpoints that operate on tickets/ files, ticket
  // creation, or git-level state pass `mainRepo` directly; everything
  // that touches runtime state (.pdh-flow/) uses `workspace`.
  const repo = resolveWorkspace({ mainRepo, ticket });
  if (url.pathname === "/" || url.pathname === "/index.html") {
    if (SPA_AVAILABLE && serveStaticFile(response, SPA_INDEX_PATH)) {
      return;
    }
    sendHtml(response, missingSpaShell());
    return;
  }
  if (SPA_AVAILABLE && url.pathname.startsWith("/assets/") && !LEGACY_ASSET_ROUTES.has(url.pathname)) {
    const candidate = join(WEB_DIST_DIR, url.pathname.replace(/^\/+/, ""));
    if (candidate.startsWith(WEB_DIST_DIR) && existsSync(candidate)) {
      if (serveStaticFile(response, candidate)) {
        return;
      }
    }
  }
  if (url.pathname === "/api/state") {
    const state: AnyRecord = collectState({ repo });
    if (!ticket) {
      // Home view: attach lightweight per-ticket worktree summaries so
      // the ticket list can show stepId/status/updatedAt without
      // having to fan out one /api/state request per ticket.
      const ticketIds = (state.tickets ?? []).map((t) => t.id).filter(Boolean);
      state.workspaces = collectWorkspaceSummaries({ mainRepo, ticketIds });
    } else {
      state.ticket = ticket;
      state.mainRepo = mainRepo;
    }
    sendJson(response, 200, state);
    return;
  }
  if (url.pathname === "/api/assist/open") {
    if (method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    const stepId = url.searchParams.get("step");
    if (!stepId) {
      sendJson(response, 400, { error: "missing_step" });
      return;
    }
    const force = url.searchParams.get("force") === "1";
    try {
      // `repo` is the per-request workspace (worktree when ?ticket= is
      // set, else mainRepo). Pass it through so assist-open is spawned
      // against the right .pdh-flow/runtime.json. Without this the PTY
      // runs in mainRepo and exits with "No active run found" because
      // the run lives in the worktree.
      sendJson(response, 200, assistTerminalManager.openSession({ stepId, force, repoPath: repo }));
    } catch (error) {
      sendApiError(response, "assist_open_failed", error);
    }
    return;
  }
  if (url.pathname === "/api/proposal/accept") {
    if (method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    const stepId = url.searchParams.get("step");
    if (!stepId) {
      sendJson(response, 400, { error: "missing_step" });
      return;
    }
    try {
      sendJson(response, 200, acceptProposalFromWeb({ repo, stepId }));
    } catch (error) {
      sendApiError(response, "proposal_accept_failed", error);
    }
    return;
  }
  if (url.pathname === "/api/gate/approve") {
    if (method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    const stepId = url.searchParams.get("step");
    if (!stepId) {
      sendJson(response, 400, { error: "missing_step" });
      return;
    }
    try {
      sendJson(response, 200, approveGateFromWeb({ repo, stepId }));
    } catch (error) {
      sendApiError(response, "gate_approve_failed", error);
    }
    return;
  }
  if (url.pathname === "/api/ticket/start") {
    if (method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    const ticketId = url.searchParams.get("ticket");
    const variant = url.searchParams.get("variant") || "full";
    const force = url.searchParams.get("force") === "1";
    if (!ticketId) {
      sendJson(response, 400, { error: "missing_ticket" });
      return;
    }
    try {
      sendJson(response, 200, startTicketFromWeb({ repo, ticketId, variant, force }));
    } catch (error) {
      sendApiError(response, "ticket_start_failed", error);
    }
    return;
  }
  if (url.pathname === "/api/ticket/terminal") {
    if (method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    const ticketId = url.searchParams.get("ticket");
    if (!ticketId) {
      sendJson(response, 400, { error: "missing_ticket" });
      return;
    }
    try {
      sendJson(response, 200, openTicketTerminalFromWeb({ repo, ticketId, assistTerminalManager }));
    } catch (error) {
      sendApiError(response, "ticket_terminal_failed", error);
    }
    return;
  }
  if (url.pathname === "/api/ticket/raw") {
    if (method !== "GET") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    const ticketId = url.searchParams.get("ticket");
    if (!ticketId) {
      sendJson(response, 400, { error: "missing_ticket" });
      return;
    }
    try {
      sendJson(response, 200, readTicketRawFromWeb({ repo, ticketId }));
    } catch (error) {
      sendApiError(response, "ticket_read_failed", error);
    }
    return;
  }
  if (url.pathname === "/api/ticket/update") {
    if (method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    const ticketId = url.searchParams.get("ticket");
    if (!ticketId) {
      sendJson(response, 400, { error: "missing_ticket" });
      return;
    }
    let bodyChunks = [];
    request.on("data", (c) => bodyChunks.push(c));
    request.on("end", () => {
      try {
        const raw = Buffer.concat(bodyChunks).toString("utf8");
        sendJson(response, 200, updateTicketFromWeb({ repo, ticketId, content: raw }));
      } catch (error) {
        sendApiError(response, "ticket_update_failed", error);
      }
    });
    return;
  }
  if (url.pathname === "/api/note/frontmatter") {
    if (method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    let bodyChunks = [];
    request.on("data", (c) => bodyChunks.push(c));
    request.on("end", () => {
      try {
        const raw = Buffer.concat(bodyChunks).toString("utf8");
        const patch = raw ? JSON.parse(raw) : {};
        sendJson(response, 200, updateNoteFrontmatterFromWeb({ repo, patch }));
      } catch (error) {
        sendApiError(response, "note_frontmatter_update_failed", error);
      }
    });
    return;
  }
  if (url.pathname === "/api/ticket/create") {
    if (method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    const slug = url.searchParams.get("slug");
    if (!slug) {
      sendJson(response, 400, { error: "missing_slug" });
      return;
    }
    try {
      sendJson(response, 200, createTicketFromWeb({ repo, slug }));
    } catch (error) {
      sendApiError(response, "ticket_create_failed", error);
    }
    return;
  }
  if (url.pathname === "/api/run-next") {
    if (method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    const force = url.searchParams.get("force") === "1";
    try {
      sendJson(response, 200, runNextFromWeb({ repo, force }));
    } catch (error) {
      sendApiError(response, "run_next_failed", error);
    }
    return;
  }
  if (url.pathname === "/api/diagnose") {
    if (method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    try {
      const model = url.searchParams.get("model") || null;
      sendJson(response, 200, diagnoseFromWeb({ repo, model }));
    } catch (error) {
      sendApiError(response, "diagnose_failed", error);
    }
    return;
  }
  if (url.pathname === "/api/runtime/resume") {
    if (method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    const force = url.searchParams.get("force") === "1";
    try {
      sendJson(response, 200, resumeRuntimeFromWeb({ repo, force }));
    } catch (error) {
      sendApiError(response, "resume_failed", error);
    }
    return;
  }
  if (url.pathname === "/api/runtime/stop") {
    if (method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    try {
      sendJson(response, 200, stopRuntimeFromWeb({ repo }));
    } catch (error) {
      sendApiError(response, "stop_failed", error);
    }
    return;
  }
  if (url.pathname === "/api/repo/terminal") {
    if (method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    try {
      sendJson(response, 200, assistTerminalManager.openRepoSession());
    } catch (error) {
      sendApiError(response, "repo_terminal_failed", error);
    }
    return;
  }
  if (url.pathname === "/api/runtime/discard") {
    if (method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    try {
      sendJson(response, 200, discardRuntimeFromWeb({ repo }));
    } catch (error) {
      sendApiError(response, "discard_failed", error);
    }
    return;
  }
  if (url.pathname === "/api/assist/apply") {
    if (method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    const stepId = url.searchParams.get("step");
    if (!stepId) {
      sendJson(response, 400, { error: "missing_step" });
      return;
    }
    try {
      sendJson(response, 200, applyAssistSignalFromWeb({ repo, stepId }));
    } catch (error) {
      sendApiError(response, "assist_apply_failed", error);
    }
    return;
  }
  if (url.pathname === "/api/events") {
    sendEventStream({ request, response, repo, mainRepo, ticket });
    return;
  }
  if (url.pathname === "/assets/xterm.js") {
    sendScript(response, 200, readFileSync(XTERM_JS_PATH, "utf8"));
    return;
  }
  if (url.pathname === "/assets/xterm-addon-fit.js") {
    sendScript(response, 200, readFileSync(XTERM_FIT_JS_PATH, "utf8"));
    return;
  }
  if (url.pathname === "/assets/xterm-addon-web-links.js") {
    sendScript(response, 200, readFileSync(XTERM_WEB_LINKS_JS_PATH, "utf8"));
    return;
  }
  if (url.pathname === "/assets/markdown-it.js") {
    sendScript(response, 200, readFileSync(MARKDOWN_IT_JS_PATH, "utf8"));
    return;
  }
  if (url.pathname === "/assets/xterm.css") {
    sendCss(response, 200, readFileSync(XTERM_CSS_PATH, "utf8"));
    return;
  }
  if (url.pathname === "/api/flow.mmd") {
    sendText(response, 200, collectMermaid({ repo, variant: url.searchParams.get("variant") }));
    return;
  }
  if (url.pathname === "/api/render-mermaid") {
    const code = url.searchParams.get("code") ?? "";
    const svg = renderBeautifulMermaid(code);
    if (!svg) {
      sendJson(response, 400, { error: "invalid_mermaid" });
      return;
    }
    sendSvg(response, 200, svg);
    return;
  }
  if (url.pathname === "/api/artifact") {
    const payload = collectArtifactPayload({
      repo,
      stepId: url.searchParams.get("step"),
      name: url.searchParams.get("name")
    });
    if (!payload) {
      sendJson(response, 404, { error: "artifact_not_found" });
      return;
    }
    sendJson(response, 200, payload);
    return;
  }
  if (url.pathname === "/api/diff") {
    const payload = collectDiffPayload({
      repo,
      stepId: url.searchParams.get("step")
    });
    if (!payload) {
      sendJson(response, 404, { error: "diff_not_found" });
      return;
    }
    sendJson(response, 200, payload);
    return;
  }
  if (url.pathname === "/api/file") {
    const payload = collectRepoFilePayload({
      repo,
      stepId: url.searchParams.get("step"),
      path: url.searchParams.get("path")
    });
    if (!payload) {
      sendJson(response, 404, { error: "file_not_found" });
      return;
    }
    sendJson(response, 200, payload);
    return;
  }
  if (url.pathname === "/api/prompt") {
    const payload = collectPromptPayload({
      repo,
      stepId: url.searchParams.get("step")
    });
    if (!payload) {
      sendJson(response, 404, { error: "prompt_not_available" });
      return;
    }
    sendJson(response, 200, payload);
    return;
  }
  if (url.pathname === "/api/run-file") {
    serveRunFile({ response, repo, rawPath: url.searchParams.get("path") });
    return;
  }
  // SPA fallback: any non-/api, non-/assets path that isn't a static
  // asset gets the React index.html so client-side routes like
  // /tickets/<NAME> resolve without 404.
  if (
    SPA_AVAILABLE &&
    method === "GET" &&
    !url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/assets/") &&
    serveStaticFile(response, SPA_INDEX_PATH)
  ) {
    return;
  }
  sendJson(response, 404, { error: "not_found" });
}

function sendEventStream({ request, response, repo, mainRepo = null, ticket = null }) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write("retry: 3000\n\n");

  let previous = "";
  const pushState = () => {
    const state: AnyRecord = collectState({ repo });
    if (!ticket) {
      const ticketIds = (state.tickets ?? []).map((t) => t.id).filter(Boolean);
      state.workspaces = collectWorkspaceSummaries({ mainRepo: mainRepo ?? repo, ticketIds });
    } else {
      state.ticket = ticket;
      state.mainRepo = mainRepo ?? repo;
    }
    const payload = JSON.stringify(state);
    if (payload === previous) {
      return;
    }
    previous = payload;
    response.write(`event: state\ndata: ${payload}\n\n`);
  };

  const heartbeat = setInterval(() => {
    response.write(": keep-alive\n\n");
  }, 15000);
  const ticker = setInterval(pushState, 2000);
  pushState();

  const cleanup = () => {
    clearInterval(heartbeat);
    clearInterval(ticker);
    response.end();
  };
  request.on("close", cleanup);
  request.on("aborted", cleanup);
}

function acceptProposalFromWeb({ repo, stepId }) {
  const accepted = runCliJson({
    repo,
    args: ["accept-proposal", "--repo", repo, "--step", stepId, "--no-run-next"]
  });
  let runNextPid = null;
  let runNextSkipped = null;
  if (accepted?.result?.status !== "completed") {
    const launched = spawnRunNextIfClear({ repo });
    runNextPid = launched.pid;
    runNextSkipped = launched.lockHolder;
  }
  return {
    ...accepted,
    runNextStarted: Boolean(runNextPid),
    runNextPid,
    runNextSkipped
  };
}

function approveGateFromWeb({ repo, stepId }) {
  const approved = runCliText({
    repo,
    args: ["approve", "--repo", repo, "--step", stepId]
  });
  const launched = spawnRunNextIfClear({ repo });
  return {
    status: "ok",
    approved,
    runNextStarted: Boolean(launched.pid),
    runNextPid: launched.pid,
    runNextSkipped: launched.lockHolder
  };
}

function startTicketFromWeb({ repo, ticketId, variant = "full", force = false }) {
  // `repo` may be the main repo (worktree not yet created) or an
  // already-existing worktree path. Either way `pdh-flow start` will
  // create the worktree if needed and write runtime.json there.
  const cliArgs = ["run", "--repo", repo, "--ticket", ticketId, "--variant", variant];
  if (force) {
    cliArgs.push("--force-reset");
  }
  const started = runCliText({
    repo,
    args: cliArgs
  });
  clearTicketStartRequest({ repoPath: repo, ticketId });
  // After `run` succeeds the worktree definitely exists. Re-resolve so
  // the background run-next subprocess targets the worktree's
  // runtime.json instead of the main repo (which has no run state).
  const wt = findTicketWorktreePath({ repoPath: repo, ticket: ticketId });
  const runNextRepo = wt ? resolve(wt) : repo;
  const launched = spawnRunNextIfClear({ repo: runNextRepo });
  return {
    status: "ok",
    started,
    runNextStarted: Boolean(launched.pid),
    runNextPid: launched.pid,
    runNextSkipped: launched.lockHolder,
    worktree: runNextRepo === repo ? null : runNextRepo
  };
}

function ticketFilePath({ repo, ticketId }) {
  // Refuse path traversal — ticket ids are always slugs in tickets/<id>.md form.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(ticketId || ""))) {
    const err = new Error("invalid ticket id");
    err.statusCode = 400;
    throw err;
  }
  return join(repo, "tickets", `${ticketId}.md`);
}

function readTicketRawFromWeb({ repo, ticketId }) {
  const path = ticketFilePath({ repo, ticketId });
  if (!existsSync(path)) {
    const err = new Error(`ticket file not found: tickets/${ticketId}.md`);
    err.statusCode = 404;
    throw err;
  }
  return {
    status: "ok",
    ticketId,
    path: `tickets/${ticketId}.md`,
    content: readFileSync(path, "utf8")
  };
}

function updateNoteFrontmatterFromWeb({ repo, patch }) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    const err = new Error("patch body must be a JSON object");
    err.statusCode = 400;
    throw err;
  }
  // Whitelist the keys the runtime knows how to consume. Reject other
  // top-level keys so the UI can't accidentally write arbitrary frontmatter.
  const allowed = new Set([
    "flow_variant",
    "flow_variant_locked",
    "flow_variant_reason",
    "agent_overrides",
    "agent_overrides_locked"
  ]);
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key)) continue;
    sanitized[key] = value;
  }
  if (Object.keys(sanitized).length === 0) {
    const err = new Error(`patch body had no recognized keys (allowed: ${[...allowed].join(", ")})`);
    err.statusCode = 400;
    throw err;
  }

  // When variant changes, prune agent_overrides for steps that aren't in
  // the new variant's sequence. Stale entries would otherwise sit in
  // frontmatter and reactivate if the user toggled back, which is
  // surprising. Pruning is the simpler default; users who want carry-over
  // can resave the override after switching back.
  const prunedSteps: string[] = [];
  if (sanitized.flow_variant !== undefined) {
    const existing = parseNoteOverrides(loadCurrentNote(repo).extraFrontmatter);
    const nextVariant = String(sanitized.flow_variant);
    const variantChanged = existing.flowVariant !== nextVariant;
    if (variantChanged) {
      const flow = loadFlow() as { variants?: Record<string, { sequence?: string[] }> };
      const nextSequence: string[] = flow.variants?.[nextVariant]?.sequence ?? [];
      const allowedStepIds = new Set(nextSequence);
      const sourceOverrides = (sanitized.agent_overrides as Record<string, unknown> | undefined)
        ?? existing.agentOverrides
        ?? {};
      const next: Record<string, unknown> = {};
      for (const [stepId, value] of Object.entries(sourceOverrides)) {
        if (allowedStepIds.has(stepId)) {
          next[stepId] = value;
        } else {
          prunedSteps.push(stepId);
        }
      }
      sanitized.agent_overrides = next;
    }
  }

  writeNoteOverrides(repo, sanitized);
  const result = parseNoteOverrides(loadCurrentNote(repo).extraFrontmatter);
  return {
    status: "ok",
    repo,
    applied: sanitized,
    pruned_agent_overrides: prunedSteps,
    state: {
      flow_variant: result.flowVariant,
      flow_variant_locked: result.flowVariantLocked,
      flow_variant_reason: result.flowVariantReason,
      agent_overrides: result.agentOverrides,
      agent_overrides_locked: result.agentOverridesLocked
    },
    warnings: result.warnings
  };
}

function updateTicketFromWeb({ repo, ticketId, content }) {
  const path = ticketFilePath({ repo, ticketId });
  if (!existsSync(path)) {
    const err = new Error(`ticket file not found: tickets/${ticketId}.md`);
    err.statusCode = 404;
    throw err;
  }
  if (typeof content !== "string") {
    const err = new Error("content must be a string");
    err.statusCode = 400;
    throw err;
  }
  // Preserve the trailing newline convention so editors don't drop it.
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  writeFileSync(path, normalized);
  return {
    status: "ok",
    ticketId,
    path: `tickets/${ticketId}.md`,
    bytes: Buffer.byteLength(normalized, "utf8")
  };
}

function createTicketFromWeb({ repo, slug }) {
  // Defer to ./ticket.sh (the canonical CLI for ticket lifecycle in
  // examples/sample1) so the new ticket file matches what the rest of
  // the toolchain expects (frontmatter, defaults, etc.).
  const trimmed = String(slug || "").trim();
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(trimmed)) {
    const err = new Error("slug must be lowercase letters, digits, hyphens (1-64 chars, starts with a letter)");
    err.statusCode = 400;
    throw err;
  }
  const result = runCommandResult(join(repo, "ticket.sh"), ["new", trimmed], { cwd: repo });
  if (!result.ok) {
    throw withStatusCode(new CommandExecutionError(result), result.error ? 500 : 400);
  }
  return {
    status: "ok",
    slug: trimmed,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function diagnoseFromWeb({ repo, model = null }) {
  const args = ["diagnose", "--repo", repo];
  if (model) args.push("--model", model);
  const pid = spawnBackgroundCli({ repo, args });
  return {
    status: "ok",
    diagnoseStarted: true,
    pid
  };
}

function runNextFromWeb({ repo, force = false }) {
  const launched = spawnRunNextIfClear({ repo, extraArgs: force ? ["--force"] : [] });
  return {
    status: "ok",
    runNextStarted: Boolean(launched.pid),
    runNextPid: launched.pid,
    runNextSkipped: launched.lockHolder,
    force
  };
}

function resumeRuntimeFromWeb({ repo, force = false }) {
  const args = ["resume", "--repo", repo];
  if (force) {
    args.push("--force");
  }
  const pid = spawnBackgroundCli({ repo, args });
  return {
    status: "ok",
    resumeStarted: true,
    pid,
    force
  };
}

function stopRuntimeFromWeb({ repo }) {
  return runCliJson({
    repo,
    args: ["stop", "--repo", repo]
  });
}

function discardRuntimeFromWeb({ repo }) {
  const runtime = loadRuntime(repo, { normalizeStaleRunning: false });
  const run = runtime?.run ?? null;
  let archiveTag = null;
  if (run?.ticket_id) {
    archiveTag = archivePriorRunTag({ repoPath: repo, run });
  }
  const metaPath = runtimeMetaPath(repo);
  let removed = false;
  if (existsSync(metaPath)) {
    try {
      rmSync(metaPath, { force: true });
      removed = true;
    } catch (error) {
      const wrapped = new Error(`discard_failed: ${error?.message || String(error)}`);
      wrapped.statusCode = 500;
      throw wrapped;
    }
  }
  return {
    ok: true,
    archiveTag,
    removed,
    run: run ? { id: run.id, ticket_id: run.ticket_id, current_step_id: run.current_step_id } : null
  };
}

function openTicketTerminalFromWeb({ repo, ticketId, assistTerminalManager }) {
  const ticket = collectTickets({ repo, redactor: (text) => String(text ?? "") }).find((item) => item.id === ticketId);
  if (!ticket) {
    const error = new Error(`ticket_not_found: ${ticketId}`);
    error.statusCode = 404;
    throw error;
  }
  return assistTerminalManager.openTicketSession({
    ticketId
  });
}

function applyAssistSignalFromWeb({ repo, stepId }) {
  const applied = runCliJson({
    repo,
    args: ["apply-assist-signal", "--repo", repo, "--step", stepId, "--no-run-next"]
  });
  const launched = spawnRunNextIfClear({ repo, extraArgs: ["--force"] });
  return {
    ...applied,
    runNextStarted: Boolean(launched.pid),
    runNextPid: launched.pid,
    runNextSkipped: launched.lockHolder
  };
}

function runCliJson({ repo, args, timeoutMs = 30000 }) {
  const result = runCli({ repo, args, timeoutMs });
  const text = String(result.stdout || "").trim();
  if (!text) {
    return {};
  }
  return parseCliJsonOutput(text);
}

function runCliText({ repo, args, timeoutMs = 30000 }) {
  const result = runCli({ repo, args, timeoutMs });
  return String(result.stdout || "").trim();
}

function runCli({ repo, args, timeoutMs = 30000 }) {
  const result = runCommandResult(process.execPath, [CLI_PATH, ...args], {
    cwd: repo,
    timeout: timeoutMs,
    env: process.env,
  });
  if (!result.ok) {
    throw withStatusCode(new CommandExecutionError(result, { timeoutMs }), result.exitCode === 1 ? 409 : 500);
  }
  return result;
}

function parseCliJsonOutput(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    for (let index = text.length - 1; index >= 0; index -= 1) {
      const char = text[index];
      if (char !== "{" && char !== "[") {
        continue;
      }
      try {
        return JSON.parse(text.slice(index));
      } catch {
        continue;
      }
    }
    const wrapped = new Error(error?.message || "invalid_json");
    wrapped.cause = error;
    throw wrapped;
  }
}

// If a run-next is already in flight (the runtime lock file exists and
// its holder pid is alive on this host), skip spawning another one and
// return the holder details. Avoids the noisy "already locked" error
// event when web-side actions (approve / accept / run-next button)
// double-fire while a background run-next is still working.
function runtimeLockHolder({ repo }: { repo: string }) {
  try {
    const runtime = loadRuntime(repo, { normalizeStaleRunning: false });
    const runId = runtime.run?.id;
    const stateDir = runtime.stateDir;
    if (!runId || !stateDir) return null;
    const lockPath = join(stateDir, "locks", `${runId.replace(/[^A-Za-z0-9_.-]/g, "_")}.lock`);
    if (!existsSync(lockPath)) return null;
    const holder = JSON.parse(readFileSync(lockPath, "utf8"));
    if (holder?.hostname && holder.hostname !== hostname()) return holder; // foreign host — treat as held, can't probe
    if (!Number.isInteger(holder?.pid)) return null;
    try {
      process.kill(holder.pid, 0);
      return holder; // alive
    } catch (err: any) {
      if (err?.code === "EPERM") return holder; // alive, no permission to signal
      return null; // dead → stale lock, ignore
    }
  } catch {
    return null;
  }
}

// Spawn run-next in the background, but only if the run lock is free.
// Returns { pid: <number> } on launch, or { pid: null, lockHolder } when
// an in-flight run-next already owns the lock.
function spawnRunNextIfClear({ repo, extraArgs = [] }: { repo: string; extraArgs?: string[] }) {
  const lockHolder = runtimeLockHolder({ repo });
  if (lockHolder) {
    return { pid: null, lockHolder };
  }
  const pid = spawnBackgroundCli({ repo, args: ["run-next", "--repo", repo, ...extraArgs] });
  return { pid, lockHolder: null };
}

function spawnBackgroundCli({ repo, args }) {
  const child = spawn(process.execPath, [CLI_PATH, ...args], {
    cwd: repo,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });
  if (child.pid == null) {
    throw new Error(`failed to spawn background CLI: ${formatCommandForDisplay(process.execPath, [CLI_PATH, ...args])}`);
  }
  let stderrBuffer = "";
  child.on("error", (error) => {
    const message = `background CLI failed to start: ${error?.message || String(error)}`;
    stderrBuffer = `${stderrBuffer}\n${message}`.trim();
    process.stderr.write(`pdh-flow: warning: ${message}\n`);
  });
  child.stderr?.on("data", (chunk) => {
    stderrBuffer += String(chunk);
    if (stderrBuffer.length > 4000) stderrBuffer = stderrBuffer.slice(-4000);
  });
  child.stdout?.on("data", () => { /* discard */ });
  child.on("exit", (code, signal) => {
    if (code === 0 || code === null) return;
    const subcommand = args[0] ?? "cli";
    try {
      const runtime = loadRuntime(repo, { normalizeStaleRunning: false });
      const runId = runtime.run?.id;
      const stepId = runtime.run?.current_step_id ?? null;
      if (!runId) return;
      appendProgressEvent({
        repoPath: repo,
        runId,
        stepId,
        type: "run_failed",
        provider: "runtime",
        message: `background ${subcommand} exited with code ${code}${signal ? ` (signal ${signal})` : ""}: ${stderrBuffer.trim().slice(-400) || "(no stderr)"}`,
        payload: {
          command: subcommand,
          exitCode: code,
          signal,
          stderr: stderrBuffer.trim().slice(-2000)
        }
      });
    } catch {
      // best-effort logging only
    }
  });
  child.unref();
  return child.pid;
}

function collectState({ repo }: { repo: string }) {
  const runtime = loadRuntime(repo, { normalizeStaleRunning: true });
  const redactor = createRedactor({ repoPath: repo });
  const note = runtime.note;
  const ticketText = existsSync(join(repo, "current-ticket.md")) ? readFileSync(join(repo, "current-ticket.md"), "utf8") : "";
  const optionalDocs: AnyRecord = loadOptionalRepoDocuments(repo, redactor);
  const tickets = collectTickets({ repo, redactor });
  const run = runtime.run;
  const currentStep = run?.current_step_id ? getStep(runtime.flow, run.current_step_id) : null;
  const currentGate = run?.id && currentStep ? latestHumanGate({ stateDir: runtime.stateDir, runId: run.id, stepId: currentStep.id }) : null;
  const interruptions = run?.id && currentStep
    ? loadStepInterruptions({ stateDir: runtime.stateDir, runId: run.id, stepId: currentStep.id }).map((item) => redactObject(item, redactor))
    : [];
  const events = run ? readProgressEvents({ repoPath: repo, runId: run.id, limit: 120 }).map((event) => redactObject(event, redactor)) : [];
  const history = parseStepHistory(note.body).entries;
  const ac = evaluateAcVerificationTable({ repoPath: repo, allowUnverified: true });
  const variants = Object.fromEntries(["full", "light"].map((variant) => [
    variant,
    buildVariantState({ repo, runtime, variant, history, events, redactor, noteBody: note.body, ticketText, ac })
  ]));
  const activeVariant = run?.flow_variant ?? runtime.pdh.variant ?? "full";
  const currentStepView = currentStep ? variants[activeVariant]?.steps?.find((step) => step.id === currentStep.id) ?? null : null;
  const summary = buildSummary({ runtime, activeVariant: variants[activeVariant], ac, currentStep: currentStepView ?? currentStep, currentGate, interruptions });
  return {
    repo,
    repoName: basename(repo),
    mode: "viewer+assist",
    generatedAt: new Date().toISOString(),
    runtime: {
      run: run ? redactObject(run, redactor) : null,
      supervisor: runtime.supervisor ? redactObject(runtime.supervisor, redactor) : null
    },
    summary,
    flow: {
      activeVariant,
      variants
    },
    current: {
      gate: currentGate ? gatePayload(currentGate, redactor) : null,
      interruptions,
      nextAction: describeNextAction({ repo, runtime, currentStep: currentStepView ?? currentStep, currentGate, interruptions }),
      notice: buildRuntimeNotice({ events, currentStepId: currentStep?.id ?? null })
    },
    history,
    events,
    git: gitState(repo, redactor),
    tickets,
    ticketRequests: loadPendingTicketStartRequests({ repoPath: repo }),
    documents: {
      note: {
        path: join(repo, "current-note.md"),
        text: clampText(redactor(note.text), MAX_TEXT)
      },
      ticket: {
        path: join(repo, "current-ticket.md"),
        text: clampText(redactor(ticketText), MAX_TEXT)
      },
      ...(optionalDocs.productBrief ? {
        productBrief: {
          path: optionalDocs.productBrief.path,
          text: clampText(optionalDocs.productBrief.text, MAX_TEXT)
        }
      } : {}),
      ...(optionalDocs.epic ? {
        epic: {
          path: optionalDocs.epic.path,
          text: clampText(optionalDocs.epic.text, MAX_TEXT)
        }
      } : {})
    }
  };
}

function collectTickets({ repo, redactor }) {
  const ticketsDir = join(repo, "tickets");
  if (!existsSync(ticketsDir)) {
    return [];
  }
  const items = [];
  const candidatePaths = [];
  for (const entry of readdirSync(ticketsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md" && !entry.name.endsWith("-note.md")) {
      candidatePaths.push(join(ticketsDir, entry.name));
    }
  }
  const doneDir = join(ticketsDir, "done");
  if (existsSync(doneDir)) {
    for (const entry of readdirSync(doneDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md" && !entry.name.endsWith("-note.md")) {
        candidatePaths.push(join(doneDir, entry.name));
      }
    }
  }
  for (const path of candidatePaths) {
    const text = readFileSync(path, "utf8");
    const { meta, body } = parseMarkdownFrontmatter(text);
    const ticketId = basename(path, ".md");
    const notePath = path.replace(/\.md$/u, "-note.md");
    const status = ticketStatus({ path, meta });
    items.push({
      id: ticketId,
      title: firstHeading(body) || ticketId,
      path: relative(repo, path).replaceAll("\\", "/"),
      notePath: existsSync(notePath) ? relative(repo, notePath).replaceAll("\\", "/") : null,
      status,
      priority: Number(meta.priority ?? 999),
      description: String(meta.description ?? "").trim(),
      createdAt: String(meta.created_at ?? "").trim(),
      startedAt: String(meta.started_at ?? "").trim(),
      closedAt: String(meta.closed_at ?? "").trim(),
      body: clampText(redactor(text), MAX_TEXT)
    });
  }
  const rank = { doing: 0, todo: 1, canceled: 2, done: 3 };
  items.sort((a, b) =>
    (rank[a.status] ?? 99) - (rank[b.status] ?? 99)
    || a.priority - b.priority
    || a.id.localeCompare(b.id)
  );
  return items;
}

function parseMarkdownFrontmatter(text) {
  const raw = String(text ?? "");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u);
  if (!match) {
    return { meta: {}, body: raw };
  }
  return {
    meta: parseYaml(match[1]) ?? {},
    body: raw.slice(match[0].length)
  };
}

function firstHeading(text) {
  const match = String(text ?? "").match(/^#{1,6}\s+(.+)$/mu);
  return match ? match[1].trim() : "";
}

function ticketStatus({ path, meta }) {
  if (String(meta.canceled_at ?? "").trim() && String(meta.canceled_at).trim() !== "null") {
    return "canceled";
  }
  if (path.includes("/done/") || (String(meta.closed_at ?? "").trim() && String(meta.closed_at).trim() !== "null")) {
    return "done";
  }
  if (String(meta.started_at ?? "").trim() && String(meta.started_at).trim() !== "null") {
    return "doing";
  }
  return "todo";
}

function loadOptionalRepoDocuments(repo: string, redactor: (value: unknown) => string) {
  const result: AnyRecord = {};
  const productBriefPath = join(repo, "product-brief.md");
  if (existsSync(productBriefPath)) {
    result.productBrief = {
      path: productBriefPath,
      text: redactor(readFileSync(productBriefPath, "utf8"))
    };
  }
  const epicCandidates = ["current-epic.md", "epic.md", "epic.yaml", "epic.yml"]
    .map((name) => join(repo, name));
  const epicPath = epicCandidates.find((candidate) => existsSync(candidate));
  if (epicPath) {
    result.epic = {
      path: epicPath,
      text: redactor(readFileSync(epicPath, "utf8"))
    };
  }
  return result;
}

function buildVariantState({ repo, runtime, variant, history, events, redactor, noteBody, ticketText, ac }) {
  const view = buildFlowView(runtime.flow, variant, runtime.run?.current_step_id ?? null);
  const sequenceSet = new Set(view.sequence);
  const historyByStep = latestHistoryByStep(history);
  const ticketImplementationNotes = redactSection(extractSection(ticketText, "Implementation Notes"), redactor);
  const diffHistory = history
    .filter((entry) => entry.commit && entry.commit !== "-");
  const diffGateIds = view.steps.filter((step) => step.humanGate).map((step) => step.id);
  const diffContext = runtime.run?.id
    ? { runtime, view, history: diffHistory, gateIds: diffGateIds }
    : null;
  const steps = view.steps.map((step, index) => {
    const historyEntry = historyByStep.get(step.id) ?? null;
    const current = runtime.run?.current_step_id === step.id;
    const attempt = runtime.run?.id
      ? latestAttemptResult({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id, provider: step.provider })
      : null;
    const gate = runtime.run?.id ? latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }) : null;
    const interruptions = current && runtime.run?.id
      ? loadStepInterruptions({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }).map((item) => redactObject(item, redactor))
      : [];
    const processState = runtime.run?.id
      ? collectStepProcessState({ runtime, step, attempt })
      : null;
    const progress = stepProgress({
      runtime,
      sequence: view.sequence,
      index,
      step,
      historyEntry,
      gate,
      attempt,
      processState,
      interruptions
    });
    const uiOutput = runtime.run?.id ? loadStepUiOutput({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }) : null;
    const uiRuntime = runtime.run?.id ? loadStepUiRuntime({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }) : null;
    const reviewerOutputs = runtime.run?.id && step.mode === "review"
      ? loadReviewerOutputsForStep({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id })
      : [];
    const assistSignal = runtime.run?.id
      ? loadLatestAssistSignal({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id })
      : null;
    return {
      ...stepMeta(step),
      progress,
      current,
      processState,
      uiContract: step.ui ?? null,
      uiOutput: uiOutput ? redactObject(uiOutput, redactor) : null,
      uiRuntime: uiRuntime ? redactObject(uiRuntime, redactor) : null,
      assistSignal: assistSignal ? redactObject(assistSignal, redactor) : null,
      noteSection: redactSection(resolveStepNoteSection(noteBody, step.id), redactor),
      ticketImplementationNotes,
      acTableText: redactSection(extractSection(noteBody, "AC 裏取り結果"), redactor),
      acSummary: {
        verified: ac.counts?.verified ?? 0,
        deferred: ac.counts?.deferred ?? 0,
        unverified: ac.counts?.unverified ?? 0
      },
      historyEntry,
      latestAttempt: attempt ? redactObject(attempt, redactor) : null,
      gate: gate ? gatePayload(gate, redactor) : null,
      interruptions,
      judgements: runtime.run?.id
        ? loadJudgements({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }).map((judgement) => redactObject(judgement, redactor))
        : [],
      reviewFindings: reviewerOutputs.flatMap((reviewer) =>
        (reviewer.output?.findings ?? [])
          .filter((finding) => ["critical", "major", "minor"].includes(finding.severity))
          .map((finding) => redactObject({
            reviewerId: reviewer.reviewerId,
            reviewerLabel: reviewer.label || reviewer.reviewerId,
            severity: finding.severity,
            title: finding.title,
            evidence: finding.evidence,
            recommendation: finding.recommendation
          }, redactor))
      ),
      reviewDiff: runtime.run?.id ? redactObject(collectDiffPayload({ repo, stepId: step.id, includePatch: false, diffContext }), redactor) : null,
      artifacts: runtime.run?.id ? listStepArtifacts({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id, redactor }) : [],
      events: events.filter((event) => event.stepId === step.id).slice(-12)
    };
  });
  const skippedSteps = runtime.flow.variants?.full?.sequence?.filter((stepId) => !sequenceSet.has(stepId)) ?? [];
  return {
    id: view.id,
    variant,
    count: steps.length,
    initial: view.initial,
    sequence: view.sequence,
    mermaid: renderMermaidFlow(runtime.flow, variant, runtime.run?.current_step_id ?? null),
    overview: buildOverview({ runtime, variant, steps }),
    steps,
    skippedSteps
  };
}

function buildOverview({ runtime, variant, steps }) {
  const groups = [
    { id: "start", label: "Start", title: "開始", stepIds: [] },
    { id: "plan", label: "Plan", title: "計画", stepIds: variant === "full" ? ["PD-C-2", "PD-C-3", "PD-C-4", "PD-C-5"] : ["PD-C-3", "PD-C-5"] },
    { id: "implement", label: "Build", title: "実装", stepIds: ["PD-C-6"] },
    { id: "review", label: "Review", title: "検証", stepIds: variant === "full" ? ["PD-C-7", "PD-C-8", "PD-C-9"] : ["PD-C-7", "PD-C-9"] },
    { id: "close", label: "Close", title: "完了承認", stepIds: ["PD-C-10"] },
    { id: "done", label: "End", title: "完了", stepIds: [] }
  ];
  return groups.map((group, index) => {
    if (group.id === "start") {
      return {
        ...group,
        state: runtime.run ? "done" : "pending"
      };
    }
    if (group.id === "done") {
      return {
        ...group,
        state: runtime.run?.status === "completed" ? "done" : "pending"
      };
    }
    const related = steps.filter((step) => group.stepIds.includes(step.id));
    if (related.some((step) => step.progress.status === "failed")) {
      return { ...group, state: "waiting" };
    }
    if (related.every((step) => step.progress.status === "done")) {
      return { ...group, state: "done" };
    }
    if (related.some((step) => step.current || step.progress.status === "running")) {
      return { ...group, state: "running" };
    }
    if (related.some((step) => step.progress.status === "waiting" || step.progress.status === "blocked")) {
      return { ...group, state: "waiting" };
    }
    const beforeCurrent = steps.findIndex((step) => step.current);
    const relatedIndex = Math.min(...related.map((step) => steps.findIndex((item) => item.id === step.id)).filter((value) => value >= 0));
    return { ...group, state: beforeCurrent >= 0 && relatedIndex < beforeCurrent ? "done" : "pending" };
  });
}

function buildSummary({ runtime, activeVariant, ac, currentStep, currentGate, interruptions }) {
  const doneCount = activeVariant.steps.filter((step) => step.progress.status === "done").length;
  const total = activeVariant.steps.length;
  const openItems = [
    runtime.run?.status === "needs_human" ? 1 : 0,
    interruptions.length > 0 ? 1 : 0,
    runtime.run?.status === "blocked" ? 1 : 0,
    runtime.run?.status === "failed" ? 1 : 0
  ].reduce((sum, value) => sum + value, 0);
  return {
    doneCount,
    totalSteps: total,
    acCounts: ac.counts,
    openItems,
    gateStatus: currentGate?.decision ?? currentGate?.status ?? null
  };
}

function collectStepProcessState({ runtime, step, attempt }) {
  const topLevel = collectTopLevelRuntimeProcessState({ runtime, step });
  if (topLevel) {
    return topLevel;
  }
  const stateDir = runtime.stateDir;
  const runId = runtime.run?.id;
  if (!runId) {
    return {
      activeCount: 0,
      stale: false,
      active: [],
      dead: [],
      note: ""
    };
  }
  const entries = collectTrackedProcessEntries({ stateDir, runId, step, attempt });
  if (!entries.length) {
    return {
      activeCount: 0,
      stale: false,
      active: [],
      dead: [],
      note: ""
    };
  }
  const active = entries.filter((entry) => entry.alive);
  const dead = entries.filter((entry) => !entry.alive);
  if (active.length > 0) {
    return {
      activeCount: active.length,
      stale: false,
      active,
      dead,
      note: active.length === 1
        ? `${active[0].label} が実行中です。`
        : `${active.length} 個の provider process が実行中です。`
    };
  }
  return {
    activeCount: 0,
    stale: true,
    active,
    dead,
    note: dead.length === 1
      ? `${dead[0].label} は終了しています。runtime の state が stale です。`
      : `${dead.length} 個の provider process はすでに終了しています。runtime の state が stale です。`
  };
}

function collectTopLevelRuntimeProcessState({ runtime, step }) {
  const run = runtime.run;
  const supervisor = runtime.supervisor;
  if (!run?.id || run.status !== "running" || !supervisor || step.id !== run.current_step_id) {
    return null;
  }
  if (supervisor.runId !== run.id) {
    return null;
  }
  const pid = Number(supervisor.pid);
  const label = String(supervisor.command || "runtime");
  const baseEntry = Number.isInteger(pid) && pid > 0
    ? [{ label, pid, alive: supervisor.status === "running", kind: "runtime" }]
    : [];
  if (supervisor.status === "running") {
    return null;
  }
  if (supervisor.status === "stale") {
    return {
      activeCount: 0,
      stale: true,
      scope: "runtime",
      active: [],
      dead: baseEntry.length > 0 ? baseEntry : [{ label, pid: null, alive: false, kind: "runtime" }],
      note: `${label} は終了しています。runtime の state が stale です。`
    };
  }
  return null;
}

function collectTrackedProcessEntries({ stateDir, runId, step, attempt }) {
  const tracked = listTrackedProcesses({ stateDir, runId, stepId: step.id })
    .filter((entry) => entry.status === "running")
    .map((entry) => ({
      label: entry.label || entry.provider || entry.kind || "process",
      kind: entry.kind || null,
      pid: Number(entry.pid),
      alive: Number.isInteger(Number(entry.pid)) && Number(entry.pid) > 0 ? isPidAlive(Number(entry.pid)) : false,
      startedAt: entry.startedAt || null
    }))
    .filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0);
  if (tracked.length > 0) {
    return tracked;
  }
  return step.mode === "review"
    ? collectReviewProcessEntries({ stateDir, runId, stepId: step.id })
    : collectProviderProcessEntries({ attempt });
}

function collectProviderProcessEntries({ attempt }) {
  const pid = Number(attempt?.pid);
  if (!Number.isInteger(pid) || pid <= 0 || attempt?.status !== "running") {
    return [];
  }
  return [{
    label: attempt.provider || "provider",
    pid,
    alive: isPidAlive(pid)
  }];
}

function collectReviewProcessEntries({ stateDir, runId, stepId }) {
  const root = join(stateDir, "runs", runId, "steps", stepId, "review-rounds");
  if (!existsSync(root)) {
    return [];
  }
  const entries = [];
  for (const roundEntry of readdirSync(root, { withFileTypes: true })) {
    if (!roundEntry.isDirectory() || !/^round-\d+$/.test(roundEntry.name)) {
      continue;
    }
    const roundDir = join(root, roundEntry.name);
    const reviewersDir = join(roundDir, "reviewers");
    if (existsSync(reviewersDir)) {
      for (const reviewerEntry of readdirSync(reviewersDir, { withFileTypes: true })) {
        if (!reviewerEntry.isDirectory()) {
          continue;
        }
        const reviewerDir = join(reviewersDir, reviewerEntry.name);
        for (const attemptEntry of readdirSync(reviewerDir, { withFileTypes: true })) {
          if (!attemptEntry.isDirectory() || !/^attempt-\d+$/.test(attemptEntry.name)) {
            continue;
          }
          const result = safeReadJson(join(reviewerDir, attemptEntry.name, "result.json"));
          const pid = Number(result?.pid);
          if (result?.status === "running" && Number.isInteger(pid) && pid > 0) {
            entries.push({
              label: `${reviewerEntry.name} (${roundEntry.name})`,
              pid,
              alive: isPidAlive(pid)
            });
          }
        }
      }
    }
    const repair = safeReadJson(join(roundDir, "repair-result.json"));
    const repairPid = Number(repair?.pid);
    if (repair?.status === "running" && Number.isInteger(repairPid) && repairPid > 0) {
      entries.push({
        label: `repair (${roundEntry.name})`,
        pid: repairPid,
        alive: isPidAlive(repairPid)
      });
    }
  }
  return entries;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Detects "stuck running": runtime.json says running, but no supervisor
// is alive and no provider attempt has actually completed for this step.
// Typically happens when a previous bug pointed run-next at the wrong
// repo so it exited without producing artifacts. The user needs Run
// Next (or Resume) to unstick. We tell apart "in-flight" (supervisor
// running) from "stuck" (supervisor missing/exited + no activity) so
// the UI doesn't lie about it.
function isRuntimeStuck({ runtime, step, processState }) {
  const run = runtime.run;
  if (!run || run.status !== "running") return false;
  // humanGate steps end the supervisor cleanly while waiting for the
  // human — that is the gate's normal idle state, not a stuck runtime.
  if (step.humanGate) return false;
  const supervisor = runtime.supervisor;
  const supRunning = supervisor?.status === "running"
    && Number.isInteger(Number(supervisor.pid))
    && Number(supervisor.pid) > 0
    && isPidAlive(Number(supervisor.pid));
  if (supRunning) return false;
  if (processState?.activeCount > 0) return false;
  if (step.provider === "runtime") return false;
  if (run.id && hasCompletedProviderAttempt({
    stateDir: runtime.stateDir,
    runId: run.id,
    stepId: step.id,
    provider: step.provider
  })) return false;
  return true;
}

// Decision table for step.progress.status. Order matters — the first
// row whose `match` returns truthy wins. `out` builds the
// {status, note} payload, optionally using the matched value via the
// returned object. Each row is intentionally a single-line predicate
// + single-line builder so adding/auditing a case is local.
const STEP_PROGRESS_PRECONDITION_RULES = [
  {
    match: (ctx) => !ctx.sequence.includes(ctx.step.id),
    out: () => progress("skipped", "選択中 variant では実行しない step です。")
  },
  {
    match: (ctx) => !ctx.runtime.run,
    out: () => progress("pending", "まだ run が始まっていません。")
  },
  {
    match: (ctx) => ctx.runtime.run.status === "completed",
    out: () => progress("done", "この run は完了しています。")
  }
];

const STEP_PROGRESS_CURRENT_RULES = [
  {
    match: (ctx) => ctx.runtime.run.status === "running" && ctx.processState?.stale,
    out: (ctx) => progress("failed", ctx.processState.note || "provider process is no longer alive.")
  },
  {
    match: (ctx) => ctx.runtime.run.status === "needs_human" && ctx.gate?.proposal?.status === "pending",
    out: () => progress("waiting", "agent proposal を適用するか、Open Terminal で再作業するかを選びます。")
  },
  {
    match: (ctx) => ctx.runtime.run.status === "needs_human",
    out: () => progress("waiting", "判断材料を確認して Web で判断します。")
  },
  {
    match: (ctx) => ctx.runtime.run.status === "interrupted",
    out: (ctx) => progress("waiting", ctx.interruptions.length > 0 ? "質問に回答すると継続します。" : "割り込み回答待ちです。")
  },
  {
    match: (ctx) => ctx.runtime.run.status === "blocked",
    out: () => progress("blocked", "必要な記録や検証を追加してから `run-next` を再実行します。")
  },
  {
    match: (ctx) => ctx.runtime.run.status === "failed",
    out: () => progress("failed", "provider の再実行または resume が必要です。")
  },
  {
    // Provider already finished — the next run-next will run guards and advance.
    match: (ctx) => ctx.step.provider !== "runtime"
      && ctx.runtime.run.id
      && hasCompletedProviderAttempt({ stateDir: ctx.runtime.stateDir, runId: ctx.runtime.run.id, stepId: ctx.step.id, provider: ctx.step.provider }),
    out: () => progress("waiting", "`run-next` で guard 評価と遷移を進めます。")
  },
  {
    match: (ctx) => ctx.processState?.activeCount > 0,
    out: (ctx) => progress("running", ctx.processState.note || "provider がこの step を実行しています。")
  },
  {
    // humanGate steps idle in run.status=running waiting for the
    // human. Treat as needs_human-style wait, not "stuck" — otherwise
    // FailureCard / 自動診断 shows up on a normal gate.
    match: (ctx) => ctx.step.humanGate && ctx.runtime.run.status === "running",
    out: () => progress("waiting", "human gate です。Web で承認・差し戻し・棄却を選びます。")
  },
  {
    // The previous supervisor exited (ssh disconnect, OOM, …) without
    // finishing the step. The abandon-and-respawn model means the
    // next run-next will spawn attempt-(N+1); surface this as
    // "interrupted" rather than failed/blocked so we don't trigger
    // the diagnose-this-failure UX that doesn't apply.
    match: (ctx) => ctx.runtime.run.status === "running"
      && isRuntimeStuck({ runtime: ctx.runtime, step: ctx.step, processState: ctx.processState }),
    out: () => progress("interrupted", "supervisor が exited しています。Run Next で新しい attempt を spawn して再開できます。")
  }
];

const STEP_PROGRESS_NON_CURRENT_RULES = [
  {
    match: (ctx) => Boolean(ctx.historyEntry),
    out: (ctx) => progress("done", ctx.historyEntry.summary)
  },
  {
    match: (ctx) => {
      const i = ctx.sequence.indexOf(ctx.runtime.run.current_step_id);
      return i >= 0 && ctx.index < i;
    },
    out: () => progress("done", "履歴行がなくても先行 step とみなします。")
  },
  {
    match: (ctx) => ctx.attempt?.status === "failed",
    out: () => progress("failed", "最新 attempt が失敗しています。")
  }
];

function stepProgress({ runtime, sequence, index, step, historyEntry, gate, attempt, processState, interruptions }) {
  const ctx = { runtime, sequence, index, step, historyEntry, gate, attempt, processState, interruptions };
  for (const rule of STEP_PROGRESS_PRECONDITION_RULES) {
    if (rule.match(ctx)) return (rule.out as (ctx: AnyRecord) => AnyRecord)(ctx);
  }
  if (step.id === runtime.run.current_step_id) {
    for (const rule of STEP_PROGRESS_CURRENT_RULES) {
      if (rule.match(ctx)) return (rule.out as (ctx: AnyRecord) => AnyRecord)(ctx);
    }
    return progress("running", "provider がこの step を実行しています。");
  }
  for (const rule of STEP_PROGRESS_NON_CURRENT_RULES) {
    if (rule.match(ctx)) return rule.out(ctx);
  }
  return progress("pending", "前段 step の完了後に自動で開始されます。");
}

function progress(status, note = "") {
  return { status, note };
}

function latestHistoryByStep(entries) {
  const map = new Map();
  for (const entry of entries) {
    map.set(entry.stepId, entry);
  }
  return map;
}

function stepMeta(step) {
  const meta: Record<string, unknown> = {
    id: step.id,
    label: step.label ?? step.id,
    summary: step.summary ?? "",
    provider: step.provider,
    mode: step.mode,
    role: step.role ?? null,
    display: step.display ?? null,
    humanGate: Boolean(step.humanGate)
  };
  // For review-mode steps, expose the variant-resolved aggregator/repair
  // providers + reviewer roster so the web composition editor can render
  // defaults and detect which fields the user has overridden.
  if (step.mode === "review" && step.review) {
    meta.aggregatorProvider = step.review.aggregatorProvider || null;
    meta.repairProvider = step.review.repairProvider || null;
    meta.reviewers = (step.review.reviewers ?? []).map((reviewer) => ({
      role: reviewer.roleId,
      label: reviewer.label,
      providers: Array.isArray(reviewer.providers) ? reviewer.providers : []
    }));
  }
  return meta;
}

function resolveStepNoteSection(noteBody, stepId) {
  let heading = "";
  try {
    heading = String(getStep(loadFlow(), stepId)?.noteSection ?? "");
  } catch {
    heading = "";
  }
  return heading ? extractSection(noteBody, heading) ?? "" : "";
}

function redactSection(text, redactor) {
  return clampText(redactor(String(text ?? "")), 16000);
}

// Decision table for the "what should the user do next?" card. Order
// matters: rows are evaluated top-to-bottom and the first match wins.
// Returning null means "show no card" (the supervisor is mid-step or
// the provider is actively working). Each row's match() reads only
// from ctx; out() returns the {title, body, actions} payload.
const NEXT_ACTION_RULES = [
  {
    // No active run yet — offer the initial start card.
    match: (ctx) => !ctx.runtime.run || !ctx.currentStep,
    out: (ctx) => {
      const card = cardFromYaml(ctx.cards, "initial");
      return { title: card.title, body: card.body, actions: [actionFromYaml(ctx.labels, "run")] };
    }
  },
  {
    // The run-next supervisor is alive — a runtime / provider call is
    // in flight. Suppress manual actions: pressing Run Next here would
    // race the in-flight run, and Open Terminal would force-reprompt
    // the running provider. The polling stream refreshes once the
    // supervisor finishes or hands off to a gate.
    match: (ctx) => ctx.runtime.run.status === "running"
      && ctx.runtime.supervisor?.status === "running"
      && Number.isInteger(Number(ctx.runtime.supervisor?.pid))
      && Number(ctx.runtime.supervisor.pid) > 0
      && isPidAlive(Number(ctx.runtime.supervisor.pid)),
    out: (ctx) => {
      const card = cardFromYaml(ctx.cards, "inFlight", {
        stepId: ctx.currentStep.id,
        command: ctx.runtime.supervisor.command || "runtime",
        pid: ctx.runtime.supervisor.pid
      });
      return { title: card.title, body: card.body, actions: [] };
    }
  },
  {
    // runtime.json says running but no supervisor / no provider is
    // actually working. Recovery: Run Next will spawn a fresh
    // supervisor against this worktree.
    match: (ctx) => isRuntimeStuck({ runtime: ctx.runtime, step: ctx.currentStep, processState: ctx.currentStep.processState }),
    out: (ctx) => {
      const card = cardFromYaml(ctx.cards, "stuck", {
        stepId: ctx.currentStep.id,
        supervisorStatus: ctx.runtime.supervisor?.status ?? "missing"
      });
      return {
        title: card.title,
        body: card.body,
        actions: [
          actionFromYaml(ctx.labels, "runNextStuck", { tone: "approve", kind: "run_next_direct" }),
          actionFromYaml(ctx.labels, "openTerminalStuck", { tone: "neutral", kind: "assist" })
        ]
      };
    }
  },
  {
    match: (ctx) => ctx.runtime.run.status === "needs_human",
    out: (ctx) => {
      const card = cardFromYaml(ctx.cards, "needsHuman", { stepId: ctx.currentStep.id });
      return {
        title: card.title,
        body: ctx.currentGate?.proposal?.status === "pending"
          ? proposalBody(ctx.currentGate.proposal, ctx.currentStep.id)
          : card.body,
        actions: humanDecisionActions(ctx.currentStep, ctx.labels)
      };
    }
  },
  {
    // humanGate step has finished its provider attempt but run.status
    // stays "running" until the human approves / rejects. Without this
    // rule the next-action falls through to the generic "Run Next"
    // path, which re-spawns the provider on a step it already finished
    // and trips PD-C-N exhausted-max-attempts. Surface the decision
    // buttons instead.
    match: (ctx) => ctx.currentStep?.humanGate === true
      && ctx.runtime.run.status === "running"
      && ctx.currentStep?.progress?.status === "waiting",
    out: (ctx) => {
      const card = cardFromYaml(ctx.cards, "needsHuman", { stepId: ctx.currentStep.id });
      return {
        title: card.title,
        body: ctx.currentGate?.proposal?.status === "pending"
          ? proposalBody(ctx.currentGate.proposal, ctx.currentStep.id)
          : card.body,
        actions: humanDecisionActions(ctx.currentStep, ctx.labels)
      };
    }
  },
  {
    match: (ctx) => ctx.interruptions.length > 0 || ctx.runtime.run.status === "interrupted",
    out: (ctx) => {
      const card = cardFromYaml(ctx.cards, "interrupt", { stepId: ctx.currentStep.id });
      return { title: card.title, body: card.body, actions: interruptAnswerActions(ctx.labels) };
    }
  },
  {
    match: (ctx) => ctx.runtime.run.status === "failed",
    out: (ctx) => {
      const card = cardFromYaml(ctx.cards, "failed", { stepId: ctx.currentStep.id });
      return {
        title: card.title,
        body: failedActionBody(ctx.currentStep),
        actions: [actionFromYaml(ctx.labels, "openTerminalFailed", { tone: "neutral", kind: "assist" })]
      };
    }
  },
  {
    // Provider attempt completed cleanly, no live process — next
    // run-next will run guards and fire on_success.
    match: (ctx) => ctx.runtime.run.status === "running"
      && ctx.currentStep.provider !== "runtime"
      && ctx.runtime.run.id
      && hasCompletedProviderAttempt({
        stateDir: ctx.runtime.stateDir,
        runId: ctx.runtime.run.id,
        stepId: ctx.currentStep.id,
        provider: ctx.currentStep.provider
      })
      && !ctx.currentStep?.processState?.activeCount,
    out: (ctx) => {
      const card = cardFromYaml(ctx.cards, "advance", { stepId: ctx.currentStep.id });
      return {
        title: card.title,
        body: card.body,
        actions: [
          actionFromYaml(ctx.labels, "runNextAdvance", { tone: "approve", kind: "run_next_direct" }),
          actionFromYaml(ctx.labels, "openTerminalAdvance", { tone: "neutral", kind: "assist" })
        ]
      };
    }
  },
  {
    match: (ctx) => ctx.runtime.run.status === "running" && ctx.currentStep?.processState?.stale,
    out: (ctx) => {
      const card = cardFromYaml(ctx.cards, "stale", { stepId: ctx.currentStep.id });
      return {
        title: card.title,
        body: ctx.currentStep.processState.note || card.bodyFallback,
        actions: [
          actionFromYaml(ctx.labels, "openTerminalStale", { tone: "neutral", kind: "assist" }),
          actionFromYaml(ctx.labels, "resume", { tone: "revise", kind: "resume_direct" })
        ]
      };
    }
  },
  {
    match: (ctx) => ctx.runtime.run.status === "blocked",
    out: (ctx) => {
      const card = cardFromYaml(ctx.cards, "blocked", { stepId: ctx.currentStep.id });
      return {
        title: card.title,
        body: blockedActionBody(ctx.currentStep),
        actions: [
          actionFromYaml(ctx.labels, "openTerminalBlocked", { tone: "neutral", kind: "assist" }),
          actionFromYaml(ctx.labels, "runNextBlocked", { tone: "revise", kind: "run_next_direct" })
        ]
      };
    }
  },
  {
    // Provider is actively working — show no card; the polling stream
    // will surface the inFlight card once the supervisor catches up.
    match: (ctx) => ctx.runtime.run.status === "running" && ctx.currentStep?.processState?.activeCount > 0,
    out: () => null
  }
];

function describeNextAction({ repo, runtime, currentStep, currentGate, interruptions }) {
  const ctx = {
    repo,
    runtime,
    currentStep,
    currentGate,
    interruptions,
    labels: runtime.flow?.actionLabels ?? {},
    cards: runtime.flow?.actionCards ?? {}
  };
  for (const rule of NEXT_ACTION_RULES) {
    if (rule.match(ctx)) return rule.out(ctx);
  }
  // Default fallthrough: generic "Run Next / Open Terminal" pair.
  const card = cardFromYaml(ctx.cards, "default", { stepId: currentStep.id });
  return {
    title: card.title,
    body: card.body,
    actions: [
      actionFromYaml(ctx.labels, "runNext", { tone: "approve", kind: "run_next_direct" }),
      actionFromYaml(ctx.labels, "openTerminal", { tone: "neutral", kind: "assist" })
    ]
  };
}

function blockedActionBody(step) {
  const failed = Array.isArray(step?.uiRuntime?.guards) ? step.uiRuntime.guards.filter((guard) => guard.status === "failed") : [];
  const first = failed[0];
  if (!first) {
    return "必須 guard が不足しています。詳細を確認して `run-next` を再実行します。";
  }
  const evidence = String(first.evidence || "");
  if (/ui-output\.yaml has parse errors/i.test(evidence)) {
    return "provider は完了していますが、ui-output.json の構文エラーで review judgement を guard 用 artifact に落とせていません。通常は `run-next` の再実行で補完されます。繰り返す場合は ui-output.json を確認します。";
  }
  if (/present in ui-output\.yaml/i.test(evidence)) {
    return "provider は judgement 自体を書いていますが、guard が読む judgement artifact が不足しています。通常は `run-next` の再実行で補完されます。繰り返す場合は ui-output.json と judgements/ を確認します。";
  }
  if (/provider step completed/i.test(evidence)) {
    return "provider step は完了していますが、guard が必要とする structured evidence が不足しています。step artifacts を確認してから `run-next` を再実行します。";
  }
  return `必須 guard が不足しています: ${evidence || first.id || first.guardId || "unknown"}`;
}

function failedActionBody(step) {
  const authMismatch = failedAuthMismatchText(step);
  if (authMismatch) {
    return authMismatch;
  }
  const findings = Array.isArray(step?.reviewFindings) ? step.reviewFindings : [];
  const topFinding = findings.find((finding) => finding.severity === "critical" || finding.severity === "major") ?? findings[0];
  if (topFinding) {
    return `reviewer batch の一部が失敗しましたが、残っている指摘があります。先に「${topFinding.title || "review finding"}」へ対応してから Resume で ${step.id} を再実行します。`;
  }
  return "失敗 summary を確認し、必要なら Open Terminal で修正してから `resume` を再実行します。";
}

function failedAuthMismatchText(step) {
  const finalMessage = String(step?.uiRuntime?.latestAttempt?.finalMessage || "");
  if (/not logged in/i.test(finalMessage) && step?.provider === "claude" && step?.mode === "review") {
    return "Claude reviewer subprocess は現在の launch mode で認証を見失っています。interactive Claude や通常の `claude -p` が動いても、reviewer batch だけ落ちることがあります。runtime 側では reviewer の bare 起動をやめる修正を入れたので、まず同じ step を再実行してください。";
  }
  return "";
}

function gatePayload(gate, redactor) {
  return redactObject(gate, redactor);
}

function buildRuntimeNotice({ events, currentStepId }) {
  if (!currentStepId || !events?.length) return null;
  const stepEvents = events.filter((e) => e.stepId === currentStepId);
  if (!stepEvents.length) return null;
  const noticeTypes = new Set([
    "assist_escalation_opened",
    "run_failed",
    "guard_failed",
    "human_gate_recommendation_failed",
    "human_gate_proposal_failed"
  ]);
  const resetTypes = new Set([
    "human_gate_resolved",
    "step_finished",
    "human_gate_proposal_accepted",
    "human_gate_proposal_declined",
    "assist_continue_accepted"
  ]);
  let latestNotice = null;
  for (const e of stepEvents) {
    if (resetTypes.has(e.type)) {
      latestNotice = null;
      continue;
    }
    if (noticeTypes.has(e.type)) {
      latestNotice = e;
    }
  }
  if (!latestNotice) return null;
  const failedGuards =
    latestNotice.payload?.failedGuards
    ?? (Array.isArray(latestNotice.payload?.failed)
      ? latestNotice.payload.failed.map((g) => g?.guardId ?? g?.id ?? null).filter(Boolean)
      : null);
  return {
    kind: latestNotice.type,
    stepId: latestNotice.stepId,
    ts: latestNotice.ts,
    message: latestNotice.message ?? null,
    escalation: latestNotice.payload?.escalation ?? null,
    failedGuards: failedGuards ?? null,
    detail: latestNotice.payload?.message ?? null
  };
}

function listStepArtifacts({ stateDir, runId, stepId, redactor }) {
  const dir = stepDir(stateDir, runId, stepId);
  if (!existsSync(dir)) {
    return [];
  }
  const artifacts = [];
  visitArtifacts(dir, artifacts, dir);
  return artifacts
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((artifact) => redactObject(artifact, redactor))
    .slice(0, 40);
}

function visitArtifacts(dir, artifacts, root) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      visitArtifacts(fullPath, artifacts, root);
      continue;
    }
    artifacts.push({
      name: fullPath.slice(root.length + 1),
      path: fullPath,
      size: safeSize(fullPath)
    });
  }
}

function collectMermaid({ repo, variant = null }) {
  const runtime = loadRuntime(repo, { normalizeStaleRunning: true });
  return renderMermaidFlow(runtime.flow, variant ?? runtime.run?.flow_variant ?? "full", runtime.run?.current_step_id ?? null);
}

function collectArtifactPayload({ repo, stepId, name }) {
  const runtime = loadRuntime(repo, { normalizeStaleRunning: true });
  const runId = runtime.run?.id;
  if (!runId || !stepId || !name) {
    return null;
  }
  const redactor = createRedactor({ repoPath: repo });
  const dir = stepDir(runtime.stateDir, runId, stepId);
  if (!existsSync(dir)) {
    return null;
  }
  const resolvedName = String(name);
  const fullPath = resolve(dir, resolvedName);
  if (!(fullPath === dir || fullPath.startsWith(`${dir}/`)) || !existsSync(fullPath)) {
    return null;
  }
  const extension = extname(fullPath).toLowerCase();
  if (!TEXT_ARTIFACT_EXTENSIONS.has(extension)) {
    return {
      name: resolvedName,
      path: redactor(fullPath),
      size: safeSize(fullPath),
      text: "This artifact is not rendered in the web viewer.",
      markdown: false
    };
  }
  return {
    name: resolvedName,
    path: redactor(fullPath),
    size: safeSize(fullPath),
    text: safeReadText(fullPath, redactor),
    markdown: MARKDOWN_EXTENSIONS.has(extension)
  };
}

function collectPromptPayload({ repo, stepId }) {
  if (!stepId) return null;
  let runtime;
  try {
    runtime = loadRuntime(repo, { normalizeStaleRunning: true });
  } catch {
    return null;
  }
  const run = runtime.run;
  if (!run) return null;
  const flow = runtime.flow;
  let step;
  try {
    step = getStep(flow, stepId);
  } catch {
    return null;
  }
  const variant = run.flow_variant ?? "full";
  const redactor = createRedactor({ repoPath: repo });
  const interruptions = loadStepInterruptions({ stateDir: runtime.stateDir, runId: run.id, stepId });
  // Steps outside the active variant (e.g. PD-C-4 / PD-C-8 during a
  // `light` run) won't resolve in the current view; fall back to `full`
  // so we can still preview their prompts.
  const reviewPlan = resolveStepReviewPlan(flow, variant, stepId)
    ?? (variant !== "full" ? resolveStepReviewPlan(flow, "full", stepId) : null);
  const isReview = step.mode === "review" && Boolean(reviewPlan?.reviewers?.length);
  const prompts: AnyRecord[] = [];

  if (!isReview && step.provider !== "runtime") {
    try {
      const body = renderStepPrompt({ repoPath: repo, run, flow, step, interruptions });
      prompts.push({
        kind: "step",
        label: "実行プロンプト",
        provider: step.provider ?? null,
        body: redactor(body)
      });
    } catch (err) {
      prompts.push({ kind: "step", label: "実行プロンプト", error: (err as Error).message });
    }
  }

  if (isReview) {
    const instances = expandReviewerInstances(reviewPlan);
    for (const reviewer of instances) {
      try {
        const body = renderReviewerPrompt({
          repoPath: repo,
          run,
          flow,
          step,
          reviewPlan,
          reviewer,
          round: null,
          priorFindings: []
        });
        prompts.push({
          kind: "reviewer",
          reviewerId: reviewer.reviewerId,
          label: `Reviewer: ${reviewer.label || reviewer.reviewerId}`,
          provider: reviewer.provider,
          body: redactor(body)
        });
      } catch (err) {
        prompts.push({
          kind: "reviewer",
          reviewerId: reviewer.reviewerId,
          label: `Reviewer: ${reviewer.label || reviewer.reviewerId}`,
          error: (err as Error).message
        });
      }
    }
    try {
      const body = renderReviewRepairPrompt({
        repoPath: repo,
        run,
        flow,
        step,
        reviewPlan,
        aggregate: { findings: [] },
        round: 1,
        provider: reviewPlan.repairProvider || ""
      });
      prompts.push({
        kind: "repair",
        label: "Repair (loop)",
        provider: reviewPlan.repairProvider || null,
        body: redactor(body)
      });
    } catch (err) {
      prompts.push({ kind: "repair", label: "Repair (loop)", error: (err as Error).message });
    }
  }

  if (prompts.length === 0) return null;
  return { stepId, prompts };
}

function buildDiffContext({ repo, runtime: preloaded = null }) {
  const runtime = preloaded ?? loadRuntime(repo, { normalizeStaleRunning: true });
  const run = runtime.run;
  if (!run?.id) {
    return null;
  }
  const variant = run.flow_variant ?? runtime.pdh.variant ?? "full";
  const view = buildFlowView(runtime.flow, variant, run.current_step_id ?? null);
  const history = parseStepHistory(runtime.note.body).entries
    .filter((entry) => entry.commit && entry.commit !== "-");
  const gateIds = view.steps.filter((step) => step.humanGate).map((step) => step.id);
  return { runtime, view, history, gateIds };
}

function resolveDiffBaseline({ repo, stepId, diffContext = null }) {
  const ctx = diffContext ?? buildDiffContext({ repo });
  if (!ctx) {
    return null;
  }
  const { runtime, view, history, gateIds } = ctx;
  const run = runtime.run;
  if (!run?.id || !stepId) {
    return null;
  }
  const stepIndex = view.sequence.indexOf(stepId);
  if (stepIndex < 0) {
    return null;
  }
  const anchorGateId = gateIds.includes(stepId)
    ? stepId
    : gateIds.filter((id) => view.sequence.indexOf(id) < stepIndex).at(-1) ?? null;
  const anchorGate = anchorGateId
    ? latestHumanGate({ stateDir: runtime.stateDir, runId: run.id, stepId: anchorGateId })
    : null;

  let baseRef = null;
  let baseLabel = null;
  let baseCommit = null;

  if (anchorGate?.baseline?.commit) {
    baseRef = anchorGate.baseline.commit;
    baseCommit = anchorGate.baseline.commit;
    baseLabel = anchorGate.baseline.step_id
      ? `${anchorGateId} gate baseline (${anchorGate.baseline.step_id})`
      : "ticket start";
  } else if (!anchorGateId) {
    const firstCommit = history
      .filter((entry) => {
        const index = view.sequence.indexOf(entry.stepId);
        return index >= 0 && index < stepIndex;
      })
      .sort((left, right) => view.sequence.indexOf(left.stepId) - view.sequence.indexOf(right.stepId))[0];
    if (!firstCommit) {
      baseRef = currentHead(repo) ?? "HEAD";
      baseLabel = "ticket start";
      baseCommit = currentHead(repo);
    } else {
      baseRef = parentCommit(repo, firstCommit.commit) ?? emptyTreeHash(repo);
      baseLabel = "ticket start";
      baseCommit = firstCommit.commit;
    }
  } else if (gateIds.indexOf(anchorGateId) === 0) {
    const firstCommit = history
      .filter((entry) => {
        const index = view.sequence.indexOf(entry.stepId);
        return index >= 0 && index < stepIndex;
      })
      .sort((left, right) => view.sequence.indexOf(left.stepId) - view.sequence.indexOf(right.stepId))[0];
    if (!firstCommit) {
      baseRef = currentHead(repo) ?? "HEAD";
      baseLabel = "ticket start";
      baseCommit = currentHead(repo);
    } else {
      baseRef = parentCommit(repo, firstCommit.commit) ?? emptyTreeHash(repo);
      baseLabel = "ticket start";
      baseCommit = firstCommit.commit;
    }
  } else {
    const gateIndex = gateIds.indexOf(anchorGateId);
    const previousGateId = gateIds[gateIndex - 1];
    const previousGateIndex = view.sequence.indexOf(previousGateId);
    const baseline = history
      .filter((entry) => {
        const index = view.sequence.indexOf(entry.stepId);
        return index >= 0 && index < previousGateIndex;
      })
      .sort((left, right) => view.sequence.indexOf(left.stepId) - view.sequence.indexOf(right.stepId))
      .at(-1);
    if (!baseline) {
      return null;
    }
    baseRef = baseline.commit;
    const previousGateIsFirst = gateIds.indexOf(previousGateId) === 0;
    baseLabel = previousGateIsFirst ? `${previousGateId} gate baseline (ticket start)` : `${previousGateId} gate baseline`;
    baseCommit = baseline.commit;
  }

  return {
    baseRef,
    baseLabel,
    baseCommit
  };
}

function collectDiffPayload({ repo, stepId, includePatch = true, diffContext = null }) {
  const baseline = resolveDiffBaseline({ repo, stepId, diffContext });
  if (!baseline) {
    return null;
  }
  const { baseRef, baseLabel, baseCommit } = baseline;

  const stat = runGit(repo, ["diff", "--stat", baseRef, "--"]);
  const files = runGit(repo, ["diff", "--name-only", baseRef, "--"]);
  let patch = null;
  if (includePatch) {
    const diff = runGit(repo, ["diff", "--no-ext-diff", "--submodule=diff", "--unified=3", baseRef, "--"]);
    patch = clampText(diff.stdout, MAX_TEXT);
  }

  return {
    stepId,
    baseLabel,
    baseCommit: baseCommit ? baseCommit.slice(0, 7) : null,
    diffStat: splitLines(stat.stdout),
    changedFiles: splitLines(files.stdout),
    patch
  };
}

function resolveRepoFilePath(repo, relativePath) {
  if (!relativePath) {
    return null;
  }
  const fullPath = resolve(repo, relativePath);
  if (fullPath !== repo && !fullPath.startsWith(`${repo}/`)) {
    return null;
  }
  return existsSync(fullPath) ? fullPath : null;
}

function collectRepoFilePayload({ repo, stepId, path }) {
  const fullPath = resolveRepoFilePath(repo, path);
  if (!fullPath) {
    return null;
  }
  const baseline = resolveDiffBaseline({ repo, stepId });
  const redactor = createRedactor({ repoPath: repo });
  const relativePath = String(path).replace(/^\.\/+/, "");
  const patch = baseline
    ? clampText(runGit(repo, ["diff", "--no-ext-diff", "--submodule=diff", "--unified=3", baseline.baseRef, "--", relativePath]).stdout, MAX_TEXT)
    : "";
  return {
    stepId,
    path: relativePath,
    text: safeReadText(fullPath, redactor),
    markdown: MARKDOWN_EXTENSIONS.has(extname(relativePath).toLowerCase()),
    size: safeSize(fullPath),
    diff: {
      baseLabel: baseline?.baseLabel || "working tree",
      baseCommit: baseline?.baseCommit ? baseline.baseCommit.slice(0, 7) : null,
      patch
    }
  };
}

function gitState(repo, redactor) {
  const branch = runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = runGit(repo, ["status", "--short"]);
  return {
    branch: firstLine(branch.stdout || branch.stderr || "unknown"),
    clean: !(status.stdout ?? "").trim(),
    statusLines: redactLines(status.stdout, redactor, 20),
    epics: listEpics(repo)
  };
}

function listEpics(repo) {
  // Epics are sourced from `epics/*.md` files on:
  //   1. main's working tree (canonical for branch:main epics and any
  //      already-merged epics)
  //   2. each `epic/*` git branch (so in-progress branch-policy epics
  //      are visible before they merge to main)
  // De-duped by slug — main wins when an epic file exists in both.
  const branchInfo = collectEpicBranchInfo(repo);
  const epicsBySlug = new Map<string, ReturnType<typeof buildEpicFromText>>();

  // 1. main working tree
  const epicsDir = join(repo, "epics");
  if (existsSync(epicsDir)) {
    let names: string[] = [];
    try {
      names = readdirSync(epicsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
        .map((entry) => entry.name);
    } catch { /* empty */ }
    for (const filename of names) {
      const fullPath = join(epicsDir, filename);
      let content = "";
      try { content = readFileSync(fullPath, "utf8"); } catch { continue; }
      const epic = buildEpicFromText({ filename, content, branchInfo, origin: "main" });
      if (epic) epicsBySlug.set(epic.slug, epic);
    }
  }

  // 2. each epic/* branch
  for (const branchName of branchInfo.keys()) {
    const ls = runGit(repo, ["ls-tree", "-r", "--name-only", branchName, "--", "epics/"]);
    if (ls.status !== 0) continue;
    for (const path of String(ls.stdout || "").split(/\r?\n/)) {
      if (!path) continue;
      // Only top-level epics/<slug>.md (skip done/, README, *-note.md)
      if (!/^epics\/[^/]+\.md$/.test(path)) continue;
      if (path === "epics/README.md") continue;
      const filename = path.slice("epics/".length);
      const slug = filename.replace(/\.md$/u, "");
      if (epicsBySlug.has(slug)) continue; // main wins
      const show = runGit(repo, ["show", `${branchName}:${path}`]);
      if (show.status !== 0) continue;
      const epic = buildEpicFromText({ filename, content: show.stdout, branchInfo, origin: "branch" });
      if (epic) epicsBySlug.set(epic.slug, epic);
    }
  }

  return [...epicsBySlug.values()].sort((a, b) => a.filename.localeCompare(b.filename));
}

function buildEpicFromText({ filename, content, branchInfo, origin }: {
  filename: string;
  content: string;
  branchInfo: Map<string, { lastCommit: string; lastCommittedAt: string; lastSubject: string }>;
  origin: "main" | "branch";
}) {
  const frontmatter = parseEpicFrontmatter(content);
  const branch = typeof frontmatter.branch === "string" && frontmatter.branch.trim() ? frontmatter.branch.trim() : "main";
  const slug = filename.replace(/\.md$/u, "");
  const branchEntry = branch.startsWith("epic/") ? branchInfo.get(branch) : null;
  return {
    slug,
    filename,
    title: typeof frontmatter.title === "string" && frontmatter.title.trim() ? frontmatter.title.trim() : slug,
    branch,
    origin,
    createdAt: typeof frontmatter.created_at === "string" ? frontmatter.created_at : null,
    closedAt: typeof frontmatter.closed_at === "string" ? frontmatter.closed_at : null,
    hasBranch: Boolean(branchEntry),
    lastCommit: branchEntry?.lastCommit ?? null,
    lastCommittedAt: branchEntry?.lastCommittedAt ?? null,
    lastSubject: branchEntry?.lastSubject ?? ""
  };
}

function parseEpicFrontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};
  try {
    return parseYaml(match[1]) ?? {};
  } catch {
    return {};
  }
}

function collectEpicBranchInfo(repo): Map<string, { lastCommit: string; lastCommittedAt: string; lastSubject: string }> {
  const result = runGit(repo, ["for-each-ref", "--format=%(refname:short)\t%(objectname:short)\t%(committerdate:iso-strict)\t%(subject)", "refs/heads/epic/*"]);
  const map = new Map();
  if (result.status !== 0) return map;
  for (const line of String(result.stdout || "").split(/\r?\n/).filter(Boolean)) {
    const [name, sha, committedAt, subject] = line.split("\t");
    if (!name) continue;
    map.set(name, { lastCommit: sha ?? "", lastCommittedAt: committedAt ?? "", lastSubject: subject ?? "" });
  }
  return map;
}

function runGit(repo, args) {
  const result = runCommandResult("git", args, { cwd: repo });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.exitCode,
    ok: result.ok,
    message: result.ok ? "" : new CommandExecutionError(result).message
  };
}

function parentCommit(repo, commit) {
  const result = runGit(repo, ["rev-parse", `${commit}^`]);
  return result.status === 0 ? firstLine(result.stdout) : null;
}

function currentHead(repo) {
  const result = runGit(repo, ["rev-parse", "HEAD"]);
  return result.status === 0 ? firstLine(result.stdout) : null;
}

function emptyTreeHash(repo) {
  const result = runGit(repo, ["hash-object", "-t", "tree", "/dev/null"]);
  return firstLine(result.stdout);
}

function splitLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function safeReadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function safeReadText(path, redactor) {
  try {
    return clampText(redactor(readFileSync(path, "utf8")), MAX_TEXT);
  } catch {
    return "";
  }
}

function safeSize(path) {
  try {
    return statLabel(readFileSync(path).byteLength);
  } catch {
    return "-";
  }
}

function statLabel(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

function clampText(text, limit) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n…`;
}

function redactObject(value, redactor) {
  return JSON.parse(redactor(JSON.stringify(value)));
}

function redactLines(text, redactor, limit) {
  return redactor(text ?? "").split(/\r?\n/).filter(Boolean).slice(0, limit);
}

function firstLine(text) {
  return String(text ?? "").trim().split(/\r?\n/)[0] || "(empty)";
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function nextActionChoice({ label, description, tone = "neutral", kind = "command" }) {
  return { label, description, tone, kind };
}

// Read a button's label + description from flow.actionLabels[key]
// (defined in flows/<flow>.yaml). Falls back to the key itself if the
// flow yaml doesn't define it, so a typo is visible rather than
// silently producing a blank button.
function actionFromYaml(labels, key, { tone = "neutral", kind = "command", overrideLabel = null, overrideDescription = null } = {}) {
  const entry = labels?.[key] ?? null;
  return {
    label: overrideLabel ?? entry?.label ?? key,
    description: overrideDescription ?? entry?.description ?? "",
    tone,
    kind
  };
}

// Read a card title/body template from flow.actionCards[key] and
// substitute {var} placeholders. Falls back to the key for the title
// and an empty body so missing entries are visible.
function cardFromYaml(cards, key, vars = {}) {
  const entry = cards?.[key] ?? null;
  const interp = (s) => String(s ?? "").replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? `{${name}}`));
  return {
    title: interp(entry?.title ?? key),
    body: interp(entry?.body ?? ""),
    bodyFallback: interp(entry?.bodyFallback ?? "")
  };
}

function humanDecisionActions(step = null, labels = {}) {
  // step.display.approve owns the labels/descriptions; the legacy id-based
  // helpers stay around as a fallback for steps without display.approve set.
  const stepId = typeof step === "string" ? step : step?.id ?? null;
  const stepObj = typeof step === "string" ? null : step;
  const approveLabel = stepObj?.display?.approve?.label ?? approveProposalLabelForStep(stepId);
  const approveDescription = stepObj?.display?.approve?.description ?? approveActionDescriptionForStep(stepId);
  return [
    actionFromYaml(labels, "openTerminalGate", { tone: "neutral", kind: "assist" }),
    nextActionChoice({
      label: approveLabel,
      description: approveDescription,
      tone: "approve",
      kind: "approve_direct"
    })
  ];
}

function approveActionDescriptionForStep(stepId) {
  if (stepId === "PD-C-10") {
    return "この close-gate をそのまま通し、ticket を close して flow を完了します。";
  }
  if (stepId === "PD-C-5") {
    return "計画を承認して PD-C-6 (実装) に進めます。";
  }
  if (stepId === "PD-C-1") {
    return "開始前チェックを承認して flow を確定し、推奨 variant の最初のステップ (full→PD-C-2 調査 / light→PD-C-3 計画) に進めます。";
  }
  return "この gate をそのまま通して次へ進めます。";
}


function approveProposalLabelForStep(stepId) {
  if (stepId === "PD-C-10") return "チケット完了";
  if (stepId === "PD-C-1") return "着手承認";
  if (stepId === "PD-C-5") return "実装開始";
  return "次へ進める";
}

function proposalBody(proposal, stepId = null) {
  return `assist の提案は「${proposalLabel(proposal, stepId)}」です。そのまま適用するか、assist で再作業して提案を更新します。`;
}

function proposalLabel(proposal, stepId = null) {
  if (!proposal) {
    return "提案なし";
  }
  if (proposal.action === "rerun_from" && proposal.target_step_id) {
    return `${rerunLabelFromStepId(proposal.target_step_id)}${proposal.reason ? ` (${proposal.reason})` : ""}`;
  }
  if (proposal.action === "approve") {
    return `${approveProposalLabelForStep(stepId)}${proposal.reason ? ` (${proposal.reason})` : ""}`;
  }
  if (proposal.action === "request_changes") {
    return `計画からやり直し${proposal.reason ? ` (${proposal.reason})` : ""}`;
  }
  if (proposal.action === "reject") {
    return `この案を採用しない${proposal.reason ? ` (${proposal.reason})` : ""}`;
  }
  return `${String(proposal.action || "").replaceAll("_", " ")}${proposal.reason ? ` (${proposal.reason})` : ""}`;
}

function proposalAcceptText(proposal, stepId = null) {
  if (!proposal) {
    return "この提案を適用します。";
  }
  if (proposal.action === "approve") {
    return stepId === "PD-C-10"
      ? "この gate を通して、ticket close に進めます。"
      : "この gate を通して、そのまま次へ進めます。";
  }
  if (proposal.action === "request_changes") {
    return "この gate を差し戻しとして扱い、flow 定義どおりに前段へ戻します。";
  }
  if (proposal.action === "reject") {
    return "この gate を reject として扱い、flow 定義どおりに前段へ戻します。";
  }
  if (proposal.action === "rerun_from") {
    return `この提案を適用し、${proposal.target_step_id || "earlier step"} から再実行します。`;
  }
  return "この提案を適用します。";
}

function rerunLabelFromStepId(stepId) {
  if (stepId === "PD-C-2") {
    return "調査からやり直し";
  }
  if (stepId === "PD-C-3") {
    return "計画からやり直し";
  }
  if (stepId === "PD-C-4") {
    return "レビューやり直し";
  }
  if (stepId === "PD-C-7" || stepId === "PD-C-8" || stepId === "PD-C-9") {
    return "検証やり直し";
  }
  return `${stepId || "前の step"} からやり直し`;
}

function interruptAnswerActions(labels = {}) {
  return [
    actionFromYaml(labels, "openTerminalInterrupt", { tone: "neutral", kind: "assist" })
  ];
}

function renderBeautifulMermaid(code) {
  const diagram = String(code ?? "").trim();
  if (!diagram || diagram.length > 20000) {
    return "";
  }
  try {
    return renderMermaidSVG(diagram, {
      bg: "var(--surface)",
      fg: "var(--text)",
      accent: "#ba7517",
      muted: "#6d6b64",
      surface: "#f5f4ef",
      border: "#d6d3c8",
      line: "#a3a097",
      transparent: true
    });
  } catch {
    return "";
  }
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendApiError(response, code, error, fallbackStatus = 500) {
  const statusCode = Number(error?.statusCode || fallbackStatus);
  const details = commandErrorDetails(error);
  sendJson(response, statusCode, {
    error: code,
    message: error?.message || String(error),
    ...(details ? { details } : {}),
  });
}

function withStatusCode(error, statusCode) {
  error.statusCode = statusCode;
  return error;
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

// Serve a transient run-scoped artifact (image, etc.) under .pdh-flow/runs/.
//
// Scope: only paths that resolve into <repo>/.pdh-flow/runs/ are allowed.
// This is the single mechanism that the web UI uses to render markdown
// `![](path)` image links pointing at provider-produced screenshots
// (PD-C-9 Surface Observer / PD-D-3 UCS QA / etc.).
//
// Why scoped: agents write absolute or repo-relative paths into
// ui-output.json `notes` markdown; the web UI rewrites them through
// /api/run-file?path=<...>. Limiting to .pdh-flow/runs/ blocks path
// traversal and accidental serving of source / secrets.
function serveRunFile({ response, repo, rawPath }) {
  if (!rawPath || typeof rawPath !== "string") {
    sendJson(response, 400, { error: "missing_path" });
    return;
  }
  const stripped = rawPath.replace(/^\/+/, "");
  const candidate = resolve(repo, stripped);
  const allowedRoot = resolve(repo, ".pdh-flow", "runs");
  if (candidate !== allowedRoot && !candidate.startsWith(allowedRoot + "/")) {
    sendJson(response, 403, { error: "out_of_scope" });
    return;
  }
  if (!existsSync(candidate)) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  const ext = extname(candidate).toLowerCase();
  const mime = artifactMimeType(ext);
  if (!mime) {
    sendJson(response, 415, { error: "unsupported_type", ext });
    return;
  }
  const body = readFileSync(candidate);
  // Run-scoped artifacts are effectively immutable: the path embeds the
  // run id, and agents save into a freshly-created `screenshots/` dir per
  // step attempt. Letting the browser cache them avoids re-fetching the
  // image every time React re-renders the surrounding ui-output card
  // (which happens on each SSE state update). Without caching, large
  // screenshots flicker / appear to "reload" on every state tick.
  response.writeHead(200, {
    "content-type": mime,
    "cache-control": "private, max-age=3600",
    "content-length": String(body.length)
  });
  response.end(body);
}

function artifactMimeType(ext) {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    default:
      return null;
  }
}

function sendSvg(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendScript(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/javascript; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendCss(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/css; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendHtml(response, body) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function missingSpaShell() {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>PDH Dev Dashboard</title></head><body><h1>PDH Dev Dashboard</h1><p>SPA build is missing. Run <code>cd web && npm install && npm run build</code> from the pdh-flow project root.</p></body></html>`;
}

function serveStaticFile(response, absPath) {
  try {
    const data = readFileSync(absPath);
    const ext = extname(absPath).toLowerCase();
    const mime = STATIC_MIME[ext] ?? "application/octet-stream";
    const cache = ext === ".html" ? "no-store" : "public, max-age=31536000, immutable";
    response.writeHead(200, {
      "content-type": mime,
      "cache-control": cache
    });
    response.end(data);
    return true;
  } catch {
    return false;
  }
}
