import { useEffect, useRef } from "react";
import { actions } from "../lib/api";

type Props = {
  open: boolean;
  stepId: string | null;
  onClose: () => void;
};

declare global {
  interface Window {
    Terminal?: typeof import("@xterm/xterm").Terminal;
    FitAddon?: { FitAddon: typeof import("@xterm/addon-fit").FitAddon };
    WebLinksAddon?: { WebLinksAddon: typeof import("@xterm/addon-web-links").WebLinksAddon };
  }
}

async function loadXterm() {
  if (window.Terminal && window.FitAddon) return;
  await loadCss("/assets/xterm.css");
  await loadScript("/assets/xterm.js");
  await loadScript("/assets/xterm-addon-fit.js");
  await loadScript("/assets/xterm-addon-web-links.js");
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

export function TerminalModal({ open, stepId, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<unknown>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open) {
      if (!dlg.open) dlg.showModal();
    } else {
      if (dlg.open) dlg.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !stepId) return;
    let cancelled = false;
    (async () => {
      await loadXterm();
      if (cancelled) return;
      const session = await actions.openAssist(stepId);
      const data = (session as { result?: { sessionId?: string }; sessionId?: string });
      const sessionId = data.result?.sessionId ?? data.sessionId;
      if (!sessionId) return;
      const TerminalCtor = window.Terminal!;
      const FitCtor = window.FitAddon!.FitAddon;
      const term = new TerminalCtor({ convertEol: true, theme: { background: "#1f1d18" }, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13 });
      const fit = new FitCtor();
      term.loadAddon(fit);
      if (containerRef.current) {
        term.open(containerRef.current);
        fit.fit();
      }
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/assist/ws?session=${encodeURIComponent(sessionId)}`);
      ws.binaryType = "arraybuffer";
      ws.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          term.write(event.data);
        } else {
          term.write(new Uint8Array(event.data as ArrayBuffer));
        }
      });
      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });
      const ro = new ResizeObserver(() => fit.fit());
      if (containerRef.current) ro.observe(containerRef.current);
      wsRef.current = ws;
      termRef.current = term;
    })();
    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
      const term = termRef.current as { dispose?: () => void } | null;
      term?.dispose?.();
      termRef.current = null;
    };
  }, [open, stepId]);

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <div className="modal-box w-11/12 max-w-6xl" style={{ maxHeight: "min(90dvh, calc(100dvh - 32px))", height: "min(90dvh, calc(100dvh - 32px))" }}>
        <div className="flex items-center justify-between gap-3 pb-3">
          <h3 className="font-bold">Terminal · {stepId ?? ""}</h3>
          <form method="dialog">
            <button className="btn btn-sm btn-ghost" type="submit">Close</button>
          </form>
        </div>
        <div ref={containerRef} className="rounded-box border border-base-300 bg-[#1f1d18]" style={{ height: "calc(100% - 60px)" }} />
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}
