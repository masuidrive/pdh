import { useEffect, useRef, useState } from "react";
import { actions } from "../lib/api";

type Props = {
  open: boolean;
  stepId?: string | null;
  ticketId?: string | null;
  sessionId?: string | null;
  forceReprompt?: boolean;
  onClose: () => void;
};

declare global {
  interface Window {
    Terminal?: typeof import("@xterm/xterm").Terminal;
    FitAddon?: { FitAddon: typeof import("@xterm/addon-fit").FitAddon };
    WebLinksAddon?: { WebLinksAddon: typeof import("@xterm/addon-web-links").WebLinksAddon };
  }
}

type SocketShape = {
  send: (data: string) => void;
  close: () => void;
  readyState: number;
};

const QUICK_KEYS: { label: string; sequence: string; tone?: string }[] = [
  { label: "Enter", sequence: "\r", tone: "primary" },
  { label: "Esc", sequence: "\u001b" },
  { label: "Tab", sequence: "\t" },
  { label: "↑", sequence: "\u001b[A" },
  { label: "↓", sequence: "\u001b[B" },
  { label: "←", sequence: "\u001b[D" },
  { label: "→", sequence: "\u001b[C" },
  { label: "y", sequence: "y" },
  { label: "n", sequence: "n" },
];

const LOGIN_HINTS = [
  "/login",
  "not logged in",
  "authentication credentials",
  "authentication_error",
  "api error: 401",
];

function detectLogin(text: string) {
  const lower = text.toLowerCase();
  return LOGIN_HINTS.some((hint) => lower.includes(hint));
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.dataset.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
}

