// `pdh-flow compile-flow --flow <id> [--out <file>]` — validate + macro-
// expand a flow YAML, then print/write the flat-flow JSON. Useful for
// inspecting what the engine actually consumes after macro expansion.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSubcommandArgs } from "./index.ts";
import { loadFlow } from "../engine/load-flow.ts";
import { expandFlow } from "../engine/expand-macro.ts";

export async function cmdCompileFlow(argv: string[]): Promise<void> {
  const { values } = parseSubcommandArgs(argv, {
    flow: { type: "string" },
    repo: { type: "string" },
    out: { type: "string" },
  });

  const flowId = values.flow as string | undefined;
  if (!flowId) {
    throw new Error("--flow <id> is required");
  }
  const repoPath = (values.repo as string | undefined)
    ? resolve(values.repo as string)
    : process.cwd();

  const flow = loadFlow({ repoPath, flowId });
  const flat = expandFlow(flow, { sourcePath: `flows/${flowId}.yaml` });

  const json = JSON.stringify(flat, null, 2) + "\n";
  if (values.out) {
    writeFileSync(values.out as string, json);
    process.stderr.write(`wrote compiled flow to ${values.out}\n`);
  } else {
    process.stdout.write(json);
  }
}
