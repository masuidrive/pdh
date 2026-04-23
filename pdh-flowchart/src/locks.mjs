import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";

const DEFAULT_STALE_MS = 12 * 60 * 60 * 1000;

export class RunLockError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RunLockError";
    this.details = details;
  }
}

export async function withRunLock({ stateDir, runId, waitMs = 0, staleMs = DEFAULT_STALE_MS }, action) {
  const lock = await acquireRunLock({ stateDir, runId, waitMs, staleMs });
  try {
    return await action(lock);
  } finally {
    lock.release();
  }
}

export async function acquireRunLock({ stateDir, runId, waitMs = 0, staleMs = DEFAULT_STALE_MS }) {
  if (!runId) {
    throw new Error("runId is required for run lock");
  }
  const locksDir = join(stateDir, "locks");
  const lockPath = join(locksDir, `${safeLockName(runId)}.lock`);
  const startedAt = Date.now();

  while (true) {
    const result = tryAcquire({ locksDir, lockPath, runId, staleMs });
    if (result.lock) {
      return result.lock;
    }
    if (result.staleRemoved) {
      continue;
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= waitMs) {
      throw new RunLockError(formatLockedMessage({ runId, lockPath, holder: result.holder, waitMs }), {
        runId,
        lockPath,
        holder: result.holder
      });
    }
    await sleep(Math.min(250, waitMs - elapsed));
  }
}

function tryAcquire({ locksDir, lockPath, runId, staleMs }) {
  mkdirSync(locksDir, { recursive: true });
  const token = randomUUID();
  const owner = {
    runId,
    token,
    pid: process.pid,
    hostname: hostname(),
    cwd: process.cwd(),
    acquiredAt: new Date().toISOString()
  };

  let fd = null;
  try {
    fd = openSync(lockPath, "wx", 0o600);
    writeFileSync(fd, `${JSON.stringify(owner, null, 2)}\n`);
    return { lock: createLock({ lockPath, token, owner }) };
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }

  const holder = readHolder(lockPath);
  if (isStaleLock({ lockPath, holder, staleMs })) {
    try {
      unlinkSync(lockPath);
      return { staleRemoved: true };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      return { staleRemoved: true };
    }
  }
  return { lock: null, staleRemoved: false, holder };
}

function createLock({ lockPath, token, owner }) {
  return {
    path: lockPath,
    owner,
    release() {
      const holder = readHolder(lockPath);
      if (holder?.token !== token) {
        return;
      }
      try {
        unlinkSync(lockPath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
  };
}

function readHolder(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function isStaleLock({ lockPath, holder, staleMs }) {
  if (holder?.hostname === hostname() && Number.isInteger(holder.pid)) {
    return !pidIsAlive(holder.pid);
  }
  try {
    return Date.now() - statSync(lockPath).mtimeMs > staleMs;
  } catch (error) {
    return error.code === "ENOENT";
  }
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function formatLockedMessage({ runId, lockPath, holder, waitMs }) {
  const owner = holder
    ? `pid ${holder.pid ?? "unknown"} on ${holder.hostname ?? "unknown"} since ${holder.acquiredAt ?? "unknown"}`
    : "an unknown owner";
  const wait = waitMs > 0 ? ` after waiting ${waitMs}ms` : "";
  return `Run ${runId} is already locked by ${owner}${wait}. Lock file: ${lockPath}`;
}

function safeLockName(runId) {
  return String(runId).replace(/[^A-Za-z0-9_.-]/g, "_");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
