import type { GateView } from "../lib/types";

type Props = {
  stepId: string;
  gate: GateView;
};

const DECISION_BY_STEP: Record<string, string> = {
  "PD-C-5": "Approve implementation start, reject, or request changes to the plan.",
  "PD-C-10": "Approve ticket close, reject, or request changes before close.",
};

const TICKET_HEADING_BY_STEP: Record<string, string> = {
  "PD-C-5": "## Implementation Notes",
  "PD-C-10": "## Product AC",
};

const NOTE_HEADINGS_BY_STEP: Record<string, string[]> = {
  "PD-C-5": ["## PD-C-3. 計画", "## PD-C-4. 計画レビュー結果"],
  "PD-C-10": ["## PD-C-9. AC 裏取り結果", "## PD-C-8. 目的妥当性確認", "## PD-C-7. 品質検証結果"],
};

export function GateContextCard({ stepId, gate }: Props) {
  if (gate.status !== "needs_human" && !gate.baseline?.commit && !gate.rerun_requirement?.target_step_id) {
    return null;
  }
  const decision = DECISION_BY_STEP[stepId] ?? "Approve, reject, or request changes.";
  const ticketHeading = TICKET_HEADING_BY_STEP[stepId];
  const noteHeadings = NOTE_HEADINGS_BY_STEP[stepId] ?? [];

  return (
    <section className="rounded-box border border-warning/40 bg-warning/5 p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold text-warning">Gate context</h3>
        {gate.status ? <span className="badge badge-warning badge-sm">{gate.status}</span> : null}
        {gate.baseline?.commit ? (
          <span className="badge badge-ghost badge-sm font-mono">
            base {gate.baseline.commit.slice(0, 7)}
            {gate.baseline.step_id ? ` · ${gate.baseline.step_id}` : ""}
          </span>
        ) : null}
        {gate.decision ? <span className="badge badge-info badge-sm">decision: {gate.decision}</span> : null}
      </div>

      <p className="mt-2 text-sm">{decision}</p>

      {gate.rerun_requirement?.target_step_id ? (
        <div className="alert alert-warning mt-3 text-sm">
          <div>
            <p className="font-semibold">rerun required → {gate.rerun_requirement.target_step_id}</p>
            {gate.rerun_requirement.reason ? <p>{gate.rerun_requirement.reason}</p> : null}
            {gate.rerun_requirement.changed_ticket_sections?.length ? (
              <p className="text-xs">ticket sections: {gate.rerun_requirement.changed_ticket_sections.join(", ")}</p>
            ) : null}
            {gate.rerun_requirement.changed_note_sections?.length ? (
              <p className="text-xs">note sections: {gate.rerun_requirement.changed_note_sections.join(", ")}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {(ticketHeading || noteHeadings.length) ? (
        <div className="mt-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-base-content/50">読むべきセクション</p>
          <ul className="mt-1 list-disc pl-5 text-base-content/80">
            {ticketHeading ? <li><code>current-ticket.md</code> → {ticketHeading}</li> : null}
            {noteHeadings.map((h) => (
              <li key={h}><code>current-note.md</code> → {h}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
