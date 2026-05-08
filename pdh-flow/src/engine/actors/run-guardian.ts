// Guardian step actor — dual-mode (fixture / real), with idempotent
// judgement freeze.
//
// 1. If a frozen judgement file already exists for (nodeId, round), read
//    it and skip everything (re-spawn safety).
// 2. Else, fetch the guardian output:
//    - fixture mode: read from `fixtureMeta.node_outputs[nodeId][round-N].guardian_output`
//    - real mode: invoke claude/codex with --json-schema = guardian-output schema,
//      parse the structured response.
// 3. Validate against guardian-output.schema.json (Ajv).
// 4. Semantic validation (round echo, evidence_consumed coverage).
// 5. Append note section + commit.
// 6. Freeze the wrapped judgement to disk for idempotency.

import { fromPromise } from "xstate";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import {
  getValidator,
  GuardianViolation,
  SCHEMA_IDS,
  formatErrors,
} from "../validate.ts";
import type {
  GuardianOutput,
  FrozenJudgement,
} from "../../types/index.ts";
import type { FixtureMeta } from "./run-provider.ts";
import { invokeProvider, type ProviderName } from "../providers/index.ts";
import {
  detectJudgeConfig,
  invokeApiJudge,
  type JudgeProviderConfig,
} from "../judge/api-judge.ts";
import { renderPrompt } from "../prompts/render.ts";
import { assertTicketUnmodified, hashTicket } from "../ticket-guard.ts";

export interface GuardianActorInput {
  nodeId: string;
  round: number;
  worktreePath: string;
  runId: string;
  /** Reviewer node ids whose output the guardian was supposed to read. */
  expectedEvidenceNodes: string[];
  /** Optional fixture replay payload (else real provider runs). */
  fixtureMeta?: FixtureMeta;
  /** Real-mode config from the flow node. */
  provider?: ProviderName;
  role?: string;
  maxRounds?: number;
}

export interface GuardianActorOutput {
  status: "completed";
  nodeId: string;
  round: number;
  decision: GuardianOutput["decision"];
  guardianOutput: GuardianOutput;
  commitSha: string;
  fromCache: boolean;
  fromFixture: boolean;
}

export const runGuardian = fromPromise<
  GuardianActorOutput,
  GuardianActorInput
>(async ({ input, signal }) => {
  const { nodeId, round, worktreePath, runId, expectedEvidenceNodes } = input;
  const roundKey = `round-${round}`;
  const judgementsDir = join(
    worktreePath,
    ".pdh-flow",
    "runs",
    runId,
    "judgements",
  );
  const judgementPath = join(judgementsDir, `${nodeId}__${roundKey}.json`);

  // ── Idempotency: cached judgement ────────────────────────────────────
  if (existsSync(judgementPath)) {
    const cached: FrozenJudgement = JSON.parse(
      readFileSync(judgementPath, "utf8"),
    );
    return {
      status: "completed",
      nodeId,
      round,
      decision: cached.guardian_output.decision,
      guardianOutput: cached.guardian_output as GuardianOutput,
      commitSha: cached.commit_sha ?? "",
      fromCache: true,
      fromFixture: false,
    };
  }

  // F-011/H10-5: capture ticket file hash before any guardian work so
  // we can detect unauthorized writes. Aggregators (.aggregate) ARE
  // permitted to edit the ticket (Out of scope, H10-6); other guardians
  // (e.g. final_verification) are NOT.
  const ticketPreHash = hashTicket(worktreePath);

  // ── Source guardian output ───────────────────────────────────────────
  const fixtureEntry = input.fixtureMeta?.node_outputs?.[nodeId]?.[roundKey];
  const fixtureGuardian = fixtureEntry?.guardian_output as GuardianOutput | undefined;
  let guardianOutput: GuardianOutput;
  let noteSectionFromFixture: string | undefined;
  let fromFixture: boolean;

  if (fixtureGuardian) {
    guardianOutput = fixtureGuardian;
    noteSectionFromFixture = fixtureEntry?.note_section;
    fromFixture = true;
  } else {
    if (!input.provider) {
      throw new Error(
        `guardian actor: no fixture for ${nodeId} ${roundKey} and no real provider configured`,
      );
    }
    guardianOutput = await invokeRealGuardian({
      provider: input.provider,
      role: input.role ?? "aggregator",
      nodeId,
      round,
      worktreePath,
      expectedEvidenceNodes,
      maxRounds: input.maxRounds ?? 1,
      signal,
    });
    fromFixture = false;
  }

  // ── Schema validation ────────────────────────────────────────────────
  const v = getValidator();
  const validated = v.validate<GuardianOutput>(
    SCHEMA_IDS.guardianOutput,
    guardianOutput,
  );
  if (validated.ok === false) {
    throw new GuardianViolation(
      `guardian schema violation for ${nodeId} ${roundKey}:\n${formatErrors(validated.errors)}`,
    );
  }

  // ── Semantic validation ──────────────────────────────────────────────
  if (validated.data.round !== round) {
    throw new GuardianViolation(
      `round echo mismatch for ${nodeId}: expected ${round}, got ${validated.data.round}`,
    );
  }
  const consumed = new Set(validated.data.evidence_consumed);
  const missing = expectedEvidenceNodes.filter((id) => !consumed.has(id));
  if (missing.length > 0) {
    throw new GuardianViolation(
      `${nodeId}: guardian did not consume reviewer outputs: ${missing.join(", ")}`,
    );
  }

  // F-011/H10-5: only aggregator guardian nodes (.aggregate) may have
  // touched the ticket file (Out of scope writes). Non-aggregator
  // guardians (e.g. final_verification) are read-only with respect to
  // the ticket.
  assertTicketUnmodified({
    worktreePath,
    preHash: ticketPreHash,
    actor: { kind: "guardian", nodeId, role: input.role },
  });

  // ── Append note + commit ────────────────────────────────────────────
  ensureGit(worktreePath);
  const noteBody = noteSectionFromFixture
    ? noteSectionFromFixture
    : renderGuardianNote(nodeId, round, validated.data);
  appendFileSync(
    join(worktreePath, "current-note.md"),
    "\n" + noteBody + "\n",
  );
  run("git", ["add", "-A"], worktreePath);
  const subject = `[${nodeId}/${roundKey}] ${validated.data.summary}`;
  const commitResult = run(
    "git",
    [
      "-c",
      "user.email=engine@pdh-flow.local",
      "-c",
      "user.name=pdh-flow-engine",
      "commit",
      "-m",
      subject,
      "--allow-empty",
    ],
    worktreePath,
  );
  if (commitResult.status !== 0) {
    throw new Error(
      `guardian actor: git commit failed: ${commitResult.stderr}`,
    );
  }
  const sha = run("git", ["rev-parse", "HEAD"], worktreePath).stdout.trim();

  // ── Freeze ───────────────────────────────────────────────────────────
  mkdirSync(judgementsDir, { recursive: true });
  const frozen: FrozenJudgement = {
    version: 1,
    guardian_output: validated.data,
    frozen_at: new Date().toISOString(),
    frozen_by_run_id: runId,
    frozen_by_node_id: nodeId,
    round,
    commit_sha: sha,
  };
  v.validateOrThrow<FrozenJudgement>(SCHEMA_IDS.judgement, frozen);
  writeFileSync(judgementPath, JSON.stringify(frozen, null, 2));

  return {
    status: "completed",
    nodeId,
    round,
    decision: validated.data.decision,
    guardianOutput: validated.data,
    commitSha: sha,
    fromCache: false,
    fromFixture,
  };
});

