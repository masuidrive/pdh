// pdh-flow v2 Web UI MVP — vanilla JS, SSE-driven.
//
// Updates flow:
//   1. On page load, render the full page once from REST GET.
//   2. Subscribe to /api/runs(-events|/<id>/events) — Server-Sent Events.
//   3. On each `change` event, re-fetch summary + note.
//   4. Replace per-card innerHTML only when its data changed.
//   5. The gate-card is preserved verbatim while `active_gate` is unchanged
//      so a half-typed approval doesn't get clobbered by a snapshot save.

const app = document.getElementById("app");

let currentRunId = readRunFromHash();
let currentSse = null;
let lastSummary = null;
let lastNote = null;

window.addEventListener("hashchange", () => {
  currentRunId = readRunFromHash();
  switchPage();
});

function readRunFromHash() {
  const m = window.location.hash.match(/^#\/runs\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function fetchJson(path) {
  const r = await fetch(path);
  if (!r.ok) {
    let body = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText} on ${path}: ${body.slice(0, 300)}`);
  }
  return r.json();
}

async function fetchText(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
  return r.text();
}

// ─── Routing ──────────────────────────────────────────────────────────────

function closeSse() {
  if (currentSse) {
    currentSse.close();
    currentSse = null;
  }
  lastSummary = null;
  lastNote = null;
}

async function switchPage() {
  closeSse();
  if (currentRunId) {
    await initRunPage(currentRunId);
  } else {
    await initHomePage();
  }
}

// ─── Home page ────────────────────────────────────────────────────────────

async function initHomePage() {
  await renderHomePage();
  // SSE: re-render the run list whenever a run dir is created/removed.
  currentSse = new EventSource("/api/runs-events");
  currentSse.addEventListener("change", () => {
    renderHomePage().catch((e) => renderError(e));
  });
}

async function renderHomePage() {
  // F-011/H10-8: ticket-centric primary view. Falls back to runs listing
  // when no tickets exist (e.g. legacy worktree mid-migration).
  const tickets = await fetchJson("/api/tickets");
  if (tickets.length === 0) {
    const runs = await fetchJson("/api/runs");
    app.innerHTML = `
      <header class="mb-6 flex items-center gap-3">
        <h1 class="text-2xl font-semibold">pdh-flow v2</h1>
      </header>
      <div class="card bg-base-100 shadow">
        <div class="card-body">
          <h2 class="card-title text-lg">Runs</h2>
          ${
            runs.length === 0
              ? '<p class="text-sm opacity-70">No tickets yet. Start the engine on a worktree, then come back.</p>'
              : `<div class="overflow-x-auto"><table class="table table-zebra table-sm">
                  <thead><tr><th>Run ID</th><th>Ticket</th><th>State</th><th>Saved</th><th></th></tr></thead>
                  <tbody>${runs.map(renderRunRow).join("")}</tbody>
                </table></div>`
          }
        </div>
      </div>
    `;
    return;
  }
  app.innerHTML = `
    <header class="mb-6 flex items-center gap-3">
      <h1 class="text-2xl font-semibold">pdh-flow v2</h1>
      <span class="badge badge-ghost">tickets/</span>
    </header>
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title text-lg">Tickets</h2>
        <div class="overflow-x-auto">
          <table class="table table-zebra table-sm">
            <thead><tr><th>Slug</th><th>Title</th><th>Status</th><th>Run state</th><th>Opened</th><th></th></tr></thead>
            <tbody>
              ${tickets.map(renderTicketRow).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderTicketRow(t) {
  const slug = encodeURIComponent(t.slug);
  const linkTarget = t.latest_run_id
    ? `#/runs/${encodeURIComponent(t.latest_run_id)}`
    : `#/tickets/${slug}`;
  const statusBadge = t.status
    ? `<span class="badge badge-sm ${
        t.status === "done"
          ? "badge-success"
          : t.status === "in_progress"
            ? "badge-info"
            : "badge-ghost"
      }">${escapeHtml(t.status)}</span>`
    : "";
  return `
    <tr>
      <td class="font-mono text-xs">${escapeHtml(t.slug)}</td>
      <td class="text-xs">${escapeHtml(t.title ?? "-")}</td>
      <td class="text-xs">${statusBadge}</td>
      <td class="text-xs">${stateBadge(t.latest_run_state ?? null)}</td>
      <td class="text-xs opacity-70">${escapeHtml(t.opened_at ?? "-")}</td>
      <td><a href="${linkTarget}" class="btn btn-xs">Open</a></td>
    </tr>
  `;
}

function renderRunRow(r) {
  const safeId = encodeURIComponent(r.run_id);
  return `
    <tr>
      <td class="font-mono text-xs">${escapeHtml(r.run_id)}</td>
      <td class="font-mono text-xs">${escapeHtml(r.ticket_id ?? "-")}</td>
      <td class="text-xs">${stateBadge(r.current_state)}</td>
      <td class="text-xs opacity-70">${escapeHtml(r.saved_at ?? "-")}</td>
      <td><a href="#/runs/${safeId}" class="btn btn-xs">Open</a></td>
    </tr>
  `;
}

// ─── Run detail page ──────────────────────────────────────────────────────

async function initRunPage(runId) {
  let summary, note;
  try {
    summary = await fetchJson(`/api/runs/${encodeURIComponent(runId)}`);
  } catch (e) {
    renderError(e);
    return;
  }
  try {
    note = await fetchText(`/api/runs/${encodeURIComponent(runId)}/note`);
  } catch {
    note = "(note not found)";
  }
  lastSummary = summary;
  lastNote = note;
  renderRunPageShell(runId, summary, note);

  currentSse = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  currentSse.addEventListener("change", async () => {
    try {
      const fresh = await fetchJson(`/api/runs/${encodeURIComponent(runId)}`);
      let freshNote = lastNote;
      try {
        freshNote = await fetchText(`/api/runs/${encodeURIComponent(runId)}/note`);
      } catch { /* keep last */ }
      applyRunUpdate(fresh, freshNote);
    } catch (e) {
      // Surface but don't crash the SSE subscription.
      const status = document.getElementById("update-status");
      if (status) status.textContent = `(update error: ${String(e.message ?? e)})`;
    }
  });
}

function renderRunPageShell(runId, s, note) {
  app.innerHTML = `
    <header class="mb-6 flex items-center gap-3 flex-wrap">
      <a href="#/" class="btn btn-ghost btn-sm">← Runs</a>
      <h1 class="text-xl font-semibold font-mono">${escapeHtml(runId)}</h1>
      <span id="closed-badge">${s.closed ? '<span class="badge badge-success">closed</span>' : ""}</span>
      <span id="update-status" class="text-xs opacity-50 ml-auto"></span>
    </header>

    <section class="grid gap-4 md:grid-cols-2 mb-4">
      <div id="state-card" class="card bg-base-100 shadow">${renderStateCardInner(s)}</div>
      <div id="gate-card">${renderGateCardInner(runId, s)}</div>
    </section>

    <section id="turn-card-wrap" class="mb-4">${renderTurnCardWrap(runId, s)}</section>

    <section id="judgements-card" class="card bg-base-100 shadow mb-4">${renderJudgementsCardInner(s)}</section>

    <section id="gate-decisions-card" class="card bg-base-100 shadow mb-4">${renderGateDecisionsCardInner(s)}</section>

    <section class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title text-lg">note</h2>
        <pre id="note-pre" class="pre-wrap text-xs bg-base-200 p-3 rounded max-h-[600px] overflow-auto">${escapeHtml(note)}</pre>
      </div>
    </section>
  `;
  wireGateForm(runId);
  wireTurnForm(runId);
}

function applyRunUpdate(fresh, freshNote) {
  if (!lastSummary) return;
  const runId = fresh.run_id;

  // 1) Closed badge.
  if (lastSummary.closed !== fresh.closed) {
    const el = document.getElementById("closed-badge");
    if (el) el.innerHTML = fresh.closed ? '<span class="badge badge-success">closed</span>' : "";
  }

  // 2) State card — always replace inner HTML; no stateful inputs here.
  if (jsonChanged(lastSummary, fresh, ["current_state", "round", "last_guardian_decision", "saved_at", "ticket_id", "flow", "variant"])) {
    const el = document.getElementById("state-card");
    if (el) el.innerHTML = renderStateCardInner(fresh);
  }

  // 3) Gate card: only re-render if active_gate transitioned (open → close,
  //    or different node id). Preserves any half-typed approval form input.
  if (lastSummary.active_gate !== fresh.active_gate) {
    const el = document.getElementById("gate-card");
    if (el) {
      el.innerHTML = renderGateCardInner(runId, fresh);
      wireGateForm(runId);
    }
  }

  // 3b) Turn card (F-012): re-render only when active_turn identity changes
  //    (different node/turn) so half-typed answers survive snapshot writes.
  //    Also re-render when processing_answer flips so the "engine working"
  //    spinner appears/disappears across the answer→final window.
  const lastTurnKey = lastSummary.active_turn
    ? `${lastSummary.active_turn.node_id}|${lastSummary.active_turn.turn}`
    : "";
  const freshTurnKey = fresh.active_turn
    ? `${fresh.active_turn.node_id}|${fresh.active_turn.turn}`
    : "";
  if (lastTurnKey !== freshTurnKey || lastSummary.processing_answer !== fresh.processing_answer) {
    const wrap = document.getElementById("turn-card-wrap");
    if (wrap) {
      wrap.innerHTML = renderTurnCardWrap(runId, fresh);
      wireTurnForm(runId);
    }
  }

  // 4) Judgement list — replace if length/content changed.
  if (JSON.stringify(lastSummary.judgements) !== JSON.stringify(fresh.judgements)) {
    const el = document.getElementById("judgements-card");
    if (el) el.innerHTML = renderJudgementsCardInner(fresh);
  }

  // 5) Gate decisions — replace on change.
  if (JSON.stringify(lastSummary.gate_decisions) !== JSON.stringify(fresh.gate_decisions)) {
    const el = document.getElementById("gate-decisions-card");
    if (el) el.innerHTML = renderGateDecisionsCardInner(fresh);
  }

  // 6) Note — update textContent only (preserves scroll).
  if (lastNote !== freshNote) {
    const pre = document.getElementById("note-pre");
    if (pre) pre.textContent = freshNote;
  }

  lastSummary = fresh;
  lastNote = freshNote;
}

function jsonChanged(a, b, keys) {
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return true;
  }
  return false;
}

// ─── Card renderers (just inner content; container divs are stable) ───────

function renderStateCardInner(s) {
  return `
    <div class="card-body">
      <h2 class="card-title text-lg">State</h2>
      <dl class="grid grid-cols-3 gap-y-1 text-sm">
        <dt class="opacity-60">Ticket</dt><dd class="col-span-2 font-mono text-xs">${escapeHtml(s.ticket_id ?? "-")}</dd>
        <dt class="opacity-60">Flow</dt><dd class="col-span-2 font-mono text-xs">${escapeHtml(s.flow ?? "-")} / ${escapeHtml(s.variant ?? "-")}</dd>
        <dt class="opacity-60">Current</dt><dd class="col-span-2">${stateBadge(s.current_state)}</dd>
        <dt class="opacity-60">Round</dt><dd class="col-span-2">${s.round}</dd>
        <dt class="opacity-60">Last decision</dt><dd class="col-span-2 font-mono text-xs">${escapeHtml(s.last_guardian_decision ?? "-")}</dd>
        <dt class="opacity-60">Saved at</dt><dd class="col-span-2 text-xs opacity-70">${escapeHtml(s.saved_at ?? "-")}</dd>
      </dl>
    </div>
  `;
}

function renderGateCardInner(runId, s) {
  if (!s.active_gate) {
    return `
      <div class="card bg-base-100 shadow">
        <div class="card-body">
          <h2 class="card-title text-lg">Active gate</h2>
          <p class="text-sm opacity-70">No human approval pending right now.</p>
        </div>
      </div>
    `;
  }
  return `
    <div class="card bg-warning/10 border border-warning shadow">
      <div class="card-body">
        <h2 class="card-title text-lg">Approval needed: <span class="font-mono">${escapeHtml(s.active_gate)}</span></h2>
        <form id="gate-form" data-run-id="${escapeHtml(runId)}" data-node-id="${escapeHtml(s.active_gate)}" class="space-y-2">
          <label class="form-control">
            <span class="label-text text-xs">Comment (optional)</span>
            <textarea class="textarea textarea-bordered textarea-sm" name="comment" rows="2" placeholder="reason / note"></textarea>
          </label>
          <div class="flex gap-2 flex-wrap">
            <button type="submit" class="btn btn-success btn-sm" data-decision="approved">Approve</button>
            <button type="submit" class="btn btn-error btn-sm" data-decision="rejected">Reject</button>
            <button type="submit" class="btn btn-ghost btn-sm" data-decision="cancelled">Cancel run</button>
            <button type="button" class="btn btn-outline btn-sm" id="gate-open-term">Open in terminal</button>
          </div>
          <p id="gate-form-status" class="text-xs opacity-70"></p>
        </form>
      </div>
    </div>
  `;
}

// ─── F-012 turn card ──────────────────────────────────────────────────────

function renderTurnCardWrap(runId, s) {
  if (!s.active_turn) {
    if (s.processing_answer) {
      return `
        <div class="card bg-warning/10 border border-warning shadow">
          <div class="card-body py-3">
            <div class="flex items-center gap-3">
              <span class="loading loading-spinner loading-sm text-warning"></span>
              <div class="text-sm">
                <div class="font-medium">Engine is generating its response…</div>
                <div class="text-xs opacity-70">Your answer was accepted. The provider is now resuming and writing the final output. This usually takes a few seconds.</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }
    return "";
  }
  const t = s.active_turn;
  const optionsHtml = (t.options ?? [])
    .map((o, i) => {
      const desc = o.description
        ? `<span class="opacity-70 text-xs">— ${escapeHtml(o.description)}</span>`
        : "";
      return `
        <label class="flex items-start gap-2 cursor-pointer">
          <input type="radio" class="radio radio-sm mt-1" name="turn-option" value="${i}" data-label="${escapeHtml(o.label)}" />
          <span class="text-sm"><span class="font-medium">${escapeHtml(o.label)}</span> ${desc}</span>
        </label>`;
    })
    .join("");
  const hasOptions = (t.options ?? []).length > 0;
  return `
    <div class="card bg-info/10 border border-info shadow">
      <div class="card-body">
        <h2 class="card-title text-lg">In-step question — <span class="font-mono text-sm">${escapeHtml(t.node_id)}</span> turn ${t.turn}</h2>
        <p class="text-sm whitespace-pre-wrap">${escapeHtml(t.question)}</p>
        ${
          t.context
            ? `<details class="text-xs opacity-70"><summary>Context</summary><pre class="pre-wrap mt-1">${escapeHtml(t.context)}</pre></details>`
            : ""
        }
        <form id="turn-form"
              data-run-id="${escapeHtml(runId)}"
              data-node-id="${escapeHtml(t.node_id)}"
              data-turn="${t.turn}"
              class="space-y-2 mt-2">
          ${optionsHtml ? `<div class="space-y-1">${optionsHtml}</div>` : ""}
          <label class="form-control">
            <span class="label-text text-xs">Answer ${hasOptions ? "(optional — defaults to the selected option's label)" : "(required)"}</span>
            <textarea class="textarea textarea-bordered textarea-sm" name="text" rows="3" placeholder="${hasOptions ? "extra detail or override the option" : "your answer"}"${hasOptions ? "" : " required"}></textarea>
          </label>
          <div class="flex gap-2">
            <button type="submit" class="btn btn-info btn-sm">Submit answer</button>
            <button type="button" class="btn btn-outline btn-sm" id="turn-open-term">Open in terminal</button>
          </div>
          <p id="turn-form-status" class="text-xs opacity-70"></p>
        </form>
      </div>
    </div>
  `;
}

function wireTurnForm(runId) {
  const form = document.getElementById("turn-form");
  if (!form) return;
  const termBtn = document.getElementById("turn-open-term");
  if (termBtn) {
    termBtn.addEventListener("click", () => {
      const nodeId = form.dataset.nodeId;
      if (nodeId) openTerminalForNode(runId, nodeId);
    });
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const status = document.getElementById("turn-form-status");
    if (status) {
      status.textContent = "Submitting…";
      status.className = "text-xs opacity-70";
    }
    try {
      const nodeId = form.dataset.nodeId;
      const turn = form.dataset.turn;
      let text = String(data.get("text") ?? "").trim();
      const optRaw = data.get("turn-option");
      const body = {};
      let selected;
      if (optRaw !== null && optRaw !== "") {
        const n = Number(optRaw);
        if (Number.isInteger(n) && n >= 0) {
          selected = n;
          body.selected_option = n;
        }
      }
      // If no free-text but an option is picked, fall back to the
      // option's label so the engine has something to send the LLM.
      if (!text && selected !== undefined) {
        const radio = form.querySelector(`input[name="turn-option"][value="${selected}"]`);
        if (radio?.dataset?.label) text = radio.dataset.label;
      }
      if (!text) throw new Error("pick an option or supply an answer");
      body.text = text;
      const r = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/turns/${encodeURIComponent(nodeId)}/${encodeURIComponent(turn)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!r.ok) {
        const eb = await r.json().catch(() => ({}));
        throw new Error(eb.error ?? `HTTP ${r.status}`);
      }
      if (status) {
        status.textContent = "answer submitted — engine will resume the provider within ~1 s.";
        status.className = "text-xs text-success";
      }
    } catch (err) {
      if (status) {
        status.textContent = String(err.message ?? err);
        status.className = "text-xs text-error";
      }
    }
  });
}

function renderJudgementsCardInner(s) {
  return `
    <div class="card-body">
      <h2 class="card-title text-lg">Judgements (${s.judgements.length})</h2>
      ${
        s.judgements.length === 0
          ? '<p class="text-sm opacity-70">No frozen judgements yet.</p>'
          : `<div class="overflow-x-auto">
              <table class="table table-sm">
                <thead><tr><th>Node</th><th>Round</th><th>Decision</th></tr></thead>
                <tbody>
                  ${s.judgements
                    .map(
                      (j) => `<tr>
                        <td class="font-mono text-xs">${escapeHtml(j.node_id)}</td>
                        <td>${j.round}</td>
                        <td>${decisionBadge(j.decision)}</td>
                      </tr>`,
                    )
                    .join("")}
                </tbody>
              </table>
            </div>`
      }
    </div>
  `;
}

function renderGateDecisionsCardInner(s) {
  return `
    <div class="card-body">
      <h2 class="card-title text-lg">Gate decisions (${s.gate_decisions.length})</h2>
      ${
        s.gate_decisions.length === 0
          ? '<p class="text-sm opacity-70">No gate decisions yet.</p>'
          : `<ul class="text-sm space-y-1">
              ${s.gate_decisions
                .map(
                  (g) => `<li class="flex gap-3 items-center">
                    <span class="font-mono text-xs">${escapeHtml(g.node_id)}</span>
                    ${decisionBadge(g.decision)}
                    <span class="opacity-60 text-xs">${escapeHtml(g.decided_at)}</span>
                  </li>`,
                )
                .join("")}
            </ul>`
      }
    </div>
  `;
}

// ─── Form wiring ──────────────────────────────────────────────────────────

function wireGateForm() {
  const form = document.getElementById("gate-form");
  if (!form) return;
  const termBtn = document.getElementById("gate-open-term");
  if (termBtn) {
    termBtn.addEventListener("click", () => {
      const runId = form.dataset.runId;
      const nodeId = form.dataset.nodeId;
      if (runId && nodeId) openTerminalForNode(runId, nodeId, { mode: "fresh" });
    });
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitter = e.submitter || form.lastSubmitter || document.activeElement;
    const decision = submitter?.dataset?.decision ?? "approved";
    const data = new FormData(form);
    const status = document.getElementById("gate-form-status");
    if (status) {
      status.textContent = "Submitting…";
      status.className = "text-xs opacity-70";
    }
    try {
      const runId = form.dataset.runId;
      const nodeId = form.dataset.nodeId;
      const r = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/gates/${encodeURIComponent(nodeId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            comment: String(data.get("comment") ?? "").trim() || undefined,
          }),
        },
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      if (status) {
        status.textContent = `${decision} — engine should pick this up within ~1 s.`;
        status.className = "text-xs text-success";
      }
    } catch (err) {
      if (status) {
        status.textContent = String(err.message ?? err);
        status.className = "text-xs text-error";
      }
    }
  });
}

// Capture the actual submit button across user clicks (for browsers that
// don't surface SubmitEvent.submitter — narrow case but cheap to handle).
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button[type=submit]");
  if (!btn) return;
  const form = btn.closest("form");
  if (form) form.lastSubmitter = btn;
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function stateBadge(state) {
  if (!state) return '<span class="badge badge-ghost">unknown</span>';
  if (state === "terminal" || state === "__success__") {
    return `<span class="badge badge-success">${escapeHtml(state)}</span>`;
  }
  if (state === "__failed__" || state.includes("human_intervention")) {
    return `<span class="badge badge-error">${escapeHtml(state)}</span>`;
  }
  if (state.endsWith("_gate") || state === "review_gate") {
    return `<span class="badge badge-warning">${escapeHtml(state)}</span>`;
  }
  return `<span class="badge badge-info">${escapeHtml(state)}</span>`;
}

function decisionBadge(decision) {
  const cls = {
    pass: "badge-success",
    approved: "badge-success",
    repair_needed: "badge-warning",
    rejected: "badge-error",
    cancelled: "badge-ghost",
    abort: "badge-error",
    escalate_human: "badge-error",
  }[decision] ?? "badge-info";
  return `<span class="badge ${cls}">${escapeHtml(decision)}</span>`;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderError(e) {
  app.innerHTML = `
    <div class="alert alert-error">
      <span class="font-mono text-xs">${escapeHtml(e.message ?? String(e))}</span>
    </div>
    <p class="mt-3 text-sm">
      <a href="#/" class="link">← Back to runs</a>
    </p>
  `;
}

// ─── Term-webui modal (xterm.js + WebSocket against /api/assist/ws) ──────
//
// Lazy-loads xterm at first open (script tags from /assets/, served by
// the backend out of node_modules). Mirrors v1's TerminalModal but
// without React. One modal element is appended to <body> on demand; we
// reuse it across opens.

let _xtermLoaded = null;
async function loadXterm() {
  if (_xtermLoaded) return _xtermLoaded;
  _xtermLoaded = (async () => {
    if (window.Terminal && window.FitAddon) return;
    const load = (src) => new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-src="${src}"]`);
      if (existing) return resolve();
      const el = document.createElement("script");
      el.src = src;
      el.dataset.src = src;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`failed to load ${src}`));
      document.head.appendChild(el);
    });
    await load("/assets/xterm.js");
    await load("/assets/xterm-addon-fit.js");
    await load("/assets/xterm-addon-web-links.js");
  })();
  return _xtermLoaded;
}

