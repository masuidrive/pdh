import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";

const promptsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "flows", "prompts");
const stepsDir = join(promptsRoot, "steps");

const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(promptsRoot), {
  autoescape: false,
  trimBlocks: false,
  lstripBlocks: false,
  throwOnUndefined: true
});

let cachedKeys = null;

function loadStepKeys() {
  if (cachedKeys) {
    return cachedKeys;
  }
  if (!existsSync(stepsDir)) {
    cachedKeys = new Set();
    return cachedKeys;
  }
  cachedKeys = new Set(
    readdirSync(stepsDir)
      .filter((name) => name.endsWith(".j2"))
      .map((name) => name.slice(0, -3))
  );
  return cachedKeys;
}

export function listStepPromptKeys() {
  return [...loadStepKeys()];
}

export function hasStepPrompt(stepId) {
  return loadStepKeys().has(stepId);
}

export function renderStepPromptBody(stepId) {
  if (!hasStepPrompt(stepId)) {
    throw new Error(`flows/prompts/steps/${stepId}.j2 not found`);
  }
  const raw = readFileSync(join(stepsDir, `${stepId}.j2`), "utf8");
  return env.renderString(raw, {});
}

// Test hook only.
export function _resetStepPromptsCache() {
  cachedKeys = null;
}
