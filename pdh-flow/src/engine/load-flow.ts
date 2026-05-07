// YAML → validated FlowYAML loader.
//
// Reads pdh-flow/flows/<flowId>.yaml, parses, validates against
// flow.schema.json, and returns the typed FlowYAML object. Throws
// SchemaViolation on invalid input — the caller does not need to defensively
// re-validate.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { FlowYAML } from "../types/index.ts";
import { getValidator, SCHEMA_IDS } from "./validate.ts";

export interface LoadFlowOptions {
  /** Repo root that contains the flows/ dir. */
  repoPath: string;
  /** Flow id (e.g. "pdh-c-v2") — corresponds to flows/<id>.yaml. */
  flowId: string;
}

export function loadFlow(opts: LoadFlowOptions): FlowYAML {
  const path = join(opts.repoPath, "flows", `${opts.flowId}.yaml`);
  const text = readFileSync(path, "utf8");
  const parsed: unknown = parseYaml(text);
  return getValidator().validateOrThrow<FlowYAML>(SCHEMA_IDS.flow, parsed);
}

export function parseFlow(yamlText: string): FlowYAML {
  const parsed: unknown = parseYaml(yamlText);
  return getValidator().validateOrThrow<FlowYAML>(SCHEMA_IDS.flow, parsed);
}
