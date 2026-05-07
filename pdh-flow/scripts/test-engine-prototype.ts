// Phase E verification: end-to-end engine run on the v2 fixtures.
//
// 1. round1_pass: implementation passes on first round (5 reviewer + 1 aggregate
//    commits = 6 total, then engine arrives at final_verification).
// 2. repair_then_pass: round 1 repair_needed → repair → round 2 pass
//    (5 reviewer + 1 aggregate + 1 repair + 5 reviewer + 1 aggregate
//    = 13 commits, then arrives at final_verification).
//
// Plus: re-running the engine on the same repo should read the frozen
// judgement and not re-decide (idempotency).

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runEngine } from "../src/engine/run.ts";
import {
  getValidator,
  SCHEMA_IDS,
  formatErrors,
} from "../src/engine/validate.ts";

// `existsSync` and `readFileSync` are already imported above; re-import not
// needed.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = join(__dirname, "..");
const FIXTURES = join(REPO, "tests", "fixtures", "v2");

let failed = 0;
let passed = 0;
const cleanup: string[] = [];

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

function gitLog(repo: string): string[] {
  const r = spawnSync("git", ["log", "--format=%s"], { cwd: repo, encoding: "utf8" });
  return (r.stdout ?? "").split("\n").filter(Boolean);
}

function seedRepo(scenario: string): { worktree: string; meta: any } {
  const fixtureDir = join(FIXTURES, scenario);
  const meta = JSON.parse(readFileSync(join(fixtureDir, "meta.json"), "utf8"));
  const worktree = mkdtempSync(join(tmpdir(), `pdh-engine-${scenario}-`));
  cleanup.push(worktree);

  // Copy input/ → worktree
  cpSync(join(fixtureDir, "input"), worktree, { recursive: true });

  // git init
  spawnSync("git", ["init", "-q"], { cwd: worktree });
  spawnSync(
    "git",
    [
      "-c",
      "user.email=test@pdh-flow.local",
      "-c",
      "user.name=test",
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "init",
    ],
    { cwd: worktree },
  );
  spawnSync("git", ["add", "-A"], { cwd: worktree });
  const r = spawnSync(
    "git",
    [
      "-c",
      "user.email=test@pdh-flow.local",
      "-c",
      "user.name=test",
      "commit",
      "-q",
      "-m",
      "[setup] seeded fixture input",
    ],
    { cwd: worktree },
  );
  if (r.status !== 0) {
    throw new Error(`seed commit failed: ${r.stderr}`);
  }

  return { worktree, meta };
}

async function runScenario(scenario: string, runIdSuffix: string): Promise<{
  worktree: string;
  meta: any;
  result: any;
}> {
  const { worktree, meta } = seedRepo(scenario);
  const result = await runEngine({
    repoPath: REPO,
    flowId: meta.flow_id ?? "pdh-c-v2",
    variant: meta.variant ?? "full",
    worktreePath: worktree,
    runId: `run-test-${scenario}-${runIdSuffix}`,
    fixtureMeta: meta,
    startAtNodeId: meta.starting_node,
    stopAtNodeId: meta.expected_terminal_node,
    timeoutMs: 30_000,
  });
  return { worktree, meta, result };
}

function checkCommitPatterns(
  worktree: string,
  patterns: { subject_pattern: string; min_count?: number }[],
): { ok: boolean; missing: string[]; total: number } {
  const log = gitLog(worktree);
  const missing: string[] = [];
  for (const p of patterns) {
    const re = new RegExp(p.subject_pattern);
    const matches = log.filter((s) => re.test(s));
    const minCount = p.min_count ?? 1;
    if (matches.length < minCount) missing.push(p.subject_pattern);
  }
  return { ok: missing.length === 0, missing, total: log.length };
}

function checkJudgementValidity(worktree: string, runId: string): { ok: boolean; details: string[] } {
  const v = getValidator();
  const dir = join(worktree, ".pdh-flow", "runs", runId, "judgements");
  const details: string[] = [];
  if (!existsSync(dir)) return { ok: false, details: ["judgements dir missing"] };
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const path = join(dir, f);
    const obj = JSON.parse(readFileSync(path, "utf8"));
    const r = v.validate(SCHEMA_IDS.judgement, obj);
    if (r.ok === false) {
      details.push(`${f}: ${formatErrors(r.errors)}`);
    } else {
      details.push(`${f}: ok`);
    }
  }
  return { ok: details.every((d) => d.endsWith("ok")), details };
}

