// `pdh-flow check-flow --flow <id>` — validates a flow YAML against
// flow.schema.json. Prints a JSON success summary on stdout, or formatted
// error list on stderr + exit 1.

import { resolve } from "node:path";
import { parseSubcommandArgs } from "./index.ts";
import { loadFlow } from "../engine/load-flow.ts";
import { expandFlow } from "../engine/expand-macro.ts";
import { SchemaViolation } from "../engine/validate.ts";

export async function cmdCheckFlow(argv: string[]): Promise<void> {
  const { values } = parseSubcommandArgs(argv, {
    flow: { type: "string" },
    repo: { type: "string" },
  });

  const flowId = values.flow as string | undefined;
  if (!flowId) {
    throw new Error("--flow <id> is required");
  }
  const repoPath = (values.repo as string | undefined)
    ? resolve(values.repo as string)
    : process.cwd();

  let flow;
  try {
    flow = loadFlow({ repoPath, flowId });
  } catch (error) {
    if (error instanceof SchemaViolation) {
      process.stderr.write(`flow YAML invalid: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  // Macro expansion is part of "checking" since invalid macros only surface
  // here. expandFlow re-validates against flat-flow.schema.json internally.
  let flat;
  try {
    flat = expandFlow(flow, { sourcePath: `flows/${flowId}.yaml` });
  } catch (error) {
    if (error instanceof SchemaViolation) {
      process.stderr.write(`macro expansion produced invalid flat-flow:\n${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const macroNodes = Object.keys(flow.nodes).filter((id) => {
    const n = flow.nodes[id] as { macro?: unknown };
    return typeof n.macro === "string";
  });
  const flatNodeCount = Object.keys(flat.nodes).length;

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        flow: flowId,
        variants: Object.keys(flow.variants),
        author_node_count: Object.keys(flow.nodes).length,
        flat_node_count: flatNodeCount,
        macro_nodes: macroNodes,
      },
      null,
      2,
    ) + "\n",
  );
}
