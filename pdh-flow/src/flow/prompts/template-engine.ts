import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import { runtimeCliCommand } from "../../cli/cli-command.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(dirname(dirname(here)));
const templatesDir = join(root, "flows");

const env = nunjucks.configure(templatesDir, {
  autoescape: false,
  trimBlocks: false,
  lstripBlocks: false,
  noCache: false,
  throwOnUndefined: false
});

env.addFilter("trimEnd", (value) =>
  typeof value === "string" ? value.replace(/\s+$/, "") : value
);

export function renderTemplate(name, context = {}) {
  return env.render(name, {
    runtimeCli: runtimeCliCommand(),
    ...context
  });
}
