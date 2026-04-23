import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const START = "<!-- pdh-flowchart:metadata:start -->";
const END = "<!-- pdh-flowchart:metadata:end -->";

export function writeRuntimeMetadata({ repoPath, run, status = run.status, currentStepId = run.current_step_id }) {
  const body = renderMetadata({ run, status, currentStepId });
  const updated = [];
  for (const path of ["current-note.md", "current-ticket.md"]) {
    const fullPath = join(repoPath, path);
    const existing = existsSync(fullPath) ? readFileSync(fullPath, "utf8") : `# ${path}\n`;
    writeFileSync(fullPath, replaceMetadataBlock(existing, body));
    updated.push(fullPath);
  }
  return { paths: updated, body };
}

export function renderMetadata({ run, status = run.status, currentStepId = run.current_step_id }) {
  return [
    START,
    "## pdh-flowchart Metadata",
    "",
    `- Run: ${run.id}`,
    `- Flow: ${run.flow_id}`,
    `- Variant: ${run.flow_variant}`,
    `- Ticket: ${run.ticket_id ?? "(none)"}`,
    `- Status: ${status}`,
    `- Current Step: ${currentStepId ?? "(none)"}`,
    `- Updated: ${new Date().toISOString()}`,
    END
  ].join("\n");
}

function replaceMetadataBlock(text, block) {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start >= 0 && end > start) {
    return `${text.slice(0, start).trimEnd()}\n\n${block}\n${text.slice(end + END.length).trimStart()}`;
  }
  return `${text.trimEnd()}\n\n${block}\n`;
}
