// Ajv schema validator for the v2 engine.
//
// Loads all schemas under pdh-flow/schemas/*.schema.json once on construction
// and exposes typed validate<T>(...) plus convenience helpers for each
// canonical schema. Cross-file $refs use the schema's $id; the resolver
// registers each schema under its $id at boot.

import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import addFormatsPkg from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ajv-formats ships CJS; under verbatimModuleSyntax + NodeNext the default
// import resolves to the namespace, so unwrap to the actual plugin function.
type AddFormatsFn = (ajv: Ajv2020, formats?: unknown) => Ajv2020;
const addFormats: AddFormatsFn = (
  (addFormatsPkg as unknown as { default?: unknown }).default ??
  (addFormatsPkg as unknown)
) as AddFormatsFn;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// pdh-flow/src/engine/validate.ts → pdh-flow/schemas/
const SCHEMAS_DIR = join(__dirname, "..", "..", "schemas");

export const SCHEMA_IDS = {
  flow: "https://pdh-flow.dev/schemas/flow.schema.json",
  flatFlow: "https://pdh-flow.dev/schemas/flat-flow.schema.json",
  providerOutput: "https://pdh-flow.dev/schemas/provider-output.schema.json",
  providerStepOutput: "https://pdh-flow.dev/schemas/provider-step-output.schema.json",
  guardianOutput: "https://pdh-flow.dev/schemas/guardian-output.schema.json",
  gateOutput: "https://pdh-flow.dev/schemas/gate-output.schema.json",
  systemOutput: "https://pdh-flow.dev/schemas/system-output.schema.json",
  judgement: "https://pdh-flow.dev/schemas/judgement.schema.json",
  noteFrontmatter: "https://pdh-flow.dev/schemas/note-frontmatter.schema.json",
  ticketFrontmatter: "https://pdh-flow.dev/schemas/ticket-frontmatter.schema.json",
  engineEvent: "https://pdh-flow.dev/schemas/engine-event.schema.json",
  progressEvent: "https://pdh-flow.dev/schemas/progress-event.schema.json",
  snapshot: "https://pdh-flow.dev/schemas/snapshot.schema.json",
  turnQuestion: "https://pdh-flow.dev/schemas/turn-question.schema.json",
  turnAnswer: "https://pdh-flow.dev/schemas/turn-answer.schema.json",
} as const;

export type SchemaId = (typeof SCHEMA_IDS)[keyof typeof SCHEMA_IDS];

export type ValidateResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: ErrorObject[] };

export class SchemaViolation extends Error {
  readonly errors: ErrorObject[];
  readonly schemaId: string;
  constructor(schemaId: string, errors: ErrorObject[]) {
    super(`Schema violation against ${schemaId}:\n${formatErrors(errors)}`);
    this.name = "SchemaViolation";
    this.schemaId = schemaId;
    this.errors = errors;
  }
}

export class GuardianViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardianViolation";
  }
}

export function formatErrors(errors: ErrorObject[]): string {
  if (!errors || errors.length === 0) return "(no errors)";
  return errors
    .map((e) => {
      const path = e.instancePath || "(root)";
      return `  ${path}: ${e.message ?? e.keyword}${
        e.params ? " " + JSON.stringify(e.params) : ""
      }`;
    })
    .join("\n");
}

export class Validator {
  private ajv: Ajv2020;
  // Schemas keyed by both filename (e.g. "common.schema.json") and $id.
  private loadedSchemaIds = new Set<string>();

  constructor(schemasDir = SCHEMAS_DIR) {
    this.ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      // strictTypes/strictRequired false: our schemas use if/then to add
      // requirements based on a discriminating field (e.g. status==completed
      // implies `approver` required), which is correct JSON Schema but trips
      // these stricter checks.
      strictTypes: false,
      strictRequired: false,
      strictTuples: true,
    });
    addFormats(this.ajv);

    for (const fname of readdirSync(schemasDir)) {
      if (!fname.endsWith(".schema.json")) continue;
      const path = join(schemasDir, fname);
      const schema = JSON.parse(readFileSync(path, "utf8"));
      // $ref resolution between files uses relative URIs (e.g.
      // "common.schema.json#/$defs/NodeId"); Ajv resolves these against the
      // schema's $id, which we set when registering. Register under both the
      // filename (for relative ref lookup) and the canonical $id.
      this.ajv.addSchema(schema, fname);
      if (typeof schema.$id === "string") {
        this.loadedSchemaIds.add(schema.$id);
      }
    }
  }

  validate<T = unknown>(schemaId: string, data: unknown): ValidateResult<T> {
    const validateFn = this.ajv.getSchema(schemaId);
    if (!validateFn) {
      throw new Error(`Unknown schema id: ${schemaId}`);
    }
    if (validateFn(data)) {
      return { ok: true, data: data as T };
    }
    const errs = validateFn.errors ?? [];
    return { ok: false, errors: errs };
  }

  validateOrThrow<T = unknown>(schemaId: string, data: unknown): T {
    const result = this.validate<T>(schemaId, data);
    if (result.ok === true) return result.data;
    throw new SchemaViolation(schemaId, result.errors);
  }

  hasSchema(schemaId: string): boolean {
    return this.loadedSchemaIds.has(schemaId);
  }
}

// Module-level singleton — schemas don't change at runtime.
let _singleton: Validator | null = null;
export function getValidator(): Validator {
  if (!_singleton) _singleton = new Validator();
  return _singleton;
}
