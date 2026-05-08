// Prompt template loader.
//
// All v2 actor prompts (assist / planner / implementer / reviewer / guardian)
// live as .j2 files under `flows/prompts/`. Templates are jinja2-shaped;
// nunjucks is the runtime renderer. Extension is `.j2` to match the rest of
// the repo's conventions, even though nunjucks would accept any name.
//
// Why externalised: prompts grow, branch on mode, and need to be reviewable
// alongside flow definitions. Inline TS string-arrays buried the rules and
// made cross-prompt edits awkward.

import nunjucks from "nunjucks";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// src/engine/prompts/ → repo root → flows/prompts/
const PROMPTS_DIR = join(__dirname, "..", "..", "..", "flows", "prompts");

const env = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(PROMPTS_DIR, { noCache: false }),
  { autoescape: false, throwOnUndefined: false, trimBlocks: true, lstripBlocks: true },
);

/**
 * Render the named template with the given context.
 *
 * @param name Template basename without extension (e.g. "assist", "implementer").
 * @param context Variables exposed to the template.
 * @returns Rendered prompt with leading/trailing whitespace normalised.
 */
export function renderPrompt(
  name: string,
  context: Record<string, unknown>,
): string {
  const out = env.render(`${name}.j2`, context);
  return out.replace(/\s+$/g, "") + "\n";
}
