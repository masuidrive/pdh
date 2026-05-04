// Schema + helpers for `current-note.md` frontmatter fields that drive
// run-scoped overrides:
//
//   flow_variant: "light" | "full"
//   flow_variant_locked: bool
//   flow_variant_reason: string
//   agent_overrides:
//     <stepId>:
//       provider: "claude" | "codex"          # edit-mode steps
//       model: string
//       bare: bool
//       aggregator: { provider, model }       # review-mode steps
//       repair: { provider, model }
//       reviewers: [{ role, provider, model?, count, focus[] }]
//       maxInPlaceRepairs: int
//   agent_overrides_locked:
//     <stepId>: bool
//
// This module validates *structure* only. Cross-references against the
// active flow (e.g. step ids, known variants) happen at hydration time
// in runtime-state.ts / agent-resolution.ts.

import { loadCurrentNote, updateCurrentNote } from "./note.ts";
import type { AnyRecord } from "../types.ts";

const KNOWN_PROVIDERS = new Set(["claude", "codex"]);

export function readNoteOverrides(repoPath) {
  const note = loadCurrentNote(repoPath);
  return parseNoteOverrides(note.extraFrontmatter);
}

export function writeNoteOverrides(repoPath, patch) {
  return updateCurrentNote(repoPath, (note) => {
    const next = { ...(note.extraFrontmatter ?? {}) };
    if (patch.flow_variant !== undefined) {
      next.flow_variant = patch.flow_variant;
    }
    if (patch.flow_variant_locked !== undefined) {
      next.flow_variant_locked = patch.flow_variant_locked;
    }
    if (patch.flow_variant_reason !== undefined) {
      next.flow_variant_reason = patch.flow_variant_reason;
    }
    if (patch.agent_overrides !== undefined) {
      next.agent_overrides = patch.agent_overrides;
    }
    if (patch.agent_overrides_locked !== undefined) {
      next.agent_overrides_locked = patch.agent_overrides_locked;
    }
    pruneEmpty(next);
    return { ...note, extraFrontmatter: next };
  });
}

// Parse the frontmatter object (already yaml-decoded by note-state.ts)
// into a normalized override descriptor. Invalid sub-trees are dropped
// with a warning collected in `warnings`; the rest stays usable.
export function parseNoteOverrides(frontmatter: AnyRecord) {
  const data: AnyRecord = frontmatter && typeof frontmatter === "object" ? frontmatter : {};
  const warnings = [];

  const flowVariant = normalizeVariantName(data.flow_variant, warnings);
  const flowVariantLocked = normalizeBool(data.flow_variant_locked);
  const flowVariantReason = normalizeText(data.flow_variant_reason);

  const agentOverrides = parseAgentOverridesMap(data.agent_overrides, warnings);
  const agentOverridesLocked = parseLockMap(data.agent_overrides_locked, warnings);

  return {
    flowVariant,
    flowVariantLocked,
    flowVariantReason,
    agentOverrides,
    agentOverridesLocked,
    warnings
  };
}

function parseAgentOverridesMap(input: unknown, warnings: string[]) {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    warnings.push("agent_overrides must be a mapping of stepId -> override");
    return {};
  }
  const out: AnyRecord = {};
  for (const [stepId, raw] of Object.entries(input)) {
    if (typeof stepId !== "string" || !stepId) {
      warnings.push(`agent_overrides has non-string stepId; ignoring`);
      continue;
    }
    const entry = parseStepOverride(stepId, raw, warnings);
    if (entry) out[stepId] = entry;
  }
  return out;
}

// One step's override block. Edit-mode (provider/model/bare) and
// review-mode (aggregator/repair/reviewers/maxInPlaceRepairs) keys may
// coexist in the parsed object — the resolver picks the relevant subset
// based on the step's mode at apply time. We keep both so the user can
// switch a step's mode upstream without their config being silently
// dropped.
function parseStepOverride(stepId: string, raw: unknown, warnings: string[]) {
  if (raw == null) return null;
  // Top-level shorthand: agent_overrides.PD-C-6: codex
  if (typeof raw === "string") {
    const edit = parseEditAgent(raw, `agent_overrides[${stepId}]`, warnings);
    return edit ? { edit } : null;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push(`agent_overrides[${stepId}] must be a string or mapping`);
    return null;
  }
  const source = raw as AnyRecord;
  const out: AnyRecord = {};
  // Edit-mode shape: top-level { provider, model, bare } is the canonical
  // input form, but we also accept the wrapped form { edit: { provider, ... } }
  // so the parsed output can round-trip back through writeNoteOverrides
  // without the wrapper getting silently dropped.
  const editSource = source.edit !== undefined ? source.edit : source;
  const edit = parseEditAgent(editSource, `agent_overrides[${stepId}]`, warnings);
  if (edit) out.edit = edit;

  if (source.aggregator !== undefined) {
    const agg = parseEditAgent(source.aggregator, `agent_overrides[${stepId}].aggregator`, warnings);
    if (agg) out.aggregator = agg;
  }
  if (source.repair !== undefined) {
    const rep = parseEditAgent(source.repair, `agent_overrides[${stepId}].repair`, warnings);
    if (rep) out.repair = rep;
  }
  if (source.reviewers !== undefined) {
    const reviewers = parseReviewers(source.reviewers, `agent_overrides[${stepId}].reviewers`, warnings);
    if (reviewers.length) out.reviewers = reviewers;
  }
  if (source.maxInPlaceRepairs !== undefined) {
    const n = Number(source.maxInPlaceRepairs);
    if (Number.isInteger(n) && n > 0) {
      out.maxInPlaceRepairs = n;
    } else {
      warnings.push(`agent_overrides[${stepId}].maxInPlaceRepairs must be a positive integer`);
    }
  }

  return Object.keys(out).length ? out : null;
}

