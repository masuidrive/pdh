// Validation test suite for the v2 engine.
// Run via `npm run test:validate` or `bash scripts/test-validate.sh`.
//
// Executed by Node 24's built-in TS stripping. Exits 1 on first failure.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  getValidator,
  SCHEMA_IDS,
  SchemaViolation,
} from "../src/engine/validate.ts";
import { loadFlow, parseFlow } from "../src/engine/load-flow.ts";
import { expandFlow } from "../src/engine/expand-macro.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = join(__dirname, "..");

let failed = 0;
let passed = 0;

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

// ─── 1. Schemas load ────────────────────────────────────────────────────
section("validator boot");
const v = getValidator();
for (const [name, id] of Object.entries(SCHEMA_IDS)) {
  assert(`schema registered: ${name}`, v.hasSchema(id));
}

// ─── 2. Valid flow YAML ──────────────────────────────────────────────────
section("valid flow YAML");
{
  const flow = loadFlow({ repoPath: REPO, flowId: "pdh-c-v2" });
  assert("loadFlow returns object", typeof flow === "object" && flow !== null);
  assert("flow.flow == pdh-c-v2", flow.flow === "pdh-c-v2");
  assert("11 nodes", Object.keys(flow.nodes).length === 11);
  assert("variants: full + light", "full" in flow.variants && "light" in flow.variants);
}

// ─── 3. Malformed flow → SchemaViolation ─────────────────────────────────
section("malformed flow YAML");
{
  // Missing required `version`.
  const bad = `
flow: bad
variants:
  full:
    initial: x
nodes:
  x:
    type: terminal
    outcome: success
`;
  let caught: unknown = null;
  try {
    parseFlow(bad);
  } catch (e) {
    caught = e;
  }
  assert("missing version → SchemaViolation thrown", caught instanceof SchemaViolation);
  if (caught instanceof SchemaViolation) {
    const messages = caught.errors.map((e) => `${e.instancePath} ${e.keyword}`).join(" | ");
    assert("error mentions required", /required/.test(messages), `got: ${messages}`);
  }
}

// ─── 4. Provider step missing required `provider` ────────────────────────
section("invalid node shape");
{
  const bad = `
flow: bad2
version: 1
variants:
  full:
    initial: x
nodes:
  x:
    type: provider_step
    on_done: y
  y:
    type: terminal
    outcome: success
`;
  let caught: unknown = null;
  try { parseFlow(bad); } catch (e) { caught = e; }
  assert("provider_step without provider → throws", caught instanceof SchemaViolation);
}

// ─── 5. Guardian output: valid pass ──────────────────────────────────────
section("guardian output schema");
{
  const ok = {
    decision: "pass",
    summary: "all reviewers passed",
    reasoning: "no blocking findings raised in any of the 5 reviewers",
    round: 1,
    evidence_consumed: ["x.devils_advocate_1", "x.code_reviewer_1"],
  };
  const r = v.validate(SCHEMA_IDS.guardianOutput, ok);
  assert("valid pass → ok", r.ok === true);
}

// ─── 6. Guardian output: pass with blocking_findings = invalid ───────────
{
  const bad = {
    decision: "pass",
    summary: "ok",
    reasoning: "but here are some findings",
    round: 1,
    evidence_consumed: ["x.devils_advocate_1"],
    blocking_findings: [
      {
        severity: "critical",
        title: "leak",
        evidence_ref: "src/auth.ts:42",
      },
    ],
  };
  const r = v.validate(SCHEMA_IDS.guardianOutput, bad);
  assert("pass + blocking_findings → invalid", r.ok === false);
}

// ─── 7. Guardian output: repair_needed without blocking_findings ─────────
{
  const bad = {
    decision: "repair_needed",
    summary: "needs fixing",
    reasoning: "see findings",
    round: 1,
    evidence_consumed: ["x.devils_advocate_1"],
    // missing blocking_findings
  };
  const r = v.validate(SCHEMA_IDS.guardianOutput, bad);
  assert("repair_needed without blocking_findings → invalid", r.ok === false);
}

