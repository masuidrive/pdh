import type { StepView } from "../lib/types";

// PD-C-1 intent-gate output. All fields are optional; we render only
// the sections the agent populated. Shape documented in
// flows/steps/PD-C-1.j2.
type Interpretation = {
  reading?: string;
  in_scope?: string[];
  out_of_scope?: string[];
  success_definition?: string;
};

type Unknown = {
  point?: string;
  options?: string[];
  assumed?: string;
  assumption_reason?: string;
  need_user_decision?: boolean;
};

type ContextGap = {
  missing?: string;
  needed_for?: string;
  severity?: "blocker" | "nice-to-have" | string;
};

type AlignmentEntry = {
  status?: string;
  note?: string;
};

type RelatedTicket = {
  id?: string;
  relevance?: string;
};

type Alignment = {
  product_brief?: AlignmentEntry;
  current_epic?: AlignmentEntry;
  related_past_tickets?: RelatedTicket[];
};

type TeamRecommendation = {
  default_ok?: boolean;
  notes?: string;
};

type IntentOutput = {
  interpretation?: Interpretation | null;
  unknowns?: Unknown[];
  contextGaps?: ContextGap[];
  alignment?: Alignment | null;
  teamRecommendation?: TeamRecommendation | null;
};

type Props = {
  step: StepView;
};

export function InterpretationCard({ step }: Props) {
  const ui = (step.uiOutput as IntentOutput | null | undefined) ?? null;
  if (!ui) return null;
  const interpretation = ui.interpretation ?? null;
  const unknowns = Array.isArray(ui.unknowns) ? ui.unknowns : [];
  const gaps = Array.isArray(ui.contextGaps) ? ui.contextGaps : [];
  const alignment = ui.alignment ?? null;
  const team = ui.teamRecommendation ?? null;
  if (!interpretation && unknowns.length === 0 && gaps.length === 0 && !alignment && !team) {
    return null;
  }
  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-4">
        <h3 className="card-title">解釈契約</h3>
        {interpretation ? <InterpretationSection data={interpretation} /> : null}
        {unknowns.length ? <UnknownsSection unknowns={unknowns} /> : null}
        {gaps.length ? <ContextGapsSection gaps={gaps} /> : null}
        {alignment ? <AlignmentSection data={alignment} /> : null}
        {team ? <TeamSection team={team} /> : null}
      </div>
    </section>
  );
}

function InterpretationSection({ data }: { data: Interpretation }) {
  return (
    <Section title="チケット解釈">
      {data.reading ? (
        <p className="whitespace-pre-line break-words text-sm leading-6">{data.reading}</p>
      ) : null}
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {data.in_scope?.length ? (
          <Pillbox label="触る (in scope)" tone="info">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {data.in_scope.map((s, i) => (
                <li key={i} className="break-words">{s}</li>
              ))}
            </ul>
          </Pillbox>
        ) : null}
        {data.out_of_scope?.length ? (
          <Pillbox label="触らない (out of scope)" tone="ghost">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {data.out_of_scope.map((s, i) => (
                <li key={i} className="break-words">{s}</li>
              ))}
            </ul>
          </Pillbox>
        ) : null}
      </div>
      {data.success_definition ? (
        <div className="mt-3">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">完了の定義</h5>
          <p className="mt-1 break-words text-sm leading-6">{data.success_definition}</p>
        </div>
      ) : null}
    </Section>
  );
}