async function invokeRealGuardian(p: {
  provider: ProviderName;
  role: string;
  nodeId: string;
  round: number;
  worktreePath: string;
  expectedEvidenceNodes: string[];
  maxRounds: number;
  signal?: AbortSignal;
}): Promise<GuardianOutput> {
  // Prefer API direct (deterministic structured output via tool_use /
  // response_format) over CLI subprocess for judges. CLI's --json-schema is
  // best-effort in `-p` agentic mode and observed to drop structured_output,
  // emit YAML, or wrap JSON in code fences. Empirically unusable for the
  // engine's "decision is the routing key" contract.
  const apiCfg = detectJudgeConfig();
  if (apiCfg) {
    return invokeApiGuardian(p, apiCfg);
  }
  return invokeCliGuardian(p);
}

async function invokeApiGuardian(
  p: {
    role: string;
    nodeId: string;
    round: number;
    worktreePath: string;
    expectedEvidenceNodes: string[];
    maxRounds: number;
    signal?: AbortSignal;
  },
  cfg: JudgeProviderConfig,
): Promise<GuardianOutput> {
  // API has no file tools — inline the artefacts into the prompt.
  const ticketPath = join(p.worktreePath, "current-ticket.md");
  const notePath = join(p.worktreePath, "current-note.md");
  const ticket = existsSync(ticketPath) ? readFileSync(ticketPath, "utf8") : "(no ticket)";
  const note = existsSync(notePath) ? readFileSync(notePath, "utf8") : "(no note)";

  const prompt = buildApiGuardianPrompt(p, ticket, note);
  const schema = guardianOutputSchema(p.expectedEvidenceNodes, p.round);

  const res = await invokeApiJudge(cfg, {
    prompt,
    schema,
    signal: p.signal,
  });
  process.stderr.write(
    `[guardian] api ${cfg.provider}/${cfg.model} ${p.nodeId} round-${p.round} ok ` +
      `(tokens=${res.usage?.totalTokens ?? "?"})\n`,
  );
  return res.object as GuardianOutput;
}

