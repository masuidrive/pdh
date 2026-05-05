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
      if (md) setHtml(rewriteRunArtifactImages(md.render(text)));
    })();
    return () => {
      cancelled = true;
    };
  }, [text]);
  return html;
}

// Rewrite <img src="..."> for image paths under .pdh-flow/runs/ so the
// browser fetches them via the scoped run-file endpoint instead of
// hitting the dev server with a relative path that would 404.
//
// Agents save provider screenshots to
// `.pdh-flow/runs/<run>/steps/<step>/screenshots/<name>.png` and embed
// them in ui-output.json `notes` markdown as `![caption](<that path>)`.
// The runtime serves them through GET /api/run-file?path=<...>.
function rewriteRunArtifactImages(html: string): string {
  return html.replace(/<img\b([^>]*?)\bsrc="([^"]+)"([^>]*)>/g, (match, before, rawSrc, after) => {
    if (/^(?:[a-z]+:)?\/\//i.test(rawSrc) || rawSrc.startsWith("data:") || rawSrc.startsWith("/api/")) {
      return match;
    }
    const stripped = rawSrc.replace(/^(?:\.\/)+/, "");
    if (!stripped.startsWith(".pdh-flow/runs/")) {
      return match;
    }
    const rewritten = `/api/run-file?path=${encodeURIComponent(stripped)}`;
    return `<img${before}src="${rewritten}"${after}>`;
  });
}