function UnknownsSection({ unknowns }: { unknowns: Unknown[] }) {
  // Sort: items needing user decision first.
  const sorted = [...unknowns].sort((a, b) => Number(b.need_user_decision) - Number(a.need_user_decision));
  return (
    <Section title={`未決事項 (${unknowns.length})`}>
      <ul className="space-y-3 text-sm">
        {sorted.map((u, i) => (
          <li
            key={i}
            className={`rounded-box border p-3 ${u.need_user_decision ? "border-warning/60 bg-warning/5" : "border-base-300 bg-base-200/40"}`}
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold break-words">{u.point ?? "(unspecified)"}</span>
              {u.need_user_decision ? <span className="badge badge-warning badge-sm">要ユーザ判断</span> : null}
            </div>
            {u.options?.length ? (
              <div className="mt-1 text-xs text-base-content/70">
                options: {u.options.map((o, j) => (
                  <span key={j} className="mr-2">
                    {o === u.assumed ? <strong className="underline">{o}</strong> : o}
                    {j < (u.options?.length ?? 0) - 1 ? " /" : ""}
                  </span>
                ))}
              </div>
            ) : null}
            {u.assumed ? (
              <div className="mt-1 text-xs">
                <span className="text-base-content/60">仮定: </span>
                <span className="font-mono">{u.assumed}</span>
                {u.assumption_reason ? (
                  <span className="text-base-content/60"> — {u.assumption_reason}</span>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ContextGapsSection({ gaps }: { gaps: ContextGap[] }) {
  const sorted = [...gaps].sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
  return (
    <Section title={`不足情報 (${gaps.length})`}>
      <ul className="space-y-2 text-sm">
        {sorted.map((g, i) => (
          <li key={i} className="flex items-baseline gap-2">
            <span
              className={`badge badge-sm shrink-0 ${g.severity === "blocker" ? "badge-error" : "badge-info"}`}
            >
              {g.severity ?? "info"}
            </span>
            <div className="min-w-0 break-words">
              <span className="font-semibold">{g.missing ?? "(unspecified)"}</span>
              {g.needed_for ? (
                <span className="text-base-content/60"> — {g.needed_for}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AlignmentSection({ data }: { data: Alignment }) {
  const rows: { key: string; label: string; entry?: AlignmentEntry }[] = [];
  if (data.product_brief) rows.push({ key: "product_brief", label: "product-brief.md", entry: data.product_brief });
  if (data.current_epic) rows.push({ key: "current_epic", label: "current-epic.md", entry: data.current_epic });
  const past = Array.isArray(data.related_past_tickets) ? data.related_past_tickets : [];
  return (
    <Section title="docs 整合性">
      {rows.length ? (
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex items-baseline gap-2">
              <span className={`badge badge-sm shrink-0 ${alignmentTone(r.entry?.status)}`}>
                {r.entry?.status ?? "-"}
              </span>
              <span className="font-mono text-xs text-base-content/70">{r.label}</span>
              {r.entry?.note ? (
                <span className="break-words text-base-content/85">{r.entry.note}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {past.length ? (
        <div className="mt-2">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">関連 past tickets</h5>
          <ul className="mt-1 space-y-1 text-sm">
            {past.map((p, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className="font-mono text-xs">{p.id ?? "(unknown)"}</span>
                {p.relevance ? <span className="text-base-content/70 break-words">{p.relevance}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

function TeamSection({ team }: { team: TeamRecommendation }) {
  if (team.default_ok && !team.notes) {
    return (
      <Section title="チーム編成">
        <p className="text-sm text-base-content/70">default 編成で問題なし</p>
      </Section>
    );
  }
  return (
    <Section title="チーム編成">
      {!team.default_ok ? (
        <p className="text-sm">
          <span className="badge badge-warning badge-sm mr-2">override 推奨</span>
          下の RunCompositionPanel で調整してください
        </p>
      ) : null}
      {team.notes ? <p className="mt-2 break-words text-sm leading-6">{team.notes}</p> : null}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="text-xs font-bold uppercase tracking-wide text-base-content/60">{title}</h4>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

function Pillbox({ label, tone, children }: { label: string; tone: "info" | "ghost"; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-box border p-2 ${tone === "info" ? "border-info/40 bg-info/5" : "border-base-300 bg-base-200/40"}`}
    >
      <h5 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">{label}</h5>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function severityOrder(severity?: string) {
  if (severity === "blocker") return 0;
  if (severity === "nice-to-have") return 1;
  return 2;
}

function alignmentTone(status?: string) {
  switch (status) {
    case "aligned":
      return "badge-success";
    case "conflict":
      return "badge-error";
    case "not_referenced":
    case "none":
      return "badge-ghost";
    default:
      return "badge-neutral";
  }
}
