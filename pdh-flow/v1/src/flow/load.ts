import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { AnyRecord } from "../types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(dirname(here));

export function loadFlow(flowId = "pdh-ticket-core") {
  const flowsDir = join(root, "flows");
  const path = join(flowsDir, `${flowId}.yaml`);
  const top = (parse(readFileSync(path, "utf8")) ?? {}) as AnyRecord;
  const stepsDir = join(flowsDir, "steps");
  const steps = [];
  if (existsSync(stepsDir)) {
    for (const file of readdirSync(stepsDir).sort()) {
      if (!file.endsWith(".yaml")) continue;
      const stepDoc = (parse(readFileSync(join(stepsDir, file), "utf8")) ?? {}) as AnyRecord;
      if (stepDoc?.id) steps.push(stepDoc);
    }
  }
  if (Array.isArray(top.steps) && top.steps.length > 0) {
    // Backwards-compat: a flow file that still inlines steps wins over per-step files.
    return top;
  }
  const merged = { ...top, steps };
  validateStepReferences(merged);
  for (const step of merged.steps ?? []) {
    flattenStepShape(step);
  }
  return merged;
}

// Bake variant-specific `step.provider` into a fresh copy of the flow's
// step list. Callers that already know the variant (loadRuntime,
// buildFlowView) use this so the dozens of step.provider readers don't
// each have to look up the variant-keyed map themselves. The returned
// flow shares everything else by reference; only `steps` is a new array
// of new step objects.
export function hydrateFlowForVariant(flow, variant: string) {
  if (!flow) return flow;
  if (!variant) {
    throw new Error("hydrateFlowForVariant requires variant");
  }
  const steps = (flow.steps ?? []).map((step) => ({
    ...step,
    provider: providerForStep(flow, step, variant)
  }));
  return { ...flow, steps };
}

// The canonical step yaml uses display:/prompt:/transitions: namespaces.
// Mirror those into the flat aliases (step.label, step.ui, step.on_success, …)
// that the rest of the codebase still reads. New code should prefer the
// namespaced fields directly.
function flattenStepShape(step: AnyRecord) {
  if (!step) return;
  const display = step.display ?? {};
  if (step.label === undefined && display.label !== undefined) step.label = display.label;
  if (step.summary === undefined && display.summary !== undefined) step.summary = display.summary;
  if (step.userAction === undefined && display.userAction !== undefined) step.userAction = display.userAction;
  if (step.ui === undefined && (display.viewer !== undefined || display.decision !== undefined || display.mustShow !== undefined || display.omit !== undefined || display.skipDefaultSchema !== undefined)) {
    step.ui = {
      viewer: display.viewer,
      decision: display.decision,
      mustShow: display.mustShow,
      omit: display.omit,
      skipDefaultSchema: display.skipDefaultSchema
    };
  }

  const prompt = step.prompt ?? {};

  // Lift review-specific prose from prompt:* into step.review.* for the
  // existing review-pipeline readers. Team config (aggregator/repair/roster)
  // already lives on flow.reviewers and is consulted by normalizeReviewPlan.
  if (step.mode === "review") {
    step.review = step.review ?? {};
    if (step.review.intent === undefined && prompt.intent !== undefined) step.review.intent = prompt.intent;
    if (step.review.passWhen === undefined && prompt.passWhen !== undefined) step.review.passWhen = prompt.passWhen;
    if (step.review.onFindings === undefined && prompt.onFindings !== undefined) step.review.onFindings = prompt.onFindings;
    if (step.review.reviewerRules === undefined && prompt.reviewerRules !== undefined) step.review.reviewerRules = prompt.reviewerRules;
    if (step.review.repairRules === undefined && prompt.repairRules !== undefined) step.review.repairRules = prompt.repairRules;
  }

  if (step.transitions) {
    for (const key of ["on_success", "on_failure", "on_human_approved", "on_human_rejected", "on_human_changes_requested"]) {
      if (step[key] === undefined && step.transitions[key] !== undefined) {
        step[key] = step.transitions[key];
      }
    }
  }
}

