// pdh-flow v2 Web UI MVP — vanilla JS, polls the engine's filesystem state
// every 2 s, renders run summary + gate approval form. No build step.

const POLL_MS = 2000;
const app = document.getElementById("app");

let currentRunId = readRunFromHash();
let polling = false;
let pollTimer = null;

window.addEventListener("hashchange", () => {
  currentRunId = readRunFromHash();
  startPolling();
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

function startPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollOnce();
}

async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    if (currentRunId) {
      await renderRunPage(currentRunId);
    } else {
      await renderHomePage();
    }
  } catch (e) {
    renderError(e);
  } finally {
    polling = false;
    pollTimer = setTimeout(pollOnce, POLL_MS);
  }
}

// ─── Pages ────────────────────────────────────────────────────────────────

async function renderHomePage() {
  const runs = await fetchJson("/api/runs");
  app.innerHTML = `
    <header class="mb-6 flex items-center gap-3">
      <h1 class="text-2xl font-semibold">pdh-flow v2</h1>
      <span class="badge badge-ghost">Web UI MVP</span>
    </header>
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title text-lg">Runs</h2>
        ${
          runs.length === 0
            ? '<p class="text-sm opacity-70">No runs yet. Start the engine on a worktree, then come back.</p>'
            : `<div class="overflow-x-auto">
                <table class="table table-zebra table-sm">
                  <thead><tr><th>Run ID</th><th>Ticket</th><th>State</th><th>Saved</th><th></th></tr></thead>
                  <tbody>
                    ${runs.map(renderRunRow).join("")}
                  </tbody>
                </table>
              </div>`
        }
      </div>
    </div>
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

async function renderRunPage(runId) {
  let summary;
  try {
    summary = await fetchJson(`/api/runs/${encodeURIComponent(runId)}`);
  } catch (e) {
    return renderError(e);
  }

  let note = "";
  try {
    note = await fetchText(`/api/runs/${encodeURIComponent(runId)}/note`);
  } catch {
    note = "(current-note.md not found)";
  }

  app.innerHTML = `
    <header class="mb-6 flex items-center gap-3 flex-wrap">
      <a href="#/" class="btn btn-ghost btn-sm">← Runs</a>
      <h1 class="text-xl font-semibold font-mono">${escapeHtml(runId)}</h1>
      ${summary.closed ? '<span class="badge badge-success">closed</span>' : ""}
    </header>

    <section class="grid gap-4 md:grid-cols-2 mb-4">
      ${renderSummaryCard(summary)}
      ${renderGateCard(summary)}
    </section>

    <section class="card bg-base-100 shadow mb-4">
      <div class="card-body">
        <h2 class="card-title text-lg">Judgements (${summary.judgements.length})</h2>
        ${
          summary.judgements.length === 0
            ? '<p class="text-sm opacity-70">No frozen judgements yet.</p>'
            : `<div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead><tr><th>Node</th><th>Round</th><th>Decision</th></tr></thead>
                  <tbody>
                    ${summary.judgements
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
    </section>

    <section class="card bg-base-100 shadow mb-4">
      <div class="card-body">
        <h2 class="card-title text-lg">Gate decisions (${summary.gate_decisions.length})</h2>
        ${
          summary.gate_decisions.length === 0
            ? '<p class="text-sm opacity-70">No gate decisions yet.</p>'
            : `<ul class="text-sm space-y-1">
                ${summary.gate_decisions
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
    </section>

    <section class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title text-lg">current-note.md</h2>
        <pre class="pre-wrap text-xs bg-base-200 p-3 rounded max-h-[600px] overflow-auto">${escapeHtml(note)}</pre>
      </div>
    </section>
  `;

  // Wire gate form if present.
  const form = document.getElementById("gate-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitGate(runId, summary.active_gate, e.target);
    });
  }
}

function renderSummaryCard(s) {
  return `
    <div class="card bg-base-100 shadow">
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
    </div>
  `;
}

function renderGateCard(s) {
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
        <form id="gate-form" class="space-y-2">
          <label class="form-control">
            <span class="label-text text-xs">Approver</span>
            <input class="input input-bordered input-sm" name="approver" placeholder="your name" required />
          </label>
          <label class="form-control">
            <span class="label-text text-xs">Comment (optional)</span>
            <textarea class="textarea textarea-bordered textarea-sm" name="comment" rows="2" placeholder="reason / note"></textarea>
          </label>
          <div class="flex gap-2">
            <button type="submit" class="btn btn-success btn-sm" data-decision="approved">Approve</button>
            <button type="submit" class="btn btn-error btn-sm" data-decision="rejected">Reject</button>
            <button type="submit" class="btn btn-ghost btn-sm" data-decision="cancelled">Cancel run</button>
          </div>
          <p id="gate-form-status" class="text-xs opacity-70"></p>
        </form>
      </div>
    </div>
  `;
}

async function submitGate(runId, nodeId, formEl) {
  // Determine which submit button was clicked. document.activeElement is the
  // element with focus when the form was submitted.
  const submitter = formEl.lastSubmitter || document.activeElement;
  const decision = submitter?.dataset?.decision ?? "approved";
  const data = new FormData(formEl);
  const status = document.getElementById("gate-form-status");
  if (status) status.textContent = "Submitting…";
  try {
    const r = await fetch(
      `/api/runs/${encodeURIComponent(runId)}/gates/${encodeURIComponent(nodeId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          approver: String(data.get("approver") ?? "").trim(),
          comment: String(data.get("comment") ?? "").trim() || undefined,
        }),
      },
    );
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${r.status}`);
    }
    if (status) {
      status.textContent = `${decision} — engine should pick this up within a poll cycle (~1 s).`;
      status.className = "text-xs text-success";
    }
  } catch (e) {
    if (status) {
      status.textContent = String(e.message ?? e);
      status.className = "text-xs text-error";
    }
  }
}

// ─── Capture submitter for FormData ──────────────────────────────────────
// Form submit events don't expose the clicked button on .target. Track it.
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

// ─── Boot ─────────────────────────────────────────────────────────────────

startPolling();