// ─── Scenario 1: round1_pass ──────────────────────────────────────────────
section("scenario: code_quality_review_round1_pass");
{
  const { worktree, meta, result } = await runScenario(
    "code_quality_review_round1_pass",
    "1",
  );

  assert(
    `engine reaches stop point at ${meta.expected_terminal_node}`,
    result.stoppedAt === meta.expected_terminal_node,
    `stoppedAt=${result.stoppedAt}, finalState=${result.finalState}`,
  );

  assert("round counter == 1", result.context.round === 1);
  assert(
    "lastGuardianDecision == pass",
    result.context.lastGuardianDecision === "pass",
  );

  const cp = checkCommitPatterns(worktree, meta.expected_commits);
  assert(
    `expected commit subjects all present (got ${cp.total} commits, missing ${cp.missing.length})`,
    cp.ok,
    cp.missing.length > 0 ? "missing patterns: " + cp.missing.join("; ") : undefined,
  );

  // Should be 6 review-related commits (5 reviewer + 1 aggregate) plus 1 init seed.
  assert(
    `total commits >= 6 (got ${cp.total})`,
    cp.total >= 6,
  );

  // Judgement file exists + validates
  const jv = checkJudgementValidity(worktree, `run-test-code_quality_review_round1_pass-1`);
  assert(`judgement files validate (${jv.details.join(", ")})`, jv.ok);

  // Snapshot persistence check
  const snapPath = join(
    worktree,
    ".pdh-flow",
    "runs",
    "run-test-code_quality_review_round1_pass-1",
    "snapshot.json",
  );
  assert("snapshot.json saved during run", existsSync(snapPath));
  if (existsSync(snapPath)) {
    const snap = JSON.parse(readFileSync(snapPath, "utf8"));
    const snapValid = getValidator().validate(SCHEMA_IDS.snapshot, snap);
    assert(
      "snapshot.json validates against schema",
      snapValid.ok === true,
      snapValid.ok === false ? formatErrors(snapValid.errors) : undefined,
    );
  }

  // Idempotency: re-running engine with same fixture → reads frozen judgement,
  // doesn't re-decide. We can't easily prove "no LLM call" in the fake actor,
  // but we can confirm second run's lastGuardianDecision still == pass and
  // exit cleanly without errors.
  const second = await runEngine({
    repoPath: REPO,
    flowId: meta.flow_id,
    variant: meta.variant,
    worktreePath: worktree,
    runId: `run-test-code_quality_review_round1_pass-1`, // same runId → frozen judgement
    fixtureMeta: meta,
    startAtNodeId: meta.starting_node,
    stopAtNodeId: meta.expected_terminal_node,
    timeoutMs: 30_000,
  });
  assert(
    "second run with same runId reaches same stop point",
    second.stoppedAt === meta.expected_terminal_node,
  );
  assert(
    "second run reports restoredFromSnapshot=true",
    second.restoredFromSnapshot === true,
  );
}

// ─── Scenario 2: repair_then_pass ────────────────────────────────────────
section("scenario: code_quality_review_repair_then_pass");
{
  const { worktree, meta, result } = await runScenario(
    "code_quality_review_repair_then_pass",
    "1",
  );

  assert(
    `engine reaches stop point at ${meta.expected_terminal_node}`,
    result.stoppedAt === meta.expected_terminal_node,
    `stoppedAt=${result.stoppedAt}, finalState=${result.finalState}`,
  );

  assert("round counter == 2 (one repair loop)", result.context.round === 2);
  assert(
    "lastGuardianDecision == pass",
    result.context.lastGuardianDecision === "pass",
  );

  const cp = checkCommitPatterns(worktree, meta.expected_commits);
  assert(
    `expected commit subjects all present (got ${cp.total} commits, missing ${cp.missing.length})`,
    cp.ok,
    cp.missing.length > 0 ? "missing patterns: " + cp.missing.join("; ") : undefined,
  );
  // 13 expected commits + 1 init seed
  assert(
    `total commits >= 13 (got ${cp.total})`,
    cp.total >= 13,
  );

  const jv = checkJudgementValidity(worktree, `run-test-code_quality_review_repair_then_pass-1`);
  assert(`judgement files validate (${jv.details.join(", ")})`, jv.ok);

  // 2 frozen judgements (round 1 + round 2 aggregate)
  const judgementFiles = readdirSync(
    join(worktree, ".pdh-flow", "runs", `run-test-code_quality_review_repair_then_pass-1`, "judgements"),
  );
  assert(
    `2 frozen judgements (got ${judgementFiles.length}: ${judgementFiles.join(", ")})`,
    judgementFiles.length === 2,
  );
}

