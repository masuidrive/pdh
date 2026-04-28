import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const stepPromptsPath = join(dirname(fileURLToPath(import.meta.url)), "step-prompts.yaml");

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
  return expandPlaceholders(body, prompts, [stepId]);
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;

function expandPlaceholders(value, prompts, stack) {
  return value.replace(PLACEHOLDER_RE, (match, key) => {
    if (stack.includes(key)) {
      throw new Error(`step-prompts.yaml placeholder cycle detected: ${stack.join(" -> ")} -> ${key}`);
    }
    const sub = prompts[key];
    if (typeof sub !== "string") {
      throw new Error(`step-prompts.yaml placeholder {{${key}}} (referenced from ${stack.join(" -> ")}) is not defined`);
    }
    return expandPlaceholders(sub, prompts, [...stack, key]);
  });
}

// Test hook only.
export function _resetStepPromptsCache() {
  cached = null;
}
