type AssistSignal = {
  kind?: string;
  signal?: string;
  message?: string;
  question?: string;
  recommendation?: string;
  ts?: string;
  createdAt?: string;
};

type Props = {
  signal?: unknown;
};

export function AssistSignalBanner({ signal }: Props) {
  if (!signal || typeof signal !== "object") return null;
  const s = signal as AssistSignal;
  const kind = s.kind ?? s.signal ?? "assist";
  const message = s.message ?? s.question ?? s.recommendation ?? "";
  const ts = s.ts ?? s.createdAt ?? "";
  if (!message) return null;
  return (
    <div className="alert alert-info shadow-sm">
      <div>
        <h3 className="font-bold">Assist signal · {kind}</h3>
        <p className="mt-1 whitespace-pre-line text-sm">{message}</p>
        {ts ? <p className="text-xs text-base-content/60">{formatTime(ts)}</p> : null}
      </div>
    </div>
  );
}

function formatTime(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString();
}