// ─── Scenario 3: gate_system_happy ───────────────────────────────────────
section("scenario: gate_system_happy");
{
  const { worktree, meta, result } = await runScenario(
    "gate_system_happy",
    "1",
  );

  assert(
    `engine reaches expected_terminal_node=${meta.expected_terminal_node}`,
    result.finalState.includes(meta.expected_terminal_node) ||
      result.context.lastGuardianDecision === "gate_approved",
    `finalState=${result.finalState}, lastGuardianDecision=${result.context.lastGuardianDecision}`,
  );

  // Gate decision file should be persisted (audit symmetry).
  const gateFile = join(
    worktree,
    ".pdh-flow",
    "runs",
    "run-test-gate_system_happy-1",
    "gates",
    "review_gate.json",
  );
  assert("gate decision file persisted", existsSync(gateFile));
  if (existsSync(gateFile)) {
    const decision = JSON.parse(readFileSync(gateFile, "utf8"));
    assert(
      `gate decision=approved (got ${decision.decision})`,
      decision.decision === "approved",
    );
  }

  // close_ticket marker file.
  const closedMarker = join(
    worktree,
    ".pdh-flow",
    "runs",
    "run-test-gate_system_happy-1",
    "closed.json",
  );
  assert("close_ticket marker written", existsSync(closedMarker));
}

// ─── Lease integration (unit-style, exercises the system_step actor's
//     dependencies without spinning up the full engine) ────────────────────
section("lease integration (acquire / release)");
{
  const { acquireForTicket, releaseForTicket } = await import(
    "../src/engine/leases/leases.ts"
  );
  const { writeEnvLease, removeEnvLease, envLeasePath } = await import(
    "../src/engine/leases/env-lease.ts"
  );
  const { writeFileSync, existsSync, readFileSync } = await import("node:fs");

  const repo = mkdtempSync(join(tmpdir(), "pdh-lease-test-"));
  cleanup.push(repo);

  spawnSync("git", ["init", "-q"], { cwd: repo });
  // Write a minimal lease config.
  writeFileSync(
    join(repo, "pdh-flow.config.yaml"),
    `version: 1
leases:
  pools:
    port:
      kind: port
      range: [5170, 5172]
      env: PORT
    db-name:
      kind: name
      template: "pdh_{slug-hash}"
      env: DB_NAME
`,
  );

  const ticketId = "260508-001234-test-lease";
  const acquired = await acquireForTicket({
    mainRepo: repo,
    ticketId,
    worktree: repo,
  });
  assert(
    `acquired 2 leases (got ${acquired.leases.length})`,
    acquired.leases.length === 2,
  );
  const port = acquired.leases.find((l: any) => l.pool === "port");
  assert(
    `port allocated in range (${port?.value})`,
    typeof port?.value === "number" && port.value >= 5170 && port.value <= 5172,
  );
  const dbName = acquired.leases.find((l: any) => l.pool === "db-name");
  assert(
    `db-name allocated as pdh_<hash> (${dbName?.value})`,
    typeof dbName?.value === "string" && /^pdh_[0-9a-f]{8}$/.test(dbName.value),
  );

  // .env.lease write
  writeEnvLease(repo, acquired.leases);
  const envPath = envLeasePath(repo);
  assert(".env.lease written", existsSync(envPath));
  if (existsSync(envPath)) {
    const text = readFileSync(envPath, "utf8");
    assert(".env.lease has PORT=", /^PORT=\d+$/m.test(text));
    assert(".env.lease has DB_NAME=", /^DB_NAME=pdh_[0-9a-f]{8}$/m.test(text));
  }

  // Release
  const released = await releaseForTicket({ mainRepo: repo, ticketId });
  assert(
    `released 2 leases (got ${released.released.length})`,
    released.released.length === 2,
  );
  removeEnvLease(repo);
  assert(".env.lease removed", !existsSync(envPath));

  // Re-acquire should succeed (port reusable after release)
  const reacquired = await acquireForTicket({
    mainRepo: repo,
    ticketId: "260508-001235-test-lease-2",
    worktree: repo,
  });
  assert(
    `reacquire 2 leases (got ${reacquired.leases.length})`,
    reacquired.leases.length === 2,
  );
  await releaseForTicket({
    mainRepo: repo,
    ticketId: "260508-001235-test-lease-2",
  });
}

// ─── Cleanup ─────────────────────────────────────────────────────────────
for (const dir of cleanup) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
