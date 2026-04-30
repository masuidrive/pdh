import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

export function loadFlow(flowId = "pdh-ticket-core") {
  const path = join(root, "flows", `${flowId}.yaml`);
  return parse(readFileSync(path, "utf8"));
}

let cachedRoles = null;
export function loadRoles() {
  if (cachedRoles) return cachedRoles;
  const path = join(root, "flows", "roles.yaml");
  cachedRoles = parse(readFileSync(path, "utf8"));
  return cachedRoles;
}

export function resolveSkillBodies(roleId) {
  if (!roleId) return [];
  const data = loadRoles();
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
  const selected = flow.variants?.[variant];
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
  const selected = flow.variants?.[variant];
  if (!selected) {
    throw new Error(`Unknown flow variant: ${variant}`);
  }
  return `${flow.flow}@v${flow.version} ${variant}: ${selected.sequence.join(" -> ")}`;
}

export function buildFlowView(flow, variant = "full", currentStepId = null) {
  const selected = flow.variants?.[variant];
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
      review: normalizeReviewPlan(step.review, variant, roleCatalog),
      provider: step.provider,
      mode: step.mode,
      guards: (step.guards ?? []).map((guard) => ({ ...guard })),
      humanGate: Boolean(step.human_gate),
      current: step.id === currentStepId
    };
  });
  return {
    id: flow.flow,
    version: flow.version,
    variant,
    variants: Object.fromEntries(Object.entries(flow.variants ?? {}).map(([name, spec]) => [
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
    const label = `${step.id}<br/>${step.label}<br/><small>${step.provider}/${step.mode}</small>`;
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
  for (const step of view.steps.filter((item) => item.mode === "human")) {
    lines.push(`  class ${mermaidNodeId(step.id)} gate`);
  }
  return `${lines.join("\n")}\n`;
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
    omit: normalizeStringList(source.omit)
  };
}

function normalizeRoleCatalog(roles) {
  const source = roles ?? {};
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

function normalizeReviewPlan(review, variant, roleCatalog) {
  const source = review ?? {};
  const reviewers = Array.isArray(source.reviewers)
    ? source.reviewers
    : (source.reviewersByVariant?.[variant] ?? source.reviewersByVariant?.default ?? []);
  return {
    intent: normalizeString(source.intent),
    maxRounds: normalizePositiveInteger(source.maxRounds),
    repairProvider: normalizeString(source.repairProvider),
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
  return {
    roleId,
    label: normalizeString(reviewer?.label ?? base.label ?? roleId),
    provider: normalizeString(reviewer?.provider),
    responsibility: normalizeString(reviewer?.responsibility ?? base.responsibility),
    count: Number.isFinite(Number(reviewer?.count)) ? Number(reviewer.count) : 1,
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