function validateStepReferences(flow: AnyRecord) {
  const known = new Set(flow.steps.map((step) => step.id));
  const variants: Record<string, AnyRecord> = flow.variants ?? {};
  for (const [variantName, spec] of Object.entries(variants)) {
    for (const stepId of spec?.sequence ?? []) {
      if (!known.has(stepId)) {
        throw new Error(`flow ${flow.flow}: variant ${variantName} references unknown step ${stepId}`);
      }
    }
  }
}

let cachedRoles = null;
export function loadRoles() {
  if (cachedRoles) return cachedRoles;
  const path = join(root, "flows", "roles.yaml");
  cachedRoles = (parse(readFileSync(path, "utf8")) ?? {}) as AnyRecord;
  return cachedRoles;
}

export function resolveSkillBodies(roleId) {
  if (!roleId) return [];
  const data = loadRoles() as AnyRecord;
  const role = data.roles?.[roleId];
  if (!role || !Array.isArray(role.skills)) return [];
  const skills = data.skills ?? {};
  return role.skills
    .map((skillId) => {
      const skill = skills[skillId];
      if (!skill) return null;
      return {
        id: skillId,
        label: typeof skill.label === "string" ? skill.label : skillId,
        body: typeof skill.body === "string" ? skill.body : ""
      };
    })
    .filter((entry) => entry && entry.body);
}

export function getInitialStep(flow, variant = "full") {
  const selected: AnyRecord = flow.variants?.[variant];
  if (!selected) {
    throw new Error(`Unknown flow variant: ${variant}`);
  }
  return selected.initial;
}

export function getStep(flow, stepId) {
  const step = flow.steps.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw new Error(`Unknown step: ${stepId}`);
  }
  return step;
}

export function nextStep(flow, variant, stepId, outcome = "success") {
  const step = getStep(flow, stepId);
  const key = outcome === "success" ? "on_success" : `on_${outcome}`;
  const target = step[key];
  if (target && typeof target === "object") {
    return target[variant] ?? target.default ?? null;
  }
  return target ?? null;
}

export function outcomeFromDecision(decision) {
  if (decision === "approved") {
    return "human_approved";
  }
  if (decision === "changes_requested") {
    return "human_changes_requested";
  }
  if (decision === "rejected" || decision === "cancelled") {
    return "human_rejected";
  }
  return null;
}

export function describeFlow(flow, variant = "full") {
  const selected: AnyRecord = flow.variants?.[variant];
  if (!selected) {
    throw new Error(`Unknown flow variant: ${variant}`);
  }
  return `${flow.flow}@v${flow.version} ${variant}: ${selected.sequence.join(" -> ")}`;
}

export function buildFlowView(flow, variant = "full", currentStepId = null) {
  const selected: AnyRecord = flow.variants?.[variant];
  if (!selected) {
    throw new Error(`Unknown flow variant: ${variant}`);
  }
  const roleCatalog = normalizeRoleCatalog(loadRoles().roles);
  const steps = selected.sequence.map((stepId) => {
    const step = getStep(flow, stepId);
    return {
      id: step.id,
      label: step.label ?? step.id,
      summary: step.summary ?? "",
      userAction: step.userAction ?? "",
      ui: normalizeUiContract(step.ui),
      display: step.display ?? null,
      role: step.role ?? null,
      review: normalizeReviewPlan({ step, flow, variant, roleCatalog }),
      provider: providerForStep(flow, step, variant),
      mode: step.mode,
      guards: (step.guards ?? []).map((guard) => ({ ...guard })),
      humanGate: Boolean(step.humanGate ?? step.human_gate),
      current: step.id === currentStepId
    };
  });
  return {
    id: flow.flow,
    version: flow.version,
    variant,
    variants: Object.fromEntries(Object.entries((flow.variants ?? {}) as Record<string, AnyRecord>).map(([name, spec]) => [
      name,
      {
        initial: spec.initial,
        sequence: [...(spec.sequence ?? [])],
        count: Number(spec.sequence?.length ?? 0)
      }
    ])),
    initial: selected.initial,
    sequence: selected.sequence,
    steps,
    edges: flowEdges(flow, variant)
  };
}

export function resolveStepReviewPlan(flow, variant = "full", stepId) {
  const view = buildFlowView(flow, variant, stepId);
  return view.steps.find((step) => step.id === stepId)?.review ?? null;
}

