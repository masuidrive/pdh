import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnyRecord } from "../../types.ts";

const SECTION_NAMES = ["AC 裏取り結果", "AC Verification"];
const REQUIRED_COLUMNS = ["item", "classification", "status", "evidence", "deferral"];
const EMPTY_MARKERS = new Set(["", "-", "—", "n/a", "none"]);

export function parseAcVerificationTable({ repoPath }) {
  const path = join(repoPath, "current-note.md");
  if (!existsSync(path)) {
    return { ok: false, rows: [], errors: ["current-note.md missing"] };
  }
  const text = readFileSync(path, "utf8");
  const section = extractSection(text);
  if (!section) {
    return { ok: false, rows: [], errors: ["AC verification section missing"] };
  }
  const table = extractFirstTable(section);
  if (!table) {
    return { ok: false, rows: [], errors: ["AC verification table missing"] };
  }
  const columns = table.headers.map(normalizeHeader);
  const rows = table.rows.map((cells, index) => rowFromCells(columns, cells, index + 1));
  const errors = [];
  for (const column of REQUIRED_COLUMNS) {
    if (!columns.includes(column)) {
      errors.push(`missing column: ${column}`);
    }
  }
  if (rows.length === 0) {
    errors.push("AC verification table has no rows");
  }
  for (const row of rows) {
    errors.push(...validateRow(row));
  }
  return { ok: errors.length === 0, rows, errors };
}

export function evaluateAcVerificationTable({ repoPath, allowUnverified = false }) {
  const parsed = parseAcVerificationTable({ repoPath });
  const errors = [...parsed.errors];
  if (!allowUnverified) {
    const unverified = parsed.rows.filter((row) => row.status === "unverified");
    if (unverified.length > 0) {
      errors.push(`${unverified.length} unverified AC row(s)`);
    }
  }
  return {
    ok: parsed.ok && errors.length === 0,
    rows: parsed.rows,
    errors,
    counts: countStatuses(parsed.rows)
  };
}

function extractSection(text) {
  for (const sectionName of SECTION_NAMES) {
    const heading = new RegExp(`^#{1,6}\\s+${escapeRegExp(sectionName)}\\s*$`, "mi");
    const match = heading.exec(text);
    if (!match) {
      continue;
    }
    const after = text.slice(match.index + match[0].length);
    const nextHeading = after.search(/\n#{1,6}\s+/);
    return nextHeading >= 0 ? after.slice(0, nextHeading) : after;
  }
  return null;
}

function extractFirstTable(section) {
  const lines = section.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!isTableRow(lines[index]) || !isSeparatorRow(lines[index + 1])) {
      continue;
    }
    const headers = splitRow(lines[index]);
    const rows = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      if (!isTableRow(lines[rowIndex])) {
        break;
      }
      rows.push(splitRow(lines[rowIndex]));
    }
    return { headers, rows };
  }
  return null;
}

function rowFromCells(columns: string[], cells: string[], rowNumber: number) {
  const row: AnyRecord = { rowNumber };
  for (let index = 0; index < columns.length; index += 1) {
    row[columns[index] || `column_${index}`] = (cells[index] ?? "").trim();
  }
  row.status = normalizeStatus(row.status);
  return row;
}

function validateRow(row: AnyRecord) {
  const errors = [];
  if (isEmpty(row.item)) {
    errors.push(`row ${row.rowNumber}: AC item is empty`);
  }
  if (isEmpty(row.classification)) {
    errors.push(`row ${row.rowNumber}: classification is empty`);
  }
  if (!["verified", "deferred", "unverified"].includes(row.status)) {
    errors.push(`row ${row.rowNumber}: status must be verified, deferred, or unverified`);
  }
  if (row.status === "verified" && isEmpty(row.evidence)) {
    errors.push(`row ${row.rowNumber}: verified row requires evidence`);
  }
  if (row.status === "deferred" && isEmpty(row.deferral)) {
    errors.push(`row ${row.rowNumber}: deferred row requires deferral ticket`);
  }
  return errors;
}

function countStatuses(rows) {
  const counts = { verified: 0, deferred: 0, unverified: 0, invalid: 0 };
  for (const row of rows) {
    if (Object.hasOwn(counts, row.status)) {
      counts[row.status] += 1;
    } else {
      counts.invalid += 1;
    }
  }
  return counts;
}

function isTableRow(line) {
  return line.startsWith("|") && line.endsWith("|");
}

function isSeparatorRow(line) {
  return isTableRow(line) && splitRow(line).every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function splitRow(line) {
  // Markdown table cell separator. We can't `.split("|")` naively
  // because cells often contain code spans like `6|3` or expressions
  // such as `True|1` where the `|` is literal data, not a column
  // boundary. Honor two escape forms per the GFM table spec:
  //   - inside backtick-wrapped code spans, `|` is literal
  //   - `\|` is an escaped literal pipe
  const inner = line.slice(1, -1);
  const cells: string[] = [];
  let current = "";
  let inBacktick = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === "\\" && inner[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (ch === "`") {
      inBacktick = !inBacktick;
      current += ch;
      continue;
    }
    if (ch === "|" && !inBacktick) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value) {
  const header = value.trim().toLowerCase();
  if (["ac 項目", "ac item", "acceptance criteria", "item"].includes(header)) {
    return "item";
  }
  if (["分類", "classification", "class", "type"].includes(header)) {
    return "classification";
  }
  if (header === "status" || header === "状態") {
    return "status";
  }
  if (["証跡", "evidence"].includes(header)) {
    return "evidence";
  }
  if (["deferral ticket", "defer ticket", "follow-up", "followup"].includes(header)) {
    return "deferral";
  }
  return header;
}

function normalizeStatus(value) {
  return value.trim().toLowerCase();
}

function isEmpty(value) {
  return EMPTY_MARKERS.has(String(value ?? "").trim().toLowerCase());
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
