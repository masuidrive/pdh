import { useEffect, useState } from "react";

type PromptEntry = {
  kind: "step" | "reviewer" | "repair";
  label: string;
  reviewerId?: string;
  provider?: string | null;
  body?: string;
  error?: string;
};

type Payload = { stepId: string; prompts: PromptEntry[] };

function currentTicketFromPath(): string | null {
  const m = window.location.pathname.match(/^\/tickets\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function PromptPanel({ stepId }: { stepId: string }) {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);
    setActiveIdx(0);
    const ticket = currentTicketFromPath();
    const params = new URLSearchParams({ step: stepId });
    if (ticket) params.set("ticket", ticket);
    fetch(`/api/prompt?${params}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((body as { error?: string })?.error || `HTTP ${r.status}`);
        return body as Payload;
      })
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, stepId]);

  const prompts = payload?.prompts ?? [];
  const active = prompts[activeIdx] ?? null;

  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-3 p-4">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="card-title text-base">プロンプト</span>
          <span className="text-xs text-base-content/60">{open ? "閉じる" : "展開"}</span>
        </button>
        {open ? (
          <div className="flex flex-col gap-2">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-base-content/60">
                <span className="loading loading-spinner loading-xs" />
                読み込み中…
              </div>
            ) : null}
            {error ? <div className="alert alert-error text-sm"><span>{error}</span></div> : null}
            {prompts.length > 1 ? (
              <div role="tablist" className="tabs tabs-boxed tabs-sm">
                {prompts.map((p, i) => (
                  <button
                    key={`${p.kind}:${p.reviewerId ?? i}`}
                    type="button"
                    role="tab"
                    className={`tab ${i === activeIdx ? "tab-active" : ""}`}
                    onClick={() => setActiveIdx(i)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            ) : null}
            {active ? (
              <div className="flex flex-col gap-2">
                {active.provider ? (
                  <div className="text-xs text-base-content/60">provider: {active.provider}</div>
                ) : null}
                {active.error ? (
                  <div className="alert alert-warning text-sm"><span>{active.error}</span></div>
                ) : (
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-box border border-base-300 bg-base-200 p-3 text-xs leading-6">
                    {active.body}
                  </pre>
                )}
              </div>
            ) : null}
            {!loading && !error && prompts.length === 0 ? (
              <div className="text-sm text-base-content/60">この step のプロンプトはありません。</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