// ─── 8. Macro expansion → flat-flow validates ────────────────────────────
section("macro expansion");
{
  const flow = loadFlow({ repoPath: REPO, flowId: "pdh-c-v2" });
  const flat = expandFlow(flow, { sourcePath: "flows/pdh-c-v2.yaml" });
  assert("compiled flow validates", flat.flow === "pdh-c-v2");

  // code_quality_review macro should expand to:
  //   parent (parallel_group), 5 reviewer nodes (2+2+1), aggregate, repair
  // = 8 nodes total (named code_quality_review.{devils_advocate_{1,2}, code_reviewer_{1,2}, critical_1, aggregate, repair})
  const cqrNodes = Object.keys(flat.nodes).filter((id) =>
    id === "code_quality_review" || id.startsWith("code_quality_review."),
  );
  assert(
    `code_quality_review expands to 8 nodes (got ${cqrNodes.length}: ${cqrNodes.join(", ")})`,
    cqrNodes.length === 8,
  );

  // The parent should be a parallel_group with 5 members.
  const parent = flat.nodes["code_quality_review"];
  assert("parent is parallel_group", (parent as { type?: string }).type === "parallel_group");
  if ((parent as { type?: string }).type === "parallel_group") {
    const members = (parent as { members: string[] }).members;
    assert(`parent has 5 members (got ${members.length})`, members.length === 5);
    const aggregate = (parent as { on_all_done: unknown }).on_all_done;
    assert("on_all_done points to aggregate", aggregate === "code_quality_review.aggregate");
  }

  // Aggregate should be guardian_step with inputs_from = 5 reviewer ids.
  const aggregate = flat.nodes["code_quality_review.aggregate"];
  assert("aggregate exists", !!aggregate);
  if (aggregate && (aggregate as { type?: string }).type === "guardian_step") {
    const inputs = (aggregate as { inputs_from?: string | string[] }).inputs_from;
    assert(
      `aggregate inputs_from has 5 reviewer ids`,
      Array.isArray(inputs) && inputs.length === 5,
    );
    const outputs = (aggregate as { outputs?: { repair_needed?: { next?: string } } }).outputs;
    assert(
      "aggregate.repair_needed.next == repair node",
      outputs?.repair_needed?.next === "code_quality_review.repair",
    );
  }

  // Repair should loop back to parent.
  const repair = flat.nodes["code_quality_review.repair"];
  assert("repair exists", !!repair);
  if (repair && (repair as { type?: string }).type === "provider_step") {
    const onDone = (repair as { on_done?: unknown }).on_done;
    assert("repair.on_done loops to parent", onDone === "code_quality_review");
  }

  // Plan review should also expand (4 reviewers in macro).
  const planReviewNodes = Object.keys(flat.nodes).filter(
    (id) => id === "plan_review" || id.startsWith("plan_review."),
  );
  // 4 reviewers (2 da + 1 coding + 1 critical) + aggregate + repair + parent = 7
  assert(
    `plan_review expands to 7 nodes (got ${planReviewNodes.length})`,
    planReviewNodes.length === 7,
  );

  // Macro origins recorded.
  assert(
    "macro_origins records expansion",
    flat.macro_origins?.["code_quality_review.devils_advocate_1"] === "code_quality_review",
  );
}

// ─── 9. Macro with 0-count reviewer (variant opt-out) ────────────────────
section("macro: count=0 skip");
{
  const text = `
flow: zero-count
version: 1
variants:
  full:
    initial: r
nodes:
  r:
    macro: review_loop
    reviewers:
      - { role: kept, provider: claude, count: 1 }
      - { role: skipped, provider: codex, count: 0 }
    aggregator: { provider: claude }
    repair: { provider: codex }
    max_rounds: 2
    on_pass: ok
    on_aborted: ok
  ok:
    type: terminal
    outcome: success
`;
  const flow = parseFlow(text);
  const flat = expandFlow(flow);
  const ids = Object.keys(flat.nodes).filter((id) => id.startsWith("r."));
  // Should be: r.kept_1, r.aggregate, r.repair (3) — skipped role omitted.
  assert(
    `count=0 omitted (got: ${ids.join(", ")})`,
    ids.length === 3 && !ids.some((i) => i.includes("skipped")),
  );
}

// ─── 10. Snapshot validation ─────────────────────────────────────────────
section("snapshot validation");
{
  const snap = {
    version: 1,
    engine: { name: "pdh-flow", version: "0.2.0" },
    saved_at: new Date().toISOString(),
    run_id: "run-test",
    ticket_id: "260507-220000-test-ticket",
    flow: "pdh-c-v2",
    variant: "full",
    xstate_snapshot: { dummy: true },
  };
  const r = v.validate(SCHEMA_IDS.snapshot, snap);
  assert("valid snapshot → ok", r.ok === true);
}

// ─── Result ──────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