function loadCss(href: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`link[data-href="${href}"]`);
    if (existing) {
      resolve();
      return;
    }
    const el = document.createElement("link");
    el.rel = "stylesheet";
    el.href = href;
    el.dataset.href = href;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${href}`));
    document.head.appendChild(el);
  });
}

async function loadXterm() {
  if (window.Terminal && window.FitAddon) return;
  await loadCss("/assets/xterm.css");
  await loadScript("/assets/xterm.js");
  await loadScript("/assets/xterm-addon-fit.js");
  await loadScript("/assets/xterm-addon-web-links.js");
}

export function TerminalModal({ open, stepId, ticketId, sessionId: providedSessionId, forceReprompt = false, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<{ write: (data: string) => void; writeln: (data: string) => void; cols: number; rows: number; focus: () => void; dispose: () => void; onData: (cb: (data: string) => void) => void } | null>(null);
  const fitRef = useRef<{ fit: () => void } | null>(null);
  const [status, setStatus] = useState<string>("connecting");
  const [title, setTitle] = useState<string>("Terminal");
  const [loginAvailable, setLoginAvailable] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerText, setDrawerText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open) {
      if (!dlg.open) dlg.showModal();
    } else {
      if (dlg.open) dlg.close();
    }
  }, [open]);

  // Track visualViewport so the modal hugs the visible area when the soft keyboard appears.
  // We expose two CSS vars:
  //   --vvh = visible viewport height (drives modal-box height shrink)
  //   --vvy = visible viewport offset top (drives modal-box top offset so it
  //           stays anchored to the visible area when the browser scrolls
  //           the layout viewport up to keep the focused input above the keyboard).
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    function update() {
      const h = vv?.height ?? window.innerHeight;
      const y = vv?.offsetTop ?? 0;
      document.documentElement.style.setProperty("--vvh", `${h}px`);
      document.documentElement.style.setProperty("--vvy", `${y}px`);
      fitRef.current?.fit();
    }
    update();
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
    } else {
      window.addEventListener("resize", update);
    }
    return () => {
      if (vv) {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      } else {
        window.removeEventListener("resize", update);
      }
      document.documentElement.style.removeProperty("--vvh");
      document.documentElement.style.removeProperty("--vvy");
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!stepId && !providedSessionId) return;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let resolvedSessionId: string | null = null;
    let attempt = 0;
    setStatus("connecting");
    const labelTarget = stepId ?? ticketId ?? "session";
    setTitle(`Terminal · ${labelTarget}`);
    setLoginAvailable(false);
    setError(null);
    setDrawerOpen(false);
    setDrawerText(defaultPromptText(stepId ?? "current step"));

    function connect() {
      if (cancelled || !resolvedSessionId) return;
      const term = termRef.current;
      if (!term) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/assist/ws?session=${encodeURIComponent(resolvedSessionId)}`);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        attempt = 0;
        setStatus("running");
        if (term.cols && term.rows) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
        term.focus();
      });
      ws.addEventListener("message", (event) => {
        let payload: { type?: string; data?: string; message?: string; status?: string; title?: string } | null = null;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!payload) return;
        if (payload.type === "snapshot") {
          if (payload.title) setTitle(`${payload.title} · ${labelTarget}`);
          if (payload.status) setStatus(payload.status);
          if (payload.data) {
            if (detectLogin(payload.data)) setLoginAvailable(true);
            term.write(payload.data);
          }
        } else if (payload.type === "output") {
          const text = payload.data ?? "";
          if (detectLogin(text)) setLoginAvailable(true);
          term.write(text);
        } else if (payload.type === "exit") {
          setStatus("exited");
          term.writeln("");
          term.writeln("[assist session exited]");
        } else if (payload.type === "error") {
          term.writeln("");
          term.writeln(`[assist error] ${payload.message ?? "unknown"}`);
        }
      });
      ws.addEventListener("close", () => {
        if (cancelled) return;
        setStatus((s) => (s === "exited" ? "exited" : "reconnecting"));
        const delay = Math.min(10000, 500 * 2 ** Math.min(attempt, 5));
        attempt += 1;
        if (attempt === 1) {
          term.writeln("");
          term.writeln("[connection lost — reconnecting...]");
        }
        reconnectTimer = setTimeout(() => {
          if (!cancelled) connect();
        }, delay);
      });
      ws.addEventListener("error", () => {
        // close handler will run reconnect
      });

      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });
    }

    (async () => {
      try {
        await loadXterm();
        if (cancelled) return;
        let sessionTitle: string | undefined;
        if (providedSessionId) {
          resolvedSessionId = providedSessionId;
        } else if (stepId) {
          const session = await actions.openAssist(stepId, { force: forceReprompt });
          const data = session as { result?: { sessionId?: string; title?: string; status?: string }; sessionId?: string; title?: string; status?: string };
          resolvedSessionId = data.result?.sessionId ?? data.sessionId ?? null;
          sessionTitle = data.result?.title ?? data.title;
        }
        if (sessionTitle) setTitle(`${sessionTitle} · ${labelTarget}`);
        if (!resolvedSessionId) {
          setError("session_id missing");
          return;
        }

        const TerminalCtor = window.Terminal!;
        const FitCtor = window.FitAddon!.FitAddon;
        const term = new TerminalCtor({
          convertEol: true,
          theme: { background: "#1f1d18", foreground: "#f5e6c8" },
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 13,
          cursorBlink: true,
        });
        const fit = new FitCtor();
        term.loadAddon(fit);
        if (window.WebLinksAddon) {
          term.loadAddon(new window.WebLinksAddon.WebLinksAddon());
        }
        if (containerRef.current) {
          term.open(containerRef.current);
          fit.fit();
        }
        termRef.current = term as unknown as typeof termRef.current;
        fitRef.current = fit;

        const ro = new ResizeObserver(() => {
          fit.fit();
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
          }
        });
        if (containerRef.current) ro.observe(containerRef.current);

        connect();
      } catch (err) {
        setError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = wsRef.current as unknown as SocketShape | null;
      ws?.close();
      wsRef.current = null;
      termRef.current?.dispose?.();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [open, stepId, ticketId, providedSessionId]);

  function sendInput(seq: string) {
    if (!seq) return;
    const ws = wsRef.current;
    termRef.current?.focus();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data: seq }));
    }
  }

  function sendLoginSequence() {
    setLoginAvailable(false);
    const chars = "/login".split("");
    chars.forEach((c, i) => setTimeout(() => sendInput(c), i * 35));
    setTimeout(() => sendInput("\r"), chars.length * 35 + 220);
  }

  function sendDrawerText() {
    if (!drawerText.trim()) return;
    sendInput(drawerText);
    setTimeout(() => sendInput("\r"), 800);
    setDrawerOpen(false);
  }

  return (
    <dialog ref={dialogRef} className="modal !items-start sm:!items-center" onClose={onClose}>
      <div
        className="modal-box w-11/12 max-w-6xl flex flex-col p-3 sm:p-4"
        style={{
          height: "min(96vh, var(--vvh, 100dvh))",
          maxHeight: "min(96vh, var(--vvh, 100dvh))",
          width: "min(96vw, 1280px)",
          maxWidth: "min(96vw, 1280px)",
          // On mobile, when the soft keyboard pushes the layout viewport up,
          // visualViewport.offsetTop becomes positive. We add that as a
          // top margin so the modal stays anchored to the visible area's
          // top edge instead of sliding off-screen.
          marginTop: "var(--vvy, 0px)",
        }}
      >
        <div className="flex items-center justify-between gap-3 pb-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <h3 className="font-bold truncate">{title}</h3>
            <span className={`badge ${statusBadge(status)} badge-sm`}>{status}</span>
            {loginAvailable ? (
              <button
                type="button"
                className="btn btn-warning btn-xs"
                onClick={sendLoginSequence}
              >
                /login
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`btn btn-xs ${drawerOpen ? "btn-primary" : "btn-outline"}`}
              onClick={() => setDrawerOpen((v) => !v)}
            >
              {drawerOpen ? "Drawer 閉じる" : "Proposal prompt"}
            </button>
            <form method="dialog">
              <button className="btn btn-sm btn-ghost" type="submit">Close</button>
            </form>
          </div>
        </div>

        {error ? <div className="alert alert-error text-sm mb-2">{error}</div> : null}

        <div ref={containerRef} className="flex-1 rounded-box border border-base-300 bg-[#1f1d18]" />

        {drawerOpen ? (
          <div className="rounded-box border border-base-300 bg-base-200 p-3 mt-2">
            <textarea
              className="textarea textarea-bordered w-full text-xs"
              rows={3}
              value={drawerText}
              onChange={(e) => setDrawerText(e.target.value)}
            />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setDrawerOpen(false)}>キャンセル</button>
              <button type="button" className="btn btn-primary btn-xs" onClick={sendDrawerText}>送信 + Enter</button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1 pt-2">
          {QUICK_KEYS.map((k) => (
            <button
              key={k.label}
              type="button"
              className={`btn btn-xs ${toneBtn(k.tone)}`}
              onClick={() => sendInput(k.sequence)}
              title={k.label}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}

function defaultPromptText(stepId: string) {
  return [
    `Please give one concrete proposal for ${stepId}.`,
    "Choose exactly one next action.",
    "If a rerun target is needed, choose one specific earlier step.",
    "If you are confident, run the appropriate assist-signal command yourself and briefly explain the reason.",
  ].join(" ");
}

function statusBadge(status: string) {
  switch (status) {
    case "running":
      return "badge-info";
    case "connecting":
    case "reconnecting":
      return "badge-warning";
    case "exited":
      return "badge-neutral";
    case "disconnected":
      return "badge-error";
    default:
      return "badge-ghost";
  }
}

function toneBtn(tone?: string) {
  switch (tone) {
    case "primary":
      return "btn-primary";
    case "warning":
      return "btn-warning";
    case "ghost":
      return "btn-ghost";
    default:
      return "btn-outline";
  }
}
