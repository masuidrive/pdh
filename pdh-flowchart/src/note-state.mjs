import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const LEGACY_START = "<!-- pdh-flowchart:metadata:start -->";
const LEGACY_END = "<!-- pdh-flowchart:metadata:end -->";
const STEP_HISTORY_HEADING = "## Step History";

export function loadCurrentNote(repoPath) {
  const path = join(repoPath, "current-note.md");
  const text = existsSync(path) ? readFileSync(path, "utf8") : "# current-note.md\n";
  const frontmatter = parseFrontmatter(text);
  const legacy = readLegacyMetadata(frontmatter.body);
  const pdh = normalizePdh({
    ...(frontmatter.data?.pdh ?? {}),
    ...(legacy?.pdh ?? {})
  });
  const extraFrontmatter = { ...(frontmatter.data ?? {}) };
  delete extraFrontmatter.pdh;
  return {
    path,
    text,
    pdh,
    extraFrontmatter,
    body: stripLegacyMetadata(frontmatter.body).trimStart()
  };
}

export function saveCurrentNote(repoPath, { pdh, body, extraFrontmatter = {} }) {
  const path = join(repoPath, "current-note.md");
  const document = stringify({
    ...extraFrontmatter,
    pdh: serializePdh(pdh)
  }).trimEnd();
  const nextBody = normalizeBody(body);
  const rendered = `---\n${document}\n---\n\n${nextBody}`;
  writeFileSync(path, rendered);
  return path;
}

export function updateCurrentNote(repoPath, updater) {
  const note = loadCurrentNote(repoPath);
  const next = updater({
    ...note,
    pdh: { ...note.pdh },
    extraFrontmatter: { ...note.extraFrontmatter }
  }) ?? note;
  saveCurrentNote(repoPath, next);
  return loadCurrentNote(repoPath);
}

export function replaceNoteSection(repoPath, heading, content) {
  return updateCurrentNote(repoPath, (note) => ({
    ...note,
    body: replaceSection(note.body, heading, content)
  }));
}

export function appendStepHistoryEntry(repoPath, entry) {
  return updateCurrentNote(repoPath, (note) => {
    const history = parseStepHistory(note.body);
    const line = renderStepHistoryEntry(entry);
    if (!history.lines.includes(line)) {
      history.lines.push(line);
    }
    return {
      ...note,
      body: replaceSection(note.body, STEP_HISTORY_HEADING, history.lines.join("\n"))
    };
  });
}

export function parseStepHistory(text) {
  const section = extractSection(text, STEP_HISTORY_HEADING);
  const lines = section
    ? section.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("- "))
    : [];
  const entries = lines.map(parseStepHistoryLine).filter(Boolean);
  return { lines, entries };
}

export function extractSection(text, heading) {
  const resolvedHeading = normalizeHeading(heading);
  const pattern = new RegExp(`^${escapeRegExp(resolvedHeading)}\\s*$`, "m");
  const match = pattern.exec(text);
  if (!match) {
    return null;
  }
  const after = text.slice(match.index + match[0].length);
  const nextHeading = after.search(/\n#{1,6}\s+/);
  return nextHeading >= 0 ? after.slice(0, nextHeading).trim() : after.trim();
}

export function replaceSection(text, heading, content) {
  const resolvedHeading = normalizeHeading(heading);
  const trimmedContent = String(content ?? "").trim();
  const block = `${resolvedHeading}\n\n${trimmedContent}`.trimEnd();
  const pattern = new RegExp(`^${escapeRegExp(resolvedHeading)}\\s*$`, "m");
  const match = pattern.exec(text);
  if (!match) {
    return `${text.trimEnd()}\n\n${block}\n`;
  }
  const after = text.slice(match.index + match[0].length);
  const nextHeading = after.search(/\n#{1,6}\s+/);
  if (nextHeading < 0) {
    return `${text.slice(0, match.index).trimEnd()}\n\n${block}\n`;
  }
  return `${text.slice(0, match.index).trimEnd()}\n\n${block}${after.slice(nextHeading)}`
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd() + "\n";
}

function parseFrontmatter(text) {
  const match = FRONTMATTER.exec(text);
  if (!match) {
    return { data: {}, body: text };
  }
  let data = {};
  try {
    data = parse(match[1]) ?? {};
  } catch {
    data = {};
  }
  return {
    data,
    body: text.slice(match[0].length)
  };
}

function readLegacyMetadata(text) {
  const start = text.indexOf(LEGACY_START);
  const end = text.indexOf(LEGACY_END);
  if (start < 0 || end <= start) {
    return null;
  }
  const block = text.slice(start, end + LEGACY_END.length);
  const values = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^- ([^:]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    values[match[1].trim()] = match[2].trim();
  }
  return {
    pdh: normalizePdh({
      run_id: normalizeScalar(values.Run),
      flow: normalizeScalar(values.Flow),
      variant: normalizeScalar(values.Variant),
      ticket: normalizeScalar(values.Ticket),
      status: normalizeScalar(values.Status),
      current_step: normalizeScalar(values["Current Step"]),
      updated_at: normalizeScalar(values.Updated)
    })
  };
}

function stripLegacyMetadata(text) {
  const start = text.indexOf(LEGACY_START);
  const end = text.indexOf(LEGACY_END);
  if (start < 0 || end <= start) {
    return text;
  }
  return `${text.slice(0, start).trimEnd()}\n\n${text.slice(end + LEGACY_END.length).trimStart()}`.trim();
}

function normalizePdh(pdh) {
  return {
    ticket: normalizeScalar(pdh.ticket),
    flow: normalizeScalar(pdh.flow) ?? "pdh-ticket-core",
    variant: normalizeScalar(pdh.variant) ?? "full",
    status: normalizeScalar(pdh.status) ?? "idle",
    current_step: normalizeScalar(pdh.current_step),
    run_id: normalizeScalar(pdh.run_id),
    started_at: normalizeScalar(pdh.started_at),
    updated_at: normalizeScalar(pdh.updated_at),
    completed_at: normalizeScalar(pdh.completed_at)
  };
}

function serializePdh(pdh) {
  const result = {};
  for (const [key, value] of Object.entries(normalizePdh(pdh))) {
    if (value !== null && value !== undefined && value !== "") {
      result[key] = value;
    }
  }
  return result;
}

function normalizeScalar(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const string = String(value).trim();
  if (!string || string === "(none)" || string === "null") {
    return null;
  }
  return string;
}

function normalizeBody(body) {
  const text = String(body ?? "").trim();
  return text ? `${text}\n` : "";
}

function normalizeHeading(heading) {
  return heading.startsWith("#") ? heading : `## ${heading}`;
}

function renderStepHistoryEntry(entry) {
  const updatedAt = String(entry.updatedAt ?? new Date().toISOString()).trim();
  const stepId = String(entry.stepId ?? "-").trim();
  const status = String(entry.status ?? "-").trim();
  const commit = String(entry.commit ?? "-").trim() || "-";
  const summary = String(entry.summary ?? "-").trim() || "-";
  return `- ${updatedAt} | ${stepId} | ${status} | ${commit} | ${summary}`;
}

function parseStepHistoryLine(line) {
  const body = line.replace(/^- /, "");
  const parts = body.split("|").map((part) => part.trim());
  if (parts.length < 5) {
    return null;
  }
  return {
    updatedAt: parts[0],
    stepId: parts[1],
    status: parts[2],
    commit: parts[3],
    summary: parts.slice(4).join(" | ")
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
