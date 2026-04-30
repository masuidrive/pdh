import { useEffect, useState } from "react";

declare global {
  interface Window {
    markdownit?: (options?: Record<string, unknown>) => { render: (input: string) => string };
  }
}

function loadMarkdownIt(): Promise<void> {
  return new Promise((resolve, reject) => {
    const src = "/assets/markdown-it.js";
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