export function flowEdges(flow, variant = "full") {
  const sequence = flow.variants?.[variant]?.sequence ?? [];
  const allowed = new Set(sequence);
  const edges = [];
  for (const stepId of sequence) {
    const outcomes = ["success", "failure", "human_approved", "human_changes_requested", "human_rejected"];
    for (const outcome of outcomes) {
      const target = nextStep(flow, variant, stepId, outcome);
      if (!target) {
        continue;
      }
      if (target !== "COMPLETE" && !allowed.has(target)) {
        continue;
      }
      edges.push({ from: stepId, to: target, outcome, label: edgeLabel(outcome) });
    }
  }
  return dedupeEdges(edges);
}

export function renderMermaidFlow(flow, variant = "full", currentStepId = null) {
  const view = buildFlowView(flow, variant, currentStepId);
  const lines = ["flowchart TD"];
  for (const step of view.steps) {
    const nodeId = mermaidNodeId(step.id);
    const providerLabel = step.provider || (step.humanGate ? "human" : "?");
    const modeLabel = step.mode || "?";
    const label = `${step.id}<br/>${step.label}<br/><small>${providerLabel}/${modeLabel}</small>`;
    lines.push(`  ${nodeId}["${escapeMermaidLabel(label)}"]`);
  }
  if (view.edges.some((edge) => edge.to === "COMPLETE")) {
    lines.push('  COMPLETE["Complete"]');
  }
  for (const edge of view.edges) {
    lines.push(`  ${mermaidNodeId(edge.from)} -->|${escapeMermaidLabel(edge.label)}| ${mermaidNodeId(edge.to)}`);
  }
  lines.push("  classDef current fill:#fff8e8,stroke:#bf4f43,stroke-width:2px");
  lines.push("  classDef gate fill:#eef8f2,stroke:#247a4d,stroke-width:1px");
  if (currentStepId) {
    lines.push(`  class ${mermaidNodeId(currentStepId)} current`);
  }
  for (const step of view.steps.filter((item) => item.humanGate)) {
    lines.push(`  class ${mermaidNodeId(step.id)} gate`);
  }
  return `${lines.join("\n")}\n`;
}

// flow.providers[stepId] and flow.reviewers[stepId].{aggregator,repair} are
// variant-keyed maps: `{ full: "claude", light: "codex" }`. A variant key
// that is missing means the step does not run in that variant; the resolver
// returns null and the runtime is expected to skip the step.
export function providerForStep(flow, step, variant: string) {
  if (!step) return null;
  if (!variant) {
    throw new Error("providerForStep requires variant");
  }
  const stepId = typeof step === "string" ? step : step.id;
  const stepObj = typeof step === "string" ? null : step;
  if (stepObj?.mode === "review") {
    return pickVariant(flow?.reviewers?.[stepId]?.aggregator, variant, `reviewers.${stepId}.aggregator`);
  }
  return pickVariant(flow?.providers?.[stepId], variant, `providers.${stepId}`);
}

function pickVariant(value, variant: string, where: string) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where} must be a variant-keyed mapping (e.g. { full: claude, light: codex }), got ${typeof value}`);
  }
  const provider = value[variant];
  if (provider == null) return null;
  if (typeof provider !== "string") {
    throw new Error(`${where}.${variant} must be a string provider name, got ${typeof provider}`);
  }
  return provider;
}

export function reviewerPlanForStep(flow, stepId) {
  return flow?.reviewers?.[stepId] ?? null;
}

export function modelForStep(flow, stepId) {
  return flow?.models?.[stepId] ?? null;
}

function edgeLabel(outcome) {
  const labels = {
    success: "success",
    failure: "failure",
    human_approved: "approved",
    human_changes_requested: "changes requested",
    human_rejected: "rejected"
  };
  return labels[outcome] ?? outcome;
}

function dedupeEdges(edges) {
  const seen = new Set();
  return edges.filter((edge) => {
    const key = `${edge.from}\0${edge.to}\0${edge.outcome}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function mermaidNodeId(stepId) {
  if (stepId === "COMPLETE") {
    return "COMPLETE";
  }
  return stepId.replace(/[^A-Za-z0-9_]/g, "_");
}

