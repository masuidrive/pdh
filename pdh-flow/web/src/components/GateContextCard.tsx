import type { GateView, StepView } from "../lib/types";

type Props = {
  step: StepView;
  gate: GateView;
};

export function GateContextCard({ step, gate }: Props) {
  if (gate.status !== "needs_human" && !gate.baseline?.commit && !gate.rerun_requirement?.target_step_id) {
    return null;
  }
  const isOpen = gate.status === "needs_human";
  const decision = step.display?.decision ?? "Approve, reject, or request changes.";
  const ticketHeading = step.display?.readTicketHeading;
  const noteHeadings = step.display?.readNoteHeadings ?? [];
  const tone = isOpen
    ? "border-warning/40 bg-warning/5"
    : "border-base-300 bg-base-200/40";
  const headingTone = isOpen ? "text-warning" : "text-base-content";
  const statusBadgeTone = isOpen ? "badge-warning" : "badge-success";

  return (
    <section className={`rounded-box border p-4 shadow-sm ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={`font-bold ${headingTone}`}>Gate context</h3>
        {gate.status ? <span className={`badge badge-sm ${statusBadgeTone}`}>{gate.status}</span> : null}
        {gate.baseline?.commit ? (
          <span className="badge badge-ghost badge-sm font-mono">
            base {gate.baseline.commit.slice(0, 7)}
            {gate.baseline.step_id ? ` · ${gate.baseline.step_id}` : ""}
          </span>
        ) : null}
        {gate.decision ? <span className="badge badge-info badge-sm">decision: {gate.decision}</span> : null}
      </div>

      {isOpen ? <p className="mt-2 text-sm">{decision}</p> : null}

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
