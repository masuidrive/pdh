import { createContext, useContext, useEffect, useRef, useState } from "react";

type NotificationTone = "success" | "error" | "warning" | "info";

type NotificationInput = {
  tone: NotificationTone;
  title?: string;
  message: string;
  durationMs?: number;
  sticky?: boolean;
};

type NotificationItem = NotificationInput & {
  id: number;
};

type NotificationsContextValue = {
  notify: (input: NotificationInput) => number;
  notifyError: (error: unknown, options?: { title?: string; prefix?: string; durationMs?: number; sticky?: boolean }) => number;
  dismiss: (id: number) => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef(new Map<number, number>());

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer);
      }
      timersRef.current.clear();
    };
  }, []);

  function dismiss(id: number) {
    const timer = timersRef.current.get(id);
    if (timer != null) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setItems((current) => current.filter((item) => item.id !== id));
  }

  function notify(input: NotificationInput) {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    const item: NotificationItem = { id, ...input };
    setItems((current) => [...current, item].slice(-5));
    if (!input.sticky) {
      const timer = window.setTimeout(() => {
        dismiss(id);
      }, input.durationMs ?? defaultDurationMs(input.tone));
      timersRef.current.set(id, timer);
    }
    return id;
  }

  function notifyError(
    error: unknown,
    options: { title?: string; prefix?: string; durationMs?: number; sticky?: boolean } = {}
  ) {
    const base = describeError(error);
    const message = options.prefix ? `${options.prefix}: ${base}` : base;
    return notify({
      tone: "error",
      title: options.title ?? "エラー",
      message,
      durationMs: options.durationMs,
      sticky: options.sticky,
    });
  }

  return (
    <NotificationsContext.Provider value={{ notify, notifyError, dismiss }}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const value = useContext(NotificationsContext);
  if (!value) {
    throw new Error("NotificationsProvider is missing");
  }
  return value;
}

function ToastViewport({ items, onDismiss }: { items: NotificationItem[]; onDismiss: (id: number) => void }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="toast toast-top toast-end z-[90] max-w-md">
      {items.map((item) => (
        <section
          key={item.id}
          className={`alert ${toneToAlert(item.tone)} fade-in min-w-80 shadow-lg`}
          role="status"
          aria-live={item.tone === "error" ? "assertive" : "polite"}
        >
          <div className="min-w-0">
            {item.title ? <p className="text-sm font-semibold">{item.title}</p> : null}
            <p className="text-sm whitespace-pre-wrap break-words">{item.message}</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-xs shrink-0"
            aria-label="dismiss notification"
            onClick={() => onDismiss(item.id)}
          >
            ×
          </button>
        </section>
      ))}
    </div>
  );
}

function toneToAlert(tone: NotificationTone) {
  switch (tone) {
    case "success":
      return "alert-success";
    case "warning":
      return "alert-warning";
    case "error":
      return "alert-error";
    default:
      return "alert-info";
  }
}

function defaultDurationMs(tone: NotificationTone) {
  switch (tone) {
    case "error":
      return 7000;
    case "warning":
      return 5500;
    default:
      return 4000;
  }
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "unknown error");
}