function escapeMermaidLabel(value) {
  return String(value).replaceAll('"', "#quot;");
}

function normalizeUiContract(ui) {
  const source = ui ?? {};
  return {
    viewer: normalizeString(source.viewer),
    decision: normalizeString(source.decision),
    mustShow: normalizeStringList(source.mustShow),
    omit: normalizeStringList(source.omit),
    skipDefaultSchema: source.skipDefaultSchema === true
  };
}

function normalizeRoleCatalog(roles) {
  const source = (roles ?? {}) as Record<string, AnyRecord>;
  return Object.fromEntries(Object.entries(source).map(([id, entry]) => [
    id,
    {
      id,
      kind: normalizeString(entry?.kind),
      label: normalizeString(entry?.label ?? id),
      responsibility: normalizeString(entry?.responsibility),
      skills: normalizeStringList(entry?.skills)
    }
  ]));
}

function normalizeReviewPlan({ step, flow, variant, roleCatalog }) {
  const source = step?.review ?? {};
  const teamConfig = flow?.reviewers?.[step?.id] ?? {};
  // step yaml owns review semantics; flow yaml owns team composition (aggregator,
  // repair, reviewer roster per variant, maxInPlaceRepairs).
  const inlineRoster = Array.isArray(source.reviewers)
    ? source.reviewers
    : (source.reviewersByVariant?.[variant] ?? source.reviewersByVariant?.default ?? []);
  const flowRoster = Array.isArray(teamConfig?.[variant])
    ? teamConfig[variant]
    : (Array.isArray(teamConfig?.default) ? teamConfig.default : []);
  const reviewers = flowRoster.length > 0 ? flowRoster : inlineRoster;
  const aggregatorProvider = pickVariant(teamConfig.aggregator, variant, `reviewers.${step?.id}.aggregator`);
  const repairProvider = pickVariant(teamConfig.repair, variant, `reviewers.${step?.id}.repair`);
  return {
    intent: normalizeString(source.intent),
    maxRounds: normalizePositiveInteger(source.maxRounds),
    repairProvider: normalizeString(repairProvider ?? source.repairProvider),
    aggregatorProvider: normalizeString(aggregatorProvider),
    maxInPlaceRepairs: normalizeNonNegativeInteger(teamConfig.maxInPlaceRepairs),
    defaultRerunStep: normalizeString(source.defaultRerunStep),
    passWhen: normalizeStringList(source.passWhen),
    onFindings: normalizeStringList(source.onFindings),
    reviewerRules: normalizeStringList(source.reviewerRules),
    repairRules: normalizeStringList(source.repairRules),
    reviewers: Array.isArray(reviewers)
      ? reviewers.map((reviewer) => normalizeReviewer(reviewer, roleCatalog)).filter((entry) => entry.roleId || entry.label)
      : []
  };
}

function normalizeReviewer(reviewer, roleCatalog) {
  const roleId = normalizeString(reviewer?.role);
  const base = roleCatalog[roleId] ?? {};
  // Internally we always carry `providers: string[]` (one entry per
  // spawn). Legacy YAML form `{ provider: claude, count: 2 }` is
  // materialized to `[claude, claude]`. The new YAML / override form
  // `{ providers: [claude, codex] }` lets each spawn pick its own.
  let providers: string[] = [];
  if (Array.isArray(reviewer?.providers)) {
    providers = reviewer.providers.map((p) => normalizeString(p)).filter(Boolean);
  }
  if (providers.length === 0) {
    const provider = normalizeString(reviewer?.provider);
    const count = Number.isFinite(Number(reviewer?.count)) ? Math.max(Number(reviewer.count), 1) : 1;
    providers = provider ? Array.from({ length: count }, () => provider) : [];
  }
  return {
    roleId,
    label: normalizeString(reviewer?.label ?? base.label ?? roleId),
    provider: providers[0] ?? null,
    providers,
    responsibility: normalizeString(reviewer?.responsibility ?? base.responsibility),
    focus: normalizeStringList(reviewer?.focus)
  };
}

function normalizeString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(normalizeString).filter(Boolean);
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeNonNegativeInteger(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}
