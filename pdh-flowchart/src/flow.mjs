import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

export function loadFlow(flowId = "pdh-ticket-core") {
  const path = join(root, "flows", `${flowId}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
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

export function describeFlow(flow, variant = "full") {
  const selected = flow.variants?.[variant];
  if (!selected) {
    throw new Error(`Unknown flow variant: ${variant}`);
  }
  return `${flow.flow}@v${flow.version} ${variant}: ${selected.sequence.join(" -> ")}`;
}
