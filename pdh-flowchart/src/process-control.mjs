import { spawn } from "node:child_process";

export function spawnProvider(command, args, options) {
  return spawn(command, args, {
    ...options,
    detached: process.platform !== "win32"
  });
}

export function createProcessTimeout({ child, timeoutMs = null, killGraceMs = 5000, onTimeout = () => {}, onKill = () => {}, onTerminateError = () => {} }) {
  if (!timeoutMs || timeoutMs <= 0) {
    return {
      get timedOut() {
        return false;
      },
      clear() {}
    };
  }

  let timedOut = false;
  let killTimer = null;
  const timer = setTimeout(() => {
    timedOut = true;
    onTimeout({ timeoutMs, signal: "SIGTERM" });
    tryTerminateProcessTree(child, "SIGTERM", (error) => onTerminateError({ timeoutMs, signal: "SIGTERM", error }));
    killTimer = setTimeout(() => {
      onKill({ timeoutMs, signal: "SIGKILL" });
      tryTerminateProcessTree(child, "SIGKILL", (error) => onTerminateError({ timeoutMs, signal: "SIGKILL", error }));
    }, killGraceMs);
    killTimer.unref?.();
  }, timeoutMs);
  timer.unref?.();

  return {
    get timedOut() {
      return timedOut;
    },
    clear() {
      clearTimeout(timer);
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