const TERM_QUICK_KEYS = [
  { label: "Enter", seq: "\r", tone: "primary" },
  { label: "Esc",   seq: "\u001b" },
  { label: "Tab",   seq: "\t" },
  { label: "↑",     seq: "\u001b[A" },
  { label: "↓",     seq: "\u001b[B" },
  { label: "←",     seq: "\u001b[D" },
  { label: "→",     seq: "\u001b[C" },
  { label: "y",     seq: "y" },
  { label: "n",     seq: "n" },
  { label: "^C",    seq: "\u0003", title: "send SIGINT" },
  { label: "^D",    seq: "\u0004", title: "EOF" },
];

function ensureTermModal() {
  let dlg = document.getElementById("term-modal");
  if (dlg) return dlg;
  dlg = document.createElement("dialog");
  dlg.id = "term-modal";
  dlg.className = "modal";
  dlg.innerHTML = `
    <div class="modal-box max-w-5xl w-11/12 p-3 sm:p-4 flex flex-col" style="height:min(90vh,720px)">
      <div class="flex items-center justify-between gap-3 pb-2">
        <div class="flex items-center gap-2 min-w-0">
          <h3 id="term-title" class="font-bold truncate">Terminal</h3>
          <span id="term-status" class="badge badge-ghost badge-sm">connecting</span>
        </div>
        <form method="dialog">
          <button class="btn btn-sm btn-ghost" type="submit">Close</button>
        </form>
      </div>
      <div id="term-submitted-banner" class="alert alert-success py-2 mb-2" style="display:none">
        <span id="term-submitted-msg" class="flex-1 text-sm">Answer submitted. Close terminal and continue?</span>
        <button id="term-close-yes" type="button" class="btn btn-sm btn-success">Yes, close</button>
        <button id="term-close-no" type="button" class="btn btn-sm btn-ghost">No, stay</button>
      </div>
      <div id="term-host" class="term-host flex-1"></div>
      <div id="term-quickkeys" class="flex flex-wrap items-center gap-1 pt-2"></div>
    </div>
    <form method="dialog" class="modal-backdrop"><button>close</button></form>
  `;
  // Build quick-key buttons in DOM so the control sequences live as
  // JS data, not encoded in HTML attributes (where escape characters
  // are awkward and easy to mangle).
  const bar = dlg.querySelector("#term-quickkeys");
  for (let i = 0; i < TERM_QUICK_KEYS.length; i++) {
    const k = TERM_QUICK_KEYS[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-xs " + (k.tone === "primary" ? "btn-primary" : "btn-outline");
    btn.textContent = k.label;
    if (k.title) btn.title = k.title;
    btn.dataset.seqIndex = String(i);
    bar.appendChild(btn);
  }
  document.body.appendChild(dlg);
  return dlg;
}

let _termState = null;
function teardownTerm() {
  if (!_termState) return;
  _termState.cancelled = true;
  if (_termState.reconnectTimer) clearTimeout(_termState.reconnectTimer);
  try { _termState.ws?.close(); } catch {}
  try { _termState.term?.dispose(); } catch {}
  try { _termState.resizeObserver?.disconnect(); } catch {}
  _termState = null;
}

async function openTerminalForNode(runId, nodeId, options) {
  const opts = options || {};
  const mode = opts.mode === "fresh" ? "fresh" : "resume";
  const dlg = ensureTermModal();
  dlg.dataset.runId = runId;
  dlg.dataset.nodeId = nodeId;
  const titleEl = dlg.querySelector("#term-title");
  const statusEl = dlg.querySelector("#term-status");
  const hostEl = dlg.querySelector("#term-host");
  const banner = dlg.querySelector("#term-submitted-banner");
  const bannerMsg = dlg.querySelector("#term-submitted-msg");
  if (banner) banner.style.display = "none";
  if (bannerMsg) bannerMsg.classList.remove("text-error");
  hostEl.innerHTML = "";
  titleEl.textContent = `${nodeId} · ${runId}`;
  setTermStatus(statusEl, "connecting");
  if (!dlg.open) dlg.showModal();
  // Reset prior state.
  teardownTerm();

  // 1. Ask backend to spawn (or reuse) a session.
  let sessionInfo;
  try {
    const r = await fetch("/api/assist/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId, node_id: nodeId, mode }),
    });
    sessionInfo = await r.json();
    if (!r.ok) throw new Error(sessionInfo.error ?? `HTTP ${r.status}`);
  } catch (e) {
    setTermStatus(statusEl, "failed");
    hostEl.innerHTML = `<div class="alert alert-error m-2">open failed: ${escapeHtml(e.message ?? String(e))}</div>`;
    return;
  }
  if (sessionInfo.title) titleEl.textContent = `${sessionInfo.title} · ${runId}`;

  // 2. Load xterm and create the terminal.
  try {
    await loadXterm();
  } catch (e) {
    setTermStatus(statusEl, "failed");
    hostEl.innerHTML = `<div class="alert alert-error m-2">xterm load failed: ${escapeHtml(e.message ?? String(e))}</div>`;
    return;
  }
  const Terminal = window.Terminal;
  const FitAddon = window.FitAddon?.FitAddon ?? window.FitAddon;
  const WebLinksAddon = window.WebLinksAddon?.WebLinksAddon ?? window.WebLinksAddon;
  if (!Terminal || !FitAddon) {
    setTermStatus(statusEl, "failed");
    hostEl.textContent = "xterm globals not found after script load";
    return;
  }
  const term = new Terminal({
    convertEol: true,
    theme: { background: "#1f1d18", foreground: "#f5e6c8" },
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  if (WebLinksAddon) try { term.loadAddon(new WebLinksAddon()); } catch {}
  term.open(hostEl);
  try { fit.fit(); } catch {}

  // 3. Connect WS with reconnect.
  const state = {
    cancelled: false,
    term,
    fit,
    ws: null,
    reconnectTimer: null,
    attempt: 0,
    sessionId: sessionInfo.sessionId,
    resizeObserver: null,
  };
  _termState = state;

  const ro = new ResizeObserver(() => {
    if (!state.term) return;
    try { state.fit.fit(); } catch {}
    if (state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: "resize", cols: state.term.cols, rows: state.term.rows }));
    }
  });
  ro.observe(hostEl);
  state.resizeObserver = ro;

  term.onData((data) => {
    if (state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: "input", data }));
    }
  });

  function connect() {
    if (state.cancelled) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/assist/ws?session=${encodeURIComponent(state.sessionId)}`;
    const ws = new WebSocket(url);
    state.ws = ws;
    ws.addEventListener("open", () => {
      state.attempt = 0;
      setTermStatus(statusEl, "running");
      if (term.cols && term.rows) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
      term.focus();
    });
    ws.addEventListener("message", (event) => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (!payload) return;
      if (payload.type === "snapshot") {
        if (payload.title) titleEl.textContent = payload.title;
        if (payload.status) setTermStatus(statusEl, payload.status);
        if (payload.data) term.write(payload.data);
      } else if (payload.type === "output" && typeof payload.data === "string") {
        term.write(payload.data);
      } else if (payload.type === "submitted") {
        showSubmittedBanner(dlg, payload.kind, payload);
      } else if (payload.type === "exit") {
        setTermStatus(statusEl, "exited");
        term.writeln("");
        term.writeln(`[assist session exited code=${payload.exitCode ?? "?"}]`);
      } else if (payload.type === "error") {
        term.writeln("");
        term.writeln(`[assist error] ${payload.message ?? "unknown"}`);
      }
    });
    ws.addEventListener("close", () => {
      if (state.cancelled) return;
      const cur = statusEl.textContent;
      if (cur !== "exited") setTermStatus(statusEl, "reconnecting");
      const delay = Math.min(10_000, 500 * 2 ** Math.min(state.attempt, 5));
      state.attempt += 1;
      if (state.attempt === 1) {
        term.writeln("");
        term.writeln("[connection lost — reconnecting...]");
      }
      state.reconnectTimer = setTimeout(() => { if (!state.cancelled) connect(); }, delay);
    });
    ws.addEventListener("error", () => { /* close handler runs reconnect */ });
  }
  connect();

  // 4. Quick keys: map click → control sequence from TERM_QUICK_KEYS.
  const quickHandler = (e) => {
    const btn = e.target.closest("button[data-seq-index]");
    if (!btn) return;
    const idx = Number(btn.dataset.seqIndex);
    const k = TERM_QUICK_KEYS[idx];
    if (!k) return;
    if (state.ws?.readyState === WebSocket.OPEN && k.seq) {
      state.ws.send(JSON.stringify({ type: "input", data: k.seq }));
      term.focus();
    }
  };
  dlg.addEventListener("click", quickHandler, { passive: true });
  state.quickHandler = quickHandler;

  // 5. On close, tear everything down.
  dlg.addEventListener("close", () => {
    teardownTerm();
  }, { once: true });
}

function showSubmittedBanner(dlg, kind, payload) {
  const banner = dlg.querySelector("#term-submitted-banner");
  const msg = dlg.querySelector("#term-submitted-msg");
  if (!banner || !msg) return;
  msg.textContent = kind === "gate"
    ? "Gate decision drafted. Confirm and close?"
    : "Answer drafted. Confirm and close?";
  banner.style.display = "";
  // Stash the kind + turn for the Yes handler.
  banner.dataset.kind = kind;
  if (typeof payload?.turn === "number") {
    banner.dataset.turn = String(payload.turn);
  } else {
    delete banner.dataset.turn;
  }
  const yes = dlg.querySelector("#term-close-yes");
  const no = dlg.querySelector("#term-close-no");
  if (yes && !yes._wired) {
    yes._wired = true;
    yes.addEventListener("click", async () => {
      // Reach into the active term state for runId / nodeId. The
      // dialog itself is reused so we keep these on the dataset.
      const runId = dlg.dataset.runId;
      const nodeId = dlg.dataset.nodeId;
      const turnIdx = banner.dataset.turn;
      const k = banner.dataset.kind;
      msg.textContent = "Confirming…";
      try {
        const url = k === "gate"
          ? `/api/runs/${encodeURIComponent(runId)}/gates/${encodeURIComponent(nodeId)}/confirm`
          : `/api/runs/${encodeURIComponent(runId)}/turns/${encodeURIComponent(nodeId)}/${encodeURIComponent(turnIdx)}/confirm`;
        const r = await fetch(url, { method: "POST" });
        const eb = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(eb.error ?? `HTTP ${r.status}`);
        try { dlg.close(); } catch {}
      } catch (err) {
        msg.textContent = `confirm failed: ${err.message ?? err}`;
        msg.classList.add("text-error");
      }
    });
  }
  if (no && !no._wired) {
    no._wired = true;
    no.addEventListener("click", () => {
      banner.style.display = "none";
    });
  }
}

function setTermStatus(el, s) {
  if (!el) return;
  el.textContent = s;
  el.className = "badge badge-sm " + (
    s === "running" ? "badge-info" :
    s === "exited" ? "badge-neutral" :
    s === "failed" ? "badge-error" :
    s === "reconnecting" ? "badge-warning" :
    "badge-ghost"
  );
}

window.openTerminalForNode = openTerminalForNode;

// ─── Boot ─────────────────────────────────────────────────────────────────

switchPage();
