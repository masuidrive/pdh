import { useEffect, useState } from "react";

export type UrlState = {
  step: string | null;
  doc: string | null;
  heading: string | null;
  mode: string | null;
  ticket: string | null;
  view: string | null;
};

function readState(): UrlState {
  const params = new URLSearchParams(window.location.search);
  return {
    step: params.get("step"),
    doc: params.get("doc"),
    heading: params.get("heading"),
    mode: params.get("mode"),
    ticket: params.get("ticket"),
    view: params.get("view"),
  };
}

function writeState(patch: Partial<UrlState>) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  }
  const next = params.toString();
  const hash = window.location.hash;
  const url = window.location.pathname + (next ? `?${next}` : "") + hash;
  window.history.replaceState(null, "", url);
}

export function useUrlState() {
  const [state, setState] = useState<UrlState>(() => readState());

  useEffect(() => {
    const handler = () => setState(readState());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const update = (patch: Partial<UrlState>) => {
    writeState(patch);
    setState(readState());
  };

  return [state, update] as const;
}
