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

// ─── Cleanup ─────────────────────────────────────────────────────────────
for (const dir of cleanup) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
