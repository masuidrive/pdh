import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function defaultStateDir(repoPath = process.cwd()) {
  return join(repoPath, ".pdh-flowchart");
}

export function openStore(stateDir = defaultStateDir()) {
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(join(stateDir, "runs"), { recursive: true });
  const dbPath = join(stateDir, "state.sqlite");
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      flow_variant TEXT NOT NULL,
      ticket_id TEXT,
      status TEXT NOT NULL,
      current_step_id TEXT,
      repo_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS run_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      round INTEGER NOT NULL DEFAULT 1,
      provider TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      exit_code INTEGER,
      summary TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS progress_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      step_id TEXT,
      attempt INTEGER NOT NULL DEFAULT 1,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      provider TEXT,
      message TEXT,
      payload_json TEXT
    );
    CREATE TABLE IF NOT EXISTS provider_sessions (
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      provider TEXT NOT NULL,
      session_id TEXT,
      resume_token TEXT,
      raw_log_path TEXT,
      PRIMARY KEY (run_id, step_id, attempt, provider)
    );
    CREATE TABLE IF NOT EXISTS human_gates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt TEXT,
      summary TEXT,
      decision TEXT,
      reason TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
  `);
  return new Store(db, stateDir);
}

export class Store {
  constructor(db, stateDir) {
    this.db = db;
    this.stateDir = stateDir;
  }

  createRun({ flowId, flowVariant, ticketId, repoPath, currentStepId }) {
    const now = new Date().toISOString();
    const id = `run-${now.replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare(`
      INSERT INTO runs (id, flow_id, flow_variant, ticket_id, status, current_step_id, repo_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, flowId, flowVariant, ticketId ?? null, "running", currentStepId ?? null, repoPath, now, now);
    return id;
  }

  getRun(runId) {
    return this.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  }

  updateRun(runId, fields) {
    const current = this.getRun(runId);
    if (!current) {
      throw new Error(`Run not found: ${runId}`);
    }
    const next = { ...current, ...fields, updated_at: new Date().toISOString() };
    this.db.prepare(`
      UPDATE runs
      SET status = ?, current_step_id = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(next.status, next.current_step_id, next.updated_at, next.completed_at ?? null, runId);
  }

  startStep({ runId, stepId, attempt = 1, provider, mode }) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO run_steps (run_id, step_id, attempt, provider, mode, status, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(runId, stepId, attempt, provider, mode, "running", now);
    this.addEvent({ runId, stepId, attempt, type: "step_started", provider, message: `${stepId} started` });
  }

  finishStep({ runId, stepId, attempt = 1, provider, status, exitCode = null, summary = null, error = null }) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE run_steps
      SET status = ?, finished_at = ?, exit_code = ?, summary = ?, error = ?
      WHERE run_id = ? AND step_id = ? AND attempt = ?
    `).run(status, now, exitCode, summary, error, runId, stepId, attempt);
    this.addEvent({ runId, stepId, attempt, type: "step_finished", provider, message: `${stepId} ${status}`, payload: { exitCode, summary, error } });
  }

  nextStepAttempt({ runId, stepId, provider }) {
    const row = this.db.prepare(`
      SELECT MAX(attempt) AS attempt
      FROM run_steps
      WHERE run_id = ? AND step_id = ? AND provider = ?
    `).get(runId, stepId, provider);
    return Number(row?.attempt ?? 0) + 1;
  }

  addEvent({ runId, stepId = null, attempt = 1, type, provider = null, message = null, payload = {} }) {
    this.db.prepare(`
      INSERT INTO progress_events (run_id, step_id, attempt, ts, type, provider, message, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(runId, stepId, attempt, new Date().toISOString(), type, provider, message, JSON.stringify(payload));
  }

  recentEvents(runId, limit = 20) {
    return this.db.prepare(`
      SELECT * FROM progress_events
      WHERE run_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(runId, limit).reverse();
  }

  eventsAfter(runId, afterId = 0, limit = 100) {
    return this.db.prepare(`
      SELECT * FROM progress_events
      WHERE run_id = ? AND id > ?
      ORDER BY id ASC
      LIMIT ?
    `).all(runId, afterId, limit);
  }

  latestHumanGate(runId, stepId) {
    return this.db.prepare(`
      SELECT * FROM human_gates
      WHERE run_id = ? AND step_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(runId, stepId);
  }

  saveProviderSession({ runId, stepId, attempt = 1, provider, sessionId = null, resumeToken = null, rawLogPath = null }) {
    this.db.prepare(`
      INSERT OR REPLACE INTO provider_sessions (run_id, step_id, attempt, provider, session_id, resume_token, raw_log_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(runId, stepId, attempt, provider, sessionId, resumeToken, rawLogPath);
  }

  latestProviderSession(runId, stepId, provider) {
    return this.db.prepare(`
      SELECT *
      FROM provider_sessions
      WHERE run_id = ? AND step_id = ? AND provider = ?
      ORDER BY attempt DESC
      LIMIT 1
    `).get(runId, stepId, provider);
  }

  openHumanGate({ runId, stepId, prompt, summary }) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO human_gates (run_id, step_id, status, prompt, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(runId, stepId, "needs_human", prompt ?? null, summary ?? null, now);
    this.updateRun(runId, { status: "needs_human", current_step_id: stepId });
    this.addEvent({ runId, stepId, type: "ask_human", provider: "runtime", message: prompt ?? `${stepId} needs human decision` });
  }

  resolveHumanGate({ runId, stepId, decision, reason = null }) {
    const now = new Date().toISOString();
    const existing = this.db.prepare(`
      SELECT id FROM human_gates
      WHERE run_id = ? AND step_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(runId, stepId);
    if (existing) {
      this.db.prepare(`
        UPDATE human_gates
        SET status = ?, decision = ?, reason = ?, resolved_at = ?
        WHERE id = ?
      `).run("resolved", decision, reason, now, existing.id);
    } else {
      this.db.prepare(`
        INSERT INTO human_gates (run_id, step_id, status, decision, reason, created_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(runId, stepId, "resolved", decision, reason, now, now);
    }
    this.updateRun(runId, { status: decision === "approved" ? "running" : "blocked", current_step_id: stepId });
    this.addEvent({ runId, stepId, type: "human_decision", provider: "runtime", message: `${stepId} ${decision}`, payload: { reason } });
  }
}
