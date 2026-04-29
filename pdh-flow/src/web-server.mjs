import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { URL, fileURLToPath } from "node:url";
import { renderMermaidSVG } from "beautiful-mermaid";
import { parse as parseYaml } from "yaml";
import { clearTicketStartRequest, loadLatestAssistSignal, loadPendingTicketStartRequests } from "./assist-runtime.mjs";
import { createAssistTerminalManager } from "./assist-terminal.mjs";
import { evaluateAcVerificationTable } from "./ac-verification.mjs";
import { buildFlowView, getStep, nextStep, renderMermaidFlow } from "./flow.mjs";
import { loadStepInterruptions } from "./interruptions.mjs";
import { loadJudgements } from "./judgements.mjs";
import { extractSection, loadCurrentNote, parseStepHistory } from "./note-state.mjs";
import { createRedactor } from "./redaction.mjs";
import { loadReviewerOutputsForStep } from "./review-runtime.mjs";
import { loadStepUiOutput, loadStepUiRuntime } from "./step-ui.mjs";
import { hasCompletedProviderAttempt, latestAttemptResult, latestHumanGate, listTrackedProcesses, loadRuntime, readProgressEvents, runtimeMetaPath, stepDir } from "./runtime-state.mjs";
import { archivePriorRunTag } from "./actions.mjs";

const MAX_TEXT = 120000;
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const TEXT_ARTIFACT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".patch", ".diff", ".log", ".mmd"]);
const XTERM_JS_PATH = fileURLToPath(new URL("../node_modules/@xterm/xterm/lib/xterm.js", import.meta.url));
const XTERM_CSS_PATH = fileURLToPath(new URL("../node_modules/@xterm/xterm/css/xterm.css", import.meta.url));
const XTERM_FIT_JS_PATH = fileURLToPath(new URL("../node_modules/@xterm/addon-fit/lib/addon-fit.js", import.meta.url));
const XTERM_WEB_LINKS_JS_PATH = fileURLToPath(new URL("../node_modules/@xterm/addon-web-links/lib/addon-web-links.js", import.meta.url));
const MARKDOWN_IT_JS_PATH = fileURLToPath(new URL("../node_modules/markdown-it/dist/markdown-it.min.js", import.meta.url));
const CLI_PATH = fileURLToPath(new URL("./cli.mjs", import.meta.url));
const WEB_DIST_DIR = fileURLToPath(new URL("../web/dist/", import.meta.url));
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
  ".mjs": "application/javascript; charset=utf-8",
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
      const actualHost = address.address === "::" ? "localhost" : address.address;
      resolveServer({
        server,
        repo,
        url: `http://${actualHost}:${address.port}/`
      });
    });
  });
}

