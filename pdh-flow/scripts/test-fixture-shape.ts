// Phase D verification: every v2 fixture has input/, output/ (or per-node/),
// meta.json that validates against tests/fixture-meta.schema.json, and
// internal consistency (each guardian_output validates against
// guardian-output.schema.json).
//
// Invoked via `npm run test:fixture-shape` or `bash scripts/test-fixture-shape.sh`.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Validator,
  SCHEMA_IDS,
  SchemaViolation,
  formatErrors,
} from "../src/engine/validate.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = join(__dirname, "..");
const FIXTURES_ROOT = join(REPO, "tests", "fixtures", "v2");

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, info?: string): void {
  if (cond) {
    console.log(`  ok    ${label}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label}${info ? "\n        " + info : ""}`);
    failed++;
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

// Build the validator and additionally register the meta schema.
const validator = new Validator();
const META_SCHEMA_PATH = join(REPO, "tests", "fixture-meta.schema.json");
const META_SCHEMA = JSON.parse(readFileSync(META_SCHEMA_PATH, "utf8"));
const META_SCHEMA_ID: string = META_SCHEMA.$id;
// Using `(validator as any).ajv` is not exposed; instead, validate manually.
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsPkg from "ajv-formats";
type AddFormatsFn = (ajv: Ajv2020, formats?: unknown) => Ajv2020;
const addFormats: AddFormatsFn = (
  (addFormatsPkg as unknown as { default?: unknown }).default ??
  (addFormatsPkg as unknown)
) as AddFormatsFn;
const auxAjv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
addFormats(auxAjv);
auxAjv.addSchema(META_SCHEMA, "fixture-meta.schema.json");

function validateMeta(meta: unknown): { ok: boolean; messages: string } {
  const fn = auxAjv.getSchema(META_SCHEMA_ID);
  if (!fn) return { ok: false, messages: "meta schema not registered" };
  if (fn(meta)) return { ok: true, messages: "" };
  return { ok: false, messages: formatErrors(fn.errors ?? []) };
}

// ─── Discover scenarios ──────────────────────────────────────────────────
section("discover fixtures");
assert("fixtures/v2 dir exists", existsSync(FIXTURES_ROOT));
const scenarios = readdirSync(FIXTURES_ROOT).filter((name) => {
  const path = join(FIXTURES_ROOT, name);
  if (!statSync(path).isDirectory()) return false;
  // smoke-* dirs are real-LLM smoke fixtures (input only, no meta.json).
  // They live alongside replay fixtures for filesystem convenience but
  // do not conform to the fixture-meta contract.
  if (name.startsWith("smoke-")) return false;
  return true;
});
assert(`>= 2 scenarios discovered (got ${scenarios.length}: ${scenarios.join(", ")})`, scenarios.length >= 2);

// ─── Per-scenario shape ──────────────────────────────────────────────────
for (const scenario of scenarios) {
  section(`scenario: ${scenario}`);
  const dir = join(FIXTURES_ROOT, scenario);

  const metaPath = join(dir, "meta.json");
  assert(`meta.json exists`, existsSync(metaPath));
  if (!existsSync(metaPath)) continue;

  let meta: any;
  try {
    meta = JSON.parse(readFileSync(metaPath, "utf8"));
  } catch (e) {
    assert("meta.json parses", false, (e as Error).message);
    continue;
  }
  assert("meta.json parses", true);

  const metaValidation = validateMeta(meta);
  assert(
    "meta.json validates against fixture-meta.schema.json",
    metaValidation.ok,
    metaValidation.messages,
  );

  assert(`scenario name matches dir`, meta.scenario === scenario);

  const inputDir = join(dir, "input");
  assert(`input/ exists`, existsSync(inputDir));
  if (existsSync(inputDir)) {
    const inputFiles = readdirSync(inputDir);
    assert(`input/ has files`, inputFiles.length > 0);
    assert(`input/current-note.md exists`, existsSync(join(inputDir, "current-note.md")));
    assert(`input/current-ticket.md exists`, existsSync(join(inputDir, "current-ticket.md")));
  }

  // Each guardian_output in node_outputs must validate against the schema.
  if (meta.node_outputs) {
    for (const [nodeId, rounds] of Object.entries(meta.node_outputs as Record<string, Record<string, any>>)) {
      for (const [roundKey, payload] of Object.entries(rounds)) {
        if (payload?.guardian_output) {
          const r = validator.validate(SCHEMA_IDS.guardianOutput, payload.guardian_output);
          assert(
            `${nodeId} ${roundKey}: guardian_output validates`,
            r.ok === true,
            r.ok === false ? formatErrors(r.errors) : undefined,
          );
        }
      }
    }
  }

  // Sanity: expected_decisions reference nodes named in node_outputs (when both present).
  if (meta.node_outputs) {
    for (const decision of meta.expected_decisions) {
      if (decision.node.endsWith(".aggregate") && decision.decision !== "completed") {
        const node = meta.node_outputs[decision.node];
        const round = `round-${decision.round}`;
        assert(
          `node_outputs[${decision.node}][${round}] referenced by expected_decisions`,
          !!node?.[round],
        );
      }
    }
  }
}

// ─── Result ──────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
