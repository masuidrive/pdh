import { useEffect, useState } from "react";
import { fetchState } from "./api";
import type { AppState } from "./types";
import { mockState } from "./mock";

export type AppStateSlot =
  | { status: "loading"; state: null; error: null }
  | { status: "ready"; state: AppState; error: null }
  | { status: "error"; state: AppState | null; error: string };

const MOCK_FLAG = new URLSearchParams(window.location.search).get("mock");

export function useAppState(): AppStateSlot {
  const [slot, setSlot] = useState<AppStateSlot>({ status: "loading", state: null, error: null });

  useEffect(() => {
    if (MOCK_FLAG) {
      setSlot({ status: "ready", state: mockState(MOCK_FLAG), error: null });
      return;
    }
    let cancelled = false;
    fetchState()
      .then((state) => {
        if (!cancelled) setSlot({ status: "ready", state, error: null });
      })
      .catch((err: Error) => {
        if (!cancelled) setSlot({ status: "error", state: null, error: err.message });
      });

    const source = new EventSource("/api/events");
    source.addEventListener("state", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as AppState;
        if (!cancelled) setSlot({ status: "ready", state: data, error: null });
      } catch {
        // ignore malformed payloads, the next tick will retry
      }
    });
    source.addEventListener("error", () => {
      // browser will auto-reconnect; surface no error if we already have state
    });

    return () => {
      cancelled = true;
      source.close();
    };
  }, []);

  return slot;
}
