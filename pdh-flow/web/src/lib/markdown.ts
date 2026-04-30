import { useEffect, useState } from "react";

declare global {
  interface Window {
    markdownit?: (options?: Record<string, unknown>) => { render: (input: string) => string };
  }
}

let mdLoader: Promise<void> | null = null;
function loadMarkdownIt(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.markdownit) return Promise.resolve();
  if (mdLoader) return mdLoader;
  const src = "/assets/markdown-it.js";
  mdLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-src="${src}"]`);
    if (existing) {
      if (window.markdownit) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`failed to load ${src}`)), { once: true });
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.dataset.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
  return mdLoader;
}

export function useMarkdown(text: string): string | null {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    if (!text) return;
    (async () => {
      await loadMarkdownIt();
      if (cancelled) return;
      const md = window.markdownit?.({ html: false, linkify: true });
      if (md) setHtml(md.render(text));
    })();
    return () => {
      cancelled = true;
    };
  }, [text]);
  return html;
}