async function invokeCliGuardian(p: {
  provider: ProviderName;
  role: string;
  nodeId: string;
  round: number;
  worktreePath: string;
  expectedEvidenceNodes: string[];
  maxRounds: number;
  signal?: AbortSignal;
}): Promise<GuardianOutput> {
  const prompt = buildGuardianPrompt(p);
  const schema = guardianOutputSchema(p.expectedEvidenceNodes, p.round);
  const result = await invokeProvider(p.provider, {
    prompt,
    cwd: p.worktreePath,
    jsonSchema: schema,
    signal: p.signal,
    // Guardians are read-only by prompt contract, but they need to invoke
    // Read/Grep/Glob tools without approval prompts. Without bypass, claude
    // in headless `-p` mode can silently fail tool calls and return an
    // envelope with no structured_output.
    editable: true,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    process.stderr.write(
      `[guardian] ${p.provider} stderr tail:\n${result.stderrTail}\n`,
    );
    throw new Error(
      `${p.provider} guardian ${p.nodeId} round-${p.round} failed (exit=${result.exitCode}, timedOut=${result.timedOut}): ${result.stderrTail.slice(-500)}`,
    );
  }
  if (!result.jsonOutput) {
    process.stderr.write(
      `[guardian] ${p.provider} returned non-JSON output (exit=${result.exitCode}). text head:\n${result.text.slice(0, 1500)}\nstderr tail:\n${result.stderrTail.slice(-500)}\n`,
    );
    throw new Error(
      `${p.provider} guardian ${p.nodeId} round-${p.round} produced no parsable JSON output`,
    );
  }
  return result.jsonOutput as GuardianOutput;
}

function buildApiGuardianPrompt(
  p: {
    role: string;
    nodeId: string;
    round: number;
    expectedEvidenceNodes: string[];
    maxRounds: number;
  },
  ticket: string,
  note: string,
): string {
  return renderPrompt("guardian-api", {
    role: p.role,
    nodeId: p.nodeId,
    round: p.round,
    maxRounds: p.maxRounds,
    expectedEvidenceNodes: p.expectedEvidenceNodes,
    ticket,
    note,
  });
}

function buildGuardianPrompt(p: {
  role: string;
  nodeId: string;
  round: number;
  expectedEvidenceNodes: string[];
  maxRounds: number;
}): string {
  return renderPrompt("guardian-cli", {
    role: p.role,
    nodeId: p.nodeId,
    round: p.round,
    maxRounds: p.maxRounds,
    expectedEvidenceNodes: p.expectedEvidenceNodes,
  });
}

function guardianOutputSchema(
  expectedEvidence: string[],
  round: number,
): Record<string, unknown> {
  // Slimmed-down version of guardian-output.schema.json embedded inline so
  // the provider CLI's --json-schema flag can enforce shape. We don't pass
  // the full $ref-chained schema (cross-file refs would fail in the CLI).
  // Anywhere we expect a NodeId we constrain via `enum` to the known
  // reviewer ids — otherwise the LLM produces strings (markdown headers,
  // capitalised role names) that pass slim CLI validation but fail the full
  // NodeId-pattern check on the engine side.
  const findingSchema = {
    type: "object",
    additionalProperties: false,
    required: ["severity", "title", "evidence_ref"],
    properties: {
      severity: { type: "string", enum: ["critical", "major", "minor"] },
      title: { type: "string", minLength: 1, maxLength: 120 },
      detail: { type: "string", maxLength: 2000 },
      evidence_ref: { type: "string", minLength: 1, maxLength: 500 },
      raised_by: { type: "string", enum: expectedEvidence },
      recommended_action: {
        type: "string",
        enum: ["fix_now", "defer_to_followup_ticket", "ignore"],
      },
    },
  } as const;

  return {
    type: "object",
    additionalProperties: false,
    required: ["decision", "summary", "reasoning", "round", "evidence_consumed"],
    properties: {
      decision: {
        type: "string",
        enum: ["pass", "repair_needed", "abort", "escalate_human"],
      },
      summary: { type: "string", minLength: 1, maxLength: 280 },
      reasoning: { type: "string", minLength: 10, maxLength: 8000 },
      round: { const: round },
      evidence_consumed: {
        type: "array",
        uniqueItems: true,
        minItems: expectedEvidence.length,
        items: { type: "string", enum: expectedEvidence },
      },
      blocking_findings: {
        type: "array",
        items: findingSchema,
      },
      non_blocking_findings: {
        type: "array",
        items: findingSchema,
      },
      next_target_override: { type: "string" },
    },
  };
}

function renderGuardianNote(
  nodeId: string,
  round: number,
  out: GuardianOutput,
): string {
  const lines: string[] = [];
  lines.push(`## ${nodeId} (round ${round})`);
  lines.push("");
  lines.push(`**Decision**: ${out.decision}`);
  lines.push("");
  lines.push(`Summary: ${out.summary}`);
  lines.push("");
  lines.push("Reasoning:");
  lines.push(out.reasoning);
  if (out.blocking_findings && out.blocking_findings.length > 0) {
    lines.push("");
    lines.push("Blocking findings:");
    for (const f of out.blocking_findings) {
      lines.push(
        `- [${f.severity}] ${f.title} (${f.evidence_ref})${f.raised_by ? " — raised by " + f.raised_by : ""}`,
      );
    }
  }
  return lines.join("\n");
}

function run(cmd: string, args: string[], cwd: string): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function ensureGit(worktreePath: string): void {
  if (!existsSync(join(worktreePath, ".git"))) {
    throw new Error(`worktree is not a git repo: ${worktreePath}`);
  }
}
