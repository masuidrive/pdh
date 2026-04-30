import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import nunjucks from "nunjucks";

const stepPromptsPath = join(dirname(fileURLToPath(import.meta.url)), "..", "flows", "step-prompts.yaml");

const env = new nunjucks.Environment(null, {
  autoescape: false,
  trimBlocks: false,
  lstripBlocks: false,
  throwOnUndefined: true
});

let cached = null;

function loadPrompts() {
  if (cached) {
    return cached;
  }
  const raw = readFileSync(stepPromptsPath, "utf8");
  const doc = parse(raw);
  if (!doc || typeof doc !== "object" || !doc.prompts || typeof doc.prompts !== "object") {
    throw new Error(`step-prompts.yaml must define a top-level prompts map (path: ${stepPromptsPath})`);
  }
  cached = doc.prompts;
  return cached;
}

export function listStepPromptKeys() {
  return Object.keys(loadPrompts());
}

export function hasStepPrompt(stepId) {
  return Object.prototype.hasOwnProperty.call(loadPrompts(), stepId);
}

export function renderStepPromptBody(stepId) {
  const prompts = loadPrompts();
  const body = prompts[stepId];
  if (typeof body !== "string") {
    throw new Error(`step-prompts.yaml has no entry for ${stepId}`);
  }
  return renderUntilStable(body, prompts);
}

const MAX_EXPANSION_PASSES = 16;

function renderUntilStable(template, context) {
  let current = template;
  for (let pass = 0; pass < MAX_EXPANSION_PASSES; pass += 1) {
    const next = env.renderString(current, context);
    if (next === current) {
      return next;
    }
    current = next;
  }
  throw new Error(
    `step-prompts.yaml expansion did not converge within ${MAX_EXPANSION_PASSES} passes — likely a placeholder cycle`
  );
}

// Test hook only.
export function _resetStepPromptsCache() {
  cached = null;
}