function handleRequest({ request, response, repo, assistTerminalManager }) {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD" && !(method === "POST" && (request.url?.startsWith("/api/assist/open") || request.url?.startsWith("/api/assist/apply") || request.url?.startsWith("/api/recommendation/accept") || request.url?.startsWith("/api/gate/approve") || request.url?.startsWith("/api/ticket/start") || request.url?.startsWith("/api/ticket/terminal") || request.url?.startsWith("/api/run-next") || request.url?.startsWith("/api/runtime/resume") || request.url?.startsWith("/api/runtime/stop") || request.url?.startsWith("/api/runtime/discard") || request.url?.startsWith("/api/repo/terminal")))) {
    sendJson(response, 405, { error: "read_only_web_ui" });
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
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
    sendJson(response, 200, collectState({ repo }));
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
    try {
      sendJson(response, 200, assistTerminalManager.openSession({ stepId }));
    } catch (error) {
      sendJson(response, 500, { error: "assist_open_failed", message: error?.message || String(error) });
    }
    return;
  }
  if (url.pathname === "/api/recommendation/accept") {
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
      sendJson(response, 200, acceptRecommendationFromWeb({ repo, stepId }));
    } catch (error) {
      sendJson(response, Number(error?.statusCode || 500), { error: "recommendation_accept_failed", message: error?.message || String(error) });
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
      sendJson(response, Number(error?.statusCode || 500), { error: "gate_approve_failed", message: error?.message || String(error) });
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
      sendJson(response, Number(error?.statusCode || 500), { error: "ticket_start_failed", message: error?.message || String(error) });
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
      sendJson(response, Number(error?.statusCode || 500), { error: "ticket_terminal_failed", message: error?.message || String(error) });
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
      sendJson(response, Number(error?.statusCode || 500), { error: "run_next_failed", message: error?.message || String(error) });
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
      sendJson(response, Number(error?.statusCode || 500), { error: "resume_failed", message: error?.message || String(error) });
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
      sendJson(response, Number(error?.statusCode || 500), { error: "stop_failed", message: error?.message || String(error) });
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
      sendJson(response, Number(error?.statusCode || 500), { error: "repo_terminal_failed", message: error?.message || String(error) });
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
      sendJson(response, Number(error?.statusCode || 500), { error: "discard_failed", message: error?.message || String(error) });
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
      sendJson(response, Number(error?.statusCode || 500), { error: "assist_apply_failed", message: error?.message || String(error) });
    }
    return;
  }
  if (url.pathname === "/api/events") {
    sendEventStream({ request, response, repo });
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
  sendJson(response, 404, { error: "not_found" });
}

