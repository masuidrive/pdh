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
      if (!md) return;
      const initial = rewriteRunArtifactImages(md.render(text));
      if (cancelled) return;
      // First pass: show the markdown immediately with mermaid blocks
      // visible as raw code. Then resolve mermaid SVGs server-side and
      // upgrade the HTML in place.
      setHtml(initial);
      const upgraded = await renderMermaidBlocks(initial);
      if (!cancelled && upgraded !== initial) {
        setHtml(upgraded);
      }
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
//
// We append `&ticket=<current ticket>` (mirroring api.ts's
// withTicketScope behavior) so the request hits the per-ticket
// worktree where the run actually lives. Without this the request
// would resolve against the main repo and 404.
function rewriteRunArtifactImages(html: string): string {
  const ticket = currentTicketForArtifactScope();
  return html.replace(/<img\b([^>]*?)\bsrc="([^"]+)"([^>]*)>/g, (match, before, rawSrc, after) => {
    if (/^(?:[a-z]+:)?\/\//i.test(rawSrc) || rawSrc.startsWith("data:") || rawSrc.startsWith("/api/")) {
      return match;
    }
    const stripped = rawSrc.replace(/^(?:\.\/)+/, "");
    if (!stripped.startsWith(".pdh-flow/runs/")) {
      return match;
    }
    let rewritten = `/api/run-file?path=${encodeURIComponent(stripped)}`;
    if (ticket) {
      rewritten += `&ticket=${encodeURIComponent(ticket)}`;
    }
    return `<img${before}src="${rewritten}"${after}>`;
  });
}

function currentTicketForArtifactScope(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.pathname.match(/^\/tickets\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Replace ```mermaid ... ``` code blocks in the markdown-it output with
// SVG rendered server-side via /api/render-mermaid. Beautiful-mermaid
// (the renderer used) lives on the server; clients fetch the SVG.
//
// markdown-it emits `<pre><code class="language-mermaid">...escaped...</code></pre>`
// for fenced code blocks. We unescape, send to the endpoint, and swap
// the <pre> for the SVG. On failure (or if there are no mermaid
// blocks), the original HTML is returned unchanged so users still see
// the raw mermaid source as a code block.
async function renderMermaidBlocks(html: string): Promise<string> {
  if (typeof window === "undefined") return html;
  if (!html.includes('class="language-mermaid"')) return html;
  const re = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g;
  const matches = [...html.matchAll(re)];
  if (matches.length === 0) return html;
  const replacements = await Promise.all(matches.map(async (m) => {
    const code = decodeHtmlEntities(m[1]);
    try {
      const res = await fetch(`/api/render-mermaid?code=${encodeURIComponent(code)}`);
      if (!res.ok) return null;
      const svg = await res.text();
      return svg;
    } catch {
      return null;
    }
  }));
  let i = 0;
  return html.replace(re, (orig) => {
    const svg = replacements[i++];
    if (!svg) return orig;
    return `<div class="evidence-mermaid">${svg}</div>`;
  });
}

function decodeHtmlEntities(s: string): string {
  // markdown-it's default escape covers &amp; &lt; &gt; &quot; &#39;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
