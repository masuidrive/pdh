import { useRef, useState } from "react";

export function useSingleFlight() {
  const flightsRef = useRef(new Map<string, Promise<unknown>>());
  const [pending, setPending] = useState<Record<string, number>>({});

  async function run<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    const existing = flightsRef.current.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }
    setPending((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
    const promise = Promise.resolve().then(task);
    flightsRef.current.set(key, promise);
    try {
      return await promise;
    } finally {
      flightsRef.current.delete(key);
      setPending((current) => {
        const count = current[key] ?? 0;
        if (count <= 1) {
          const next = { ...current };
          delete next[key];
          return next;
        }
        return { ...current, [key]: count - 1 };
      });
    }
  }

  function isPending(key: string) {
    return Boolean(pending[key]);
  }

  return { run, isPending };
}