function sendEventStream({ request, response, repo }) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write("retry: 3000\n\n");

  let previous = "";
  const pushState = () => {
    const payload = JSON.stringify(collectState({ repo }));
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

function acceptRecommendationFromWeb({ repo, stepId }) {
  const accepted = runCliJson({
    repo,
    args: ["accept-recommendation", "--repo", repo, "--step", stepId, "--no-run-next"]
  });
  let runNextPid = null;
  if (accepted?.result?.status !== "completed") {
    runNextPid = spawnBackgroundCli({
      repo,
      args: ["run-next", "--repo", repo]
    });
  }
  return {
    ...accepted,
    runNextStarted: Boolean(runNextPid),
    runNextPid
  };
}

function approveGateFromWeb({ repo, stepId }) {
  const approved = runCliText({
    repo,
    args: ["approve", "--repo", repo, "--step", stepId, "--reason", "ok"]
  });
  const runNextPid = spawnBackgroundCli({
    repo,
    args: ["run-next", "--repo", repo]
  });
  return {
    status: "ok",
    approved,
    runNextStarted: true,
    runNextPid
  };
}

function startTicketFromWeb({ repo, ticketId, variant = "full", force = false }) {
  const cliArgs = ["run", "--repo", repo, "--ticket", ticketId, "--variant", variant];
  if (force) {
    cliArgs.push("--force-reset");
  }
  const started = runCliText({
    repo,
    args: cliArgs
  });
  clearTicketStartRequest({ repoPath: repo, ticketId });
  const runNextPid = spawnBackgroundCli({
    repo,
    args: ["run-next", "--repo", repo]
  });
  return {
    status: "ok",
    started,
    runNextStarted: true,
    runNextPid
  };
}

function runNextFromWeb({ repo, force = false }) {
  const args = ["run-next", "--repo", repo];
  if (force) {
    args.push("--force");
  }
  const runNextPid = spawnBackgroundCli({ repo, args });
  return {
    status: "ok",
    runNextStarted: true,
    runNextPid,
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
    args: ["stop", "--repo", repo, "--reason", "stopped via web ui"]
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
  const runNextPid = spawnBackgroundCli({
    repo,
    args: ["run-next", "--repo", repo, "--force"]
  });
  return {
    ...applied,
    runNextStarted: true,
    runNextPid
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
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: repo,
    encoding: "utf8",
    timeout: timeoutMs,
    env: process.env
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || `CLI exited with ${result.status}`).trim();
    const error = new Error(message || "CLI command failed");
    error.statusCode = result.status === 1 ? 409 : 500;
    throw error;
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

function spawnBackgroundCli({ repo, args }) {
  const child = spawn(process.execPath, [CLI_PATH, ...args], {
    cwd: repo,
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  child.unref();
  return child.pid;
}

function collectState({ repo }) {
  const runtime = loadRuntime(repo, { normalizeStaleRunning: true });
  const redactor = createRedactor({ repoPath: repo });
  const note = runtime.note;
  const ticketText = existsSync(join(repo, "current-ticket.md")) ? readFileSync(join(repo, "current-ticket.md"), "utf8") : "";
  const optionalDocs = loadOptionalRepoDocuments(repo, redactor);
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
      noteState: redactObject(runtime.pdh, redactor),
      currentStep: currentStep ? stepMeta(currentStep) : null,
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
      stepArtifacts: currentStep && run?.id ? listStepArtifacts({ stateDir: runtime.stateDir, runId: run.id, stepId: currentStep.id, redactor }) : []
    },
    history,
    events,
    ac: {
      ok: ac.ok,
      counts: ac.counts,
      errors: ac.errors
    },
    git: gitState(repo, redactor),
    tickets,
    ticketRequests: loadPendingTicketStartRequests({ repoPath: repo }),
    files: {
      note: join(repo, "current-note.md"),
      ticket: join(repo, "current-ticket.md"),
      ...(optionalDocs.productBrief ? { productBrief: optionalDocs.productBrief.path } : {}),
      ...(optionalDocs.epic ? { epic: optionalDocs.epic.path } : {})
    },
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

function loadOptionalRepoDocuments(repo, redactor) {
  const result = {};
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
      variant,
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
      reviewDiff: runtime.run?.id ? redactObject(collectDiffPayload({ repo, stepId: step.id, includePatch: false }), redactor) : null,
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
    currentLabel: currentStep ? `${currentStep.id} ${currentStep.label}` : "未開始",
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

function stepProgress({ runtime, sequence, index, step, historyEntry, gate, attempt, processState, interruptions }) {
  const run = runtime.run;
  if (!sequence.includes(step.id)) {
    return progress("skipped", "スキップ", "選択中 variant では実行しない step です。");
  }
  if (!run) {
    return progress("pending", "未開始", "まだ run が始まっていません。");
  }
  if (run.status === "completed") {
    return progress("done", "完了", "この run は完了しています。");
  }
  const currentIndex = sequence.indexOf(run.current_step_id);
  if (step.id === run.current_step_id) {
    if (run.status === "running" && processState?.stale) {
      return progress("failed", "stalled", processState.note || "provider process is no longer alive.");
    }
    if (run.status === "needs_human") {
      if (gate?.recommendation?.status === "pending") {
        return progress("waiting", "ユーザ回答待ち", "agent recommendation を適用するか、Open Terminal で再作業するかを選びます。");
      }
      return progress("waiting", "ユーザ回答待ち", "判断材料を確認して Web で判断します。");
    }
    if (run.status === "interrupted") {
      return progress("waiting", "割り込み待ち", interruptions.length > 0 ? "質問に回答すると継続します。" : "割り込み回答待ちです。");
    }
    if (run.status === "blocked") {
      return progress("blocked", "ガード待ち", "必要な記録や検証を追加してから `run-next` を再実行します。");
    }
    if (run.status === "failed") {
      return progress("failed", "再試行待ち", "provider の再実行または resume が必要です。");
    }
    if (step.provider !== "runtime" && run.id && hasCompletedProviderAttempt({ stateDir: runtime.stateDir, runId: run.id, stepId: step.id, provider: step.provider })) {
      return progress("waiting", "advance待ち", "`run-next` で guard 評価と遷移を進めます。");
    }
    if (processState?.activeCount > 0) {
      return progress("running", "実行中", processState.note || "provider がこの step を実行しています。");
    }
    return progress("running", "実行中", "provider がこの step を実行しています。");
  }
  if (historyEntry) {
    return progress("done", "完了", historyEntry.summary);
  }
  if (currentIndex >= 0 && index < currentIndex) {
    return progress("done", "完了", "履歴行がなくても先行 step とみなします。");
  }
  if (attempt?.status === "failed") {
    return progress("failed", "失敗", "最新 attempt が失敗しています。");
  }
  return progress("pending", "未着手", "前段 step の完了後に自動で開始されます。");
}

function progress(status, label, note = "") {
  return { status, label, note };
}

function latestHistoryByStep(entries) {
  const map = new Map();
  for (const entry of entries) {
    map.set(entry.stepId, entry);
  }
  return map;
}

function stepMeta(step) {
  return {
    id: step.id,
    label: step.label ?? step.id,
    summary: step.summary ?? "",
    userAction: step.userAction ?? "",
    ui: step.ui ?? null,
    provider: step.provider,
    mode: step.mode
  };
}

function resolveStepNoteSection(noteBody, stepId) {
  const headingByStep = {
    "PD-C-2": "PD-C-2. 調査結果",
    "PD-C-3": "PD-C-3. 計画",
    "PD-C-4": "PD-C-4. 計画レビュー結果",
    "PD-C-6": "PD-C-6",
    "PD-C-7": "PD-C-7. 品質検証結果",
    "PD-C-8": "PD-C-8. 目的妥当性確認",
    "PD-C-9": "PD-C-9. プロセスチェックリスト",
    "PD-C-10": "PD-C-10"
  };
  const heading = headingByStep[stepId];
  return heading ? extractSection(noteBody, heading) ?? "" : "";
}

function redactSection(text, redactor) {
  return clampText(redactor(String(text ?? "")), 16000);
}

function describeNextAction({ repo, runtime, currentStep, currentGate, interruptions }) {
  if (!runtime.run || !currentStep) {
    const command = `node src/cli.mjs run --repo ${shellQuote(repo)} --ticket <ticket-id> --variant full`;
    return {
      title: "最初にすること",
      body: "repo root で `run` を実行して .pdh-flow/runtime.json を初期化します。",
      commands: [command],
      actions: [
        nextActionChoice({
          label: "Run",
          description: "新しい flow を開始して .pdh-flow/runtime.json の runtime state を初期化します。",
          command
        })
      ],
      selection: "single",
      targetTab: "commands"
    };
  }
  if (runtime.run.status === "needs_human") {
    const actions = humanDecisionActions(repo, currentStep.id);
    return {
      title: `${currentStep.id} の判断`,
      body: currentGate?.recommendation?.status === "pending"
        ? recommendationBody(currentGate.recommendation, currentStep.id)
        : "",
      commands: actions.map((item) => item.command),
      actions,
      selection: "choose_one_optional_assist",
      targetTab: "gate"
    };
  }
  if (interruptions.length > 0 || runtime.run.status === "interrupted") {
    const actions = interruptAnswerActions(repo, currentStep.id);
    return {
      title: `${currentStep.id} の割り込み回答`,
      body: "質問内容を確認して回答します。必要なら Claude assist でコードやテストを見てから `answer` を返します。",
      commands: actions.map((item) => item.command),
      actions,
      selection: "ordered_optional_assist",
      targetTab: "detail"
    };
  }
  if (runtime.run.status === "failed") {
    const assist = assistOpenCommand(repo, currentStep.id);
    return {
      title: `${currentStep.id} の失敗を解析`,
      body: failedActionBody(currentStep),
      commands: [assist],
      actions: [
        nextActionChoice({
          label: "Open Terminal",
          description: "failure-summary と artifacts を assist で確認し、原因に応じて手で修正します。修正後は assist から `assist-signal --signal continue` を送って runtime に再評価させます。",
          command: assist,
          tone: "neutral",
          kind: "assist"
        })
      ],
      selection: "single",
      targetTab: "detail"
    };
  }
  if (
    runtime.run.status === "running" &&
    currentStep.provider !== "runtime" &&
    runtime.run.id &&
    hasCompletedProviderAttempt({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId: currentStep.id,
      provider: currentStep.provider
    }) &&
    !currentStep?.processState?.activeCount
  ) {
    const command = `node src/cli.mjs run-next --repo ${shellQuote(repo)}`;
    const assist = assistOpenCommand(repo, currentStep.id);
    return {
      title: `${currentStep.id} の遷移を進める`,
      body: "この step の provider/review は完了しています。`run-next` で guard 評価と次 step への遷移を進めます。必要なら先に Open Terminal で差分や note/ticket を確認します。",
      commands: [command, assist],
      actions: [
        nextActionChoice({
          label: "Run Next",
          description: "完了済み step の guard 評価と flow transition を進めます。",
          command,
          tone: "approve",
          kind: "run_next_direct"
        }),
        nextActionChoice({
          label: "Open Terminal",
          description: "次に進める前に current repo state を terminal で確認します。",
          command: assist,
          tone: "neutral",
          kind: "assist"
        })
      ],
      selection: "single_optional_assist",
      targetTab: "commands"
    };
  }
  if (runtime.run.status === "running" && currentStep?.processState?.stale) {
    const command = `node src/cli.mjs resume --repo ${shellQuote(repo)}`;
    const assist = assistOpenCommand(repo, currentStep.id);
    return {
      title: `${currentStep.id} の再実行`,
      body: currentStep.processState.note || "provider process は終了していますが、runtime state は running のままです。summary を確認してから再実行します。",
      commands: [assist, command],
      actions: [
        nextActionChoice({
          label: "Open Terminal",
          description: "stale running になる直前の変更や reviewer 指摘を確認します。",
          command: assist,
          tone: "neutral",
          kind: "assist"
        }),
        nextActionChoice({
          label: "Resume",
          description: "同じ step を再実行します。",
          command,
          tone: "revise",
          kind: "resume_direct"
        })
      ],
      selection: "single_optional_assist",
      targetTab: "detail"
    };
  }
  if (runtime.run.status === "blocked") {
    const command = `node src/cli.mjs run-next --repo ${shellQuote(repo)}`;
    const assist = assistOpenCommand(repo, currentStep.id);
    return {
      title: `${currentStep.id} の不足を解消`,
      body: blockedActionBody(currentStep),
      commands: [assist, command],
      actions: [
        nextActionChoice({
          label: "Open Terminal",
          description: "止まった理由を Claude assist と一緒に確認し、必要な変更や検証をその場で詰めます。",
          command: assist,
          tone: "neutral",
          kind: "assist"
        }),
        nextActionChoice({
          label: "Run Next",
          description: "不足している guard-facing artifact を補完したうえで、この step を再評価します。",
          command,
          tone: "revise",
          kind: "run_next_direct"
        })
      ],
      selection: "single_optional_assist",
      targetTab: "detail"
    };
  }
  const command = `node src/cli.mjs run-next --repo ${shellQuote(repo)}`;
  const assist = assistOpenCommand(repo, currentStep.id);
  return {
    title: `${currentStep.id} を進める`,
    body: "通常は `run-next` だけで、gate や割り込みまで自動で進みます。",
    commands: [command, assist],
    actions: [
      nextActionChoice({
        label: "Run Next",
        description: "通常進行です。次の gate / interruption / failure / complete まで自動で進めます。",
        command,
        tone: "approve",
        kind: "run_next_direct"
      }),
      nextActionChoice({
        label: "Open Terminal",
        description: "current step の repo state を terminal で確認したり、会話しながら調査します。",
        command: assist,
        tone: "neutral",
        kind: "assist"
      })
    ],
    selection: "single_optional_assist",
    targetTab: "commands"
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

function resolveDiffBaseline({ repo, stepId }) {
  const runtime = loadRuntime(repo, { normalizeStaleRunning: true });
  const run = runtime.run;
  if (!run?.id || !stepId) {
    return null;
  }
  const variant = run.flow_variant ?? runtime.pdh.variant ?? "full";
  const view = buildFlowView(runtime.flow, variant, run.current_step_id ?? null);
  const stepIndex = view.sequence.indexOf(stepId);
  if (stepIndex < 0) {
    return null;
  }
  const history = parseStepHistory(runtime.note.body).entries
    .filter((entry) => entry.commit && entry.commit !== "-");
  const gateIds = view.steps.filter((step) => step.mode === "human").map((step) => step.id);
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

function collectDiffPayload({ repo, stepId, includePatch = true }) {
  const baseline = resolveDiffBaseline({ repo, stepId });
  if (!baseline) {
    return null;
  }
  const { baseRef, baseLabel, baseCommit } = baseline;

  const diffArgs = ["diff", "--no-ext-diff", "--submodule=diff", "--unified=3", baseRef, "--"];
  const statArgs = ["diff", "--stat", baseRef, "--"];
  const filesArgs = ["diff", "--name-only", baseRef, "--"];
  const diff = runGit(repo, diffArgs);
  const stat = runGit(repo, statArgs);
  const files = runGit(repo, filesArgs);

  return {
    stepId,
    baseLabel,
    baseCommit: baseCommit ? baseCommit.slice(0, 7) : null,
    diffStat: splitLines(stat.stdout),
    changedFiles: splitLines(files.stdout),
    patch: includePatch ? clampText(diff.stdout, MAX_TEXT) : null
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
  const diff = runGit(repo, ["diff", "--", "current-note.md", "current-ticket.md", "src", "flows", "README.md", "product-brief.md", "technical-plan.md", "tasks.md"]);
  return {
    branch: firstLine(branch.stdout || branch.stderr || "unknown"),
    clean: !(status.stdout ?? "").trim(),
    statusLines: redactLines(status.stdout, redactor, 20),
    diffText: clampText(redactor(diff.stdout ?? ""), MAX_TEXT)
  };
}

function runGit(repo, args) {
  const result = spawnSync("git", args, { cwd: repo, text: true, encoding: "utf8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status
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

function humanDecisionCommands(repo, stepId) {
  const repoArg = ` --repo ${shellQuote(repo)}`;
  return [
    `node src/cli.mjs approve${repoArg} --step ${stepId} --reason ok`,
    `node src/cli.mjs request-changes${repoArg} --step ${stepId} --reason "<reason>"`,
    `node src/cli.mjs reject${repoArg} --step ${stepId} --reason "<reason>"`
  ];
}

function recommendationDecisionCommands(repo, stepId) {
  const repoArg = ` --repo ${shellQuote(repo)}`;
  return [
    `node src/cli.mjs accept-recommendation${repoArg} --step ${stepId}`,
    `node src/cli.mjs decline-recommendation${repoArg} --step ${stepId} --reason "<reason>"`
  ];
}

function assistOpenCommand(repo, stepId) {
  return `node src/cli.mjs assist-open --repo ${shellQuote(repo)} --step ${stepId}`;
}

function interruptAnswerCommands(repo, stepId) {
  const repoArg = ` --repo ${shellQuote(repo)}`;
  return [
    `node src/cli.mjs show-interrupts${repoArg} --step ${stepId}`,
    `node src/cli.mjs answer${repoArg} --step ${stepId} --message "<answer>"`
  ];
}

function nextActionChoice({ label, description, command, tone = "neutral", kind = "command" }) {
  return { label, description, command, tone, kind };
}

function humanDecisionActions(repo, stepId) {
  const [approve] = humanDecisionCommands(repo, stepId);
  return [
    nextActionChoice({
      label: "Open Terminal",
      description: "まずは Claude assist と相談しながら recommendation を作るか、必要な修正をここで進めます。",
      command: assistOpenCommand(repo, stepId),
      tone: "neutral",
      kind: "assist"
    }),
    nextActionChoice({
      label: "Approve",
      description: "この gate をそのまま通して次へ進めます。",
      command: approve,
      tone: "approve",
      kind: "approve_direct"
    })
  ];
}

function recommendationDecisionActions(repo, runtime, step, recommendation) {
  const [accept] = recommendationDecisionCommands(repo, step.id);
  const primary = recommendationPrimaryAction(repo, runtime, step, recommendation, accept);
  return [
    primary,
    nextActionChoice({
      label: "Assistで再作業",
      description: "recommendation を見直す場合や、さらに大きく直す場合は assist でそのまま続けます。新しい recommendation が出れば上書きされます。",
      command: assistOpenCommand(repo, step.id),
      tone: "neutral",
      kind: "assist"
    })
  ];
}

function approveRecommendationLabelForStep(stepId) {
  return stepId === "PD-C-10" ? "チケット完了" : "実装開始";
}

function recommendationBody(recommendation, stepId = null) {
  return `Claude assist の推奨は「${recommendationLabel(recommendation, stepId)}」です。そのまま適用するか、assist で再作業して推奨を更新します。`;
}

function recommendationLabel(recommendation, stepId = null) {
  if (!recommendation) {
    return "推奨なし";
  }
  if (recommendation.action === "rerun_from" && recommendation.target_step_id) {
    return `${rerunLabelFromStepId(recommendation.target_step_id)}${recommendation.reason ? ` (${recommendation.reason})` : ""}`;
  }
  if (recommendation.action === "approve") {
    return `${approveRecommendationLabelForStep(stepId)}${recommendation.reason ? ` (${recommendation.reason})` : ""}`;
  }
  if (recommendation.action === "request_changes") {
    return `計画からやり直し${recommendation.reason ? ` (${recommendation.reason})` : ""}`;
  }
  if (recommendation.action === "reject") {
    return `この案を採用しない${recommendation.reason ? ` (${recommendation.reason})` : ""}`;
  }
  return `${String(recommendation.action || "").replaceAll("_", " ")}${recommendation.reason ? ` (${recommendation.reason})` : ""}`;
}

function recommendationAcceptText(recommendation, stepId = null) {
  if (!recommendation) {
    return "この recommendation を適用します。";
  }
  if (recommendation.action === "approve") {
    return stepId === "PD-C-10"
      ? "この gate を通して、ticket close に進めます。"
      : "この gate を通して、そのまま次へ進めます。";
  }
  if (recommendation.action === "request_changes") {
    return "この gate を差し戻しとして扱い、flow 定義どおりに前段へ戻します。";
  }
  if (recommendation.action === "reject") {
    return "この gate を reject として扱い、flow 定義どおりに前段へ戻します。";
  }
  if (recommendation.action === "rerun_from") {
    return `この recommendation を適用し、${recommendation.target_step_id || "earlier step"} から再実行します。`;
  }
  return "この recommendation を適用します。";
}

function recommendationTone(recommendation) {
  if (!recommendation) {
    return "approve";
  }
  if (recommendation.action === "approve") {
    return "approve";
  }
  if (recommendation.action === "rerun_from" || recommendation.action === "request_changes") {
    return "revise";
  }
  return "reject";
}

function recommendationPrimaryAction(repo, runtime, step, recommendation, command) {
  const targetApprove = nextStep(runtime.flow, runtime.run.flow_variant, step.id, "human_approved");
  const targetChanges = nextStep(runtime.flow, runtime.run.flow_variant, step.id, "human_changes_requested");
  const targetReject = nextStep(runtime.flow, runtime.run.flow_variant, step.id, "human_rejected");

  if (!recommendation) {
    return nextActionChoice({
      label: "Apply Recommendation",
      description: "現在の recommendation を適用します。",
      command,
      tone: "approve"
    });
  }

  if (recommendation.action === "approve") {
    const targetStep = targetApprove && targetApprove !== "COMPLETE" ? getStep(runtime.flow, targetApprove) : null;
    const approveLabel = targetApprove === "COMPLETE"
      ? "チケット完了"
      : implementationStartLabel(targetStep, targetApprove);
    return nextActionChoice({
      label: approveLabel,
      description: targetApprove === "COMPLETE"
        ? "この recommendation を適用して close に進めます。"
        : `${formatStepTarget(targetStep, targetApprove)} に進めます。`,
      command,
      tone: "approve"
    });
  }

  if (recommendation.action === "rerun_from") {
    const targetStep = recommendation.target_step_id ? getStep(runtime.flow, recommendation.target_step_id) : null;
    return nextActionChoice({
      label: redoActionLabel(targetStep, recommendation.target_step_id),
      description: `この recommendation を適用し、${formatStepTarget(targetStep, recommendation.target_step_id)} から再実行します。`,
      command,
      tone: "revise"
    });
  }

  if (recommendation.action === "request_changes") {
    const targetStep = targetChanges && targetChanges !== "COMPLETE" ? getStep(runtime.flow, targetChanges) : null;
    return nextActionChoice({
      label: redoActionLabel(targetStep, targetChanges),
      description: `${formatStepTarget(targetStep, targetChanges)} に戻して修正を続けます。`,
      command,
      tone: "revise"
    });
  }

  if (recommendation.action === "reject") {
    const targetStep = targetReject && targetReject !== "COMPLETE" ? getStep(runtime.flow, targetReject) : null;
    return nextActionChoice({
      label: targetReject && targetReject !== "COMPLETE" ? redoActionLabel(targetStep, targetReject) : "この案を採用しない",
      description: targetReject && targetReject !== "COMPLETE"
        ? `${formatStepTarget(targetStep, targetReject)} に戻して、この案は採用しません。`
        : "この recommendation を reject として適用します。",
      command,
      tone: "reject"
    });
  }

  return nextActionChoice({
    label: "Apply Recommendation",
    description: "現在の recommendation を適用します。",
    command,
    tone: recommendationTone(recommendation)
  });
}

function redoActionLabel(step, fallbackStepId) {
  const label = step?.label || fallbackStepId || "";
  if (/調査/.test(label)) {
    return "調査からやり直し";
  }
  if (label === "計画" || (/計画/.test(label) && !/レビュー/.test(label))) {
    return "計画からやり直し";
  }
  if (/レビュー/.test(label)) {
    return "レビューやり直し";
  }
  if (/検証|妥当性|チェック/.test(label)) {
    return "検証やり直し";
  }
  return `${formatStepTarget(step, fallbackStepId)} からやり直し`;
}

function formatStepTarget(step, fallbackStepId) {
  if (step?.label) {
    return `${step.id} ${step.label}`;
  }
  return fallbackStepId || "previous step";
}

function implementationStartLabel(step, fallbackStepId) {
  const label = step?.label || fallbackStepId || "";
  if (/実装/.test(label)) {
    return "実装開始";
  }
  if (/検証|レビュー/.test(label)) {
    return "レビュー開始";
  }
  return `${formatStepTarget(step, fallbackStepId)} に進む`;
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

function interruptAnswerActions(repo, stepId) {
  const [showInterrupts, answer] = interruptAnswerCommands(repo, stepId);
  return [
    nextActionChoice({
      label: "Show Interrupt",
      description: "未回答の質問内容を terminal で確認します。",
      command: showInterrupts,
      tone: "neutral"
    }),
    nextActionChoice({
      label: "Open Terminal",
      description: "質問に答える前に Claude assist でコードとテストを確認します。",
      command: assistOpenCommand(repo, stepId),
      tone: "neutral",
      kind: "assist"
    }),
    nextActionChoice({
      label: "Answer",
      description: "質問への回答を返して current step を再開します。",
      command: answer,
      tone: "approve"
    })
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

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
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