// Parse provider/model/bare from either a flat object (when used at the
// top level of a step override) or a nested object (aggregator, repair).
// Returns null if no edit-shape fields are present, so the parent can
// distinguish "no edit override" from "edit override with provider".
function parseEditAgent(raw: unknown, where: string, warnings: string[]) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    // Shorthand: agent_overrides.PD-C-6: codex
    if (!KNOWN_PROVIDERS.has(raw)) {
      warnings.push(`${where} provider "${raw}" is not in known providers`);
      return null;
    }
    return { provider: raw };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push(`${where} must be a string or object`);
    return null;
  }
  const source = raw as AnyRecord;
  const out: AnyRecord = {};
  if (source.provider !== undefined) {
    if (typeof source.provider !== "string" || !source.provider) {
      warnings.push(`${where}.provider must be a non-empty string`);
    } else if (!KNOWN_PROVIDERS.has(source.provider)) {
      warnings.push(`${where}.provider "${source.provider}" is not in known providers`);
    } else {
      out.provider = source.provider;
    }
  }
  if (source.model !== undefined) {
    if (source.model === null || source.model === "") {
      // explicit clear
    } else if (typeof source.model !== "string") {
      warnings.push(`${where}.model must be a string`);
    } else {
      out.model = source.model;
    }
  }
  if (source.bare !== undefined) {
    out.bare = Boolean(source.bare);
  }
  return Object.keys(out).length ? out : null;
}

function parseReviewers(raw: unknown, where: string, warnings: string[]) {
  if (!Array.isArray(raw)) {
    warnings.push(`${where} must be a list`);
    return [];
  }
  const out: AnyRecord[] = [];
  raw.forEach((item, i) => {
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      warnings.push(`${where}[${i}] must be a mapping`);
      return;
    }
    const entry: AnyRecord = {};
    if (typeof item.role === "string" && item.role) entry.role = item.role;
    else warnings.push(`${where}[${i}].role is required`);

    // Canonical override shape is `providers: ["claude", "codex"]` (one
    // entry per spawn). Legacy { provider, count } is materialized to
    // `providers` so older notes still parse cleanly.
    let providers: string[] = [];
    if (Array.isArray(item.providers)) {
      providers = item.providers.filter((p, idx) => {
        if (typeof p !== "string" || !KNOWN_PROVIDERS.has(p)) {
          warnings.push(`${where}[${i}].providers[${idx}] must be one of ${[...KNOWN_PROVIDERS].join(", ")}`);
          return false;
        }
        return true;
      });
    } else if (typeof item.provider === "string" && KNOWN_PROVIDERS.has(item.provider)) {
      const n = Number.isInteger(Number(item.count)) && Number(item.count) > 0 ? Number(item.count) : 1;
      providers = Array.from({ length: n }, () => item.provider);
    } else if (item.providers !== undefined || item.provider !== undefined) {
      warnings.push(`${where}[${i}] needs providers: [...] (or provider + count) with one of ${[...KNOWN_PROVIDERS].join(", ")}`);
    }
    if (providers.length > 0) entry.providers = providers;

    if (item.model !== undefined && item.model !== null && item.model !== "") {
      if (typeof item.model === "string") entry.model = item.model;
      else warnings.push(`${where}[${i}].model must be a string`);
    }

    if (Array.isArray(item.focus)) {
      entry.focus = item.focus.filter((f) => typeof f === "string" && f.trim().length > 0);
    }

    if (entry.role && entry.providers) out.push(entry);
  });
  return out;
}

function parseLockMap(raw, warnings) {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push(`agent_overrides_locked must be a mapping`);
    return {};
  }
  const out = {};
  for (const [stepId, value] of Object.entries(raw)) {
    if (typeof stepId !== "string" || !stepId) continue;
    out[stepId] = Boolean(value);
  }
  return out;
}

function normalizeVariantName(value, warnings) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    warnings.push(`flow_variant must be a string`);
    return null;
  }
  return value.trim().toLowerCase() || null;
}

function normalizeBool(value) {
  if (value === undefined || value === null) return null;
  return Boolean(value);
}

function normalizeText(value) {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function pruneEmpty(obj) {
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v === null || v === undefined || v === "") {
      delete obj[key];
      continue;
    }
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) {
      delete obj[key];
    }
  }
}
