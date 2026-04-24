import { spawn } from "node:child_process";

export function spawnProvider(command, args, options) {
  return spawn(command, args, {
    ...options,
    detached: process.platform !== "win32"
  });
}

export function createProcessTimeout({
  child,
  timeoutMs = null,
  idleTimeoutMs = null,
  killGraceMs = 5000,
  onTimeout = () => {},
  onKill = () => {},
  onTerminateError = () => {}
}) {
  if ((!timeoutMs || timeoutMs <= 0) && (!idleTimeoutMs || idleTimeoutMs <= 0)) {
    return {
      get timedOut() {
        return false;
      },
      get timeoutKind() {
        return null;
      },
      touch() {},
      clear() {}
    };
  }

  let timedOut = false;
  let timeoutKind = null;
  let killTimer = null;
  let idleTimer = null;

  const armKillTimer = (budgetMs, kind) => {
    killTimer = setTimeout(() => {
      onKill({ timeoutMs: budgetMs, signal: "SIGKILL", kind });
      tryTerminateProcessTree(child, "SIGKILL", (error) => onTerminateError({ timeoutMs: budgetMs, signal: "SIGKILL", kind, error }));
    }, killGraceMs);
    killTimer.unref?.();
  };

  const triggerTimeout = (budgetMs, kind) => {
    if (timedOut) {
      return;
    }
    timedOut = true;
    timeoutKind = kind;
    clearTimeout(timer);
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    onTimeout({ timeoutMs: budgetMs, signal: "SIGTERM", kind });
    tryTerminateProcessTree(child, "SIGTERM", (error) => onTerminateError({ timeoutMs: budgetMs, signal: "SIGTERM", kind, error }));
    armKillTimer(budgetMs, kind);
  };

  const timer = timeoutMs > 0 ? setTimeout(() => {
    triggerTimeout(timeoutMs, "wall");
  }, timeoutMs) : null;
  if (timer) {
    timer.unref?.();
  }

  const armIdleTimer = () => {
    if (!idleTimeoutMs || idleTimeoutMs <= 0 || timedOut) {
      return;
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      triggerTimeout(idleTimeoutMs, "idle");
    }, idleTimeoutMs);
    idleTimer.unref?.();
  };

  armIdleTimer();

  return {
    get timedOut() {
      return timedOut;
    },
    get timeoutKind() {
      return timeoutKind;
    },
    touch() {
      armIdleTimer();
    },
    clear() {
      if (timer) {
        clearTimeout(timer);
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
    }
  };
}

function tryTerminateProcessTree(child, signal, onError) {
  try {
    terminateProcessTree(child, signal);
  } catch (error) {
    onError(error);
  }
}

export function terminateProcessTree(child, signal) {
  if (!child.pid) {
    return;
  }
  try {
    if (process.platform === "win32") {
      child.kill(signal);
      return;
    }
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") {
      throw error;
    }
  }
}
