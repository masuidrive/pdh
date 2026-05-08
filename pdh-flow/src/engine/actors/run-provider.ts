// Provider step actor — dual-mode (fixture / real).
//
// When `fixtureMeta.node_outputs[nodeId][round-N]` is present, replays the
// recorded note_section + files (used by the test harness). Otherwise the
// actor invokes the real claude/codex CLI: it builds a prompt from
// `promptSpec` + `role` + flow context, captures the assistant's text
// response, appends it to current-note.md as a section keyed by nodeId,
// and commits.

import { fromPromise } from "xstate";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { invokeProvider, type ProviderName } from "../providers/index.ts";
import { renderPrompt } from "../prompts/render.ts";
import {
  readProviderSession,
  saveProviderSession,
} from "../session-store.ts";
import { assertTicketUnmodified, hashTicket } from "../ticket-guard.ts";
import {
  awaitTurnAnswer,
  clearTurnsDir,
  writeTurnAnswer,
  writeTurnQuestion,
} from "../turn-store.ts";
import { getValidator, SCHEMA_IDS } from "../validate.ts";
import type {
  ProviderStepOutputEnvelope,
  TurnAsk,
  TurnFinal,
} from "../../types/index.ts";

export interface ProviderActorInput {
  nodeId: string;
  round: number;
  worktreePath: string;
  /** Real-mode config from the flow node. */
  provider?: ProviderName;
  role?: string;
  promptSpec?: {
    intent?: string;
    note_section?: string;
    commit_summary?: string;
    checkpoints?: string[];
    [k: string]: unknown;
  };
  /** When set, fixture mode replays this. Otherwise real provider runs. */
  fixtureMeta?: FixtureMeta;
  /** Engine run id; required for saving provider session ids (F-001). */
  runId?: string;
  /**
   * F-001/J4: when set, the actor looks up
   * `runs/<runId>/sessions/<resumeSessionFrom>.json` and, on hit, invokes
   * the provider with --resume so it continues that prior session. On
   * miss, falls back to a fresh invocation with the configured prompt.
   * Populated by the macro expander when review_loop.repair.via=resume.
   */
  resumeSessionFrom?: string;
  /**
   * F-012: opt-in to the in-step turn loop. When true, the actor runs
   * a turn loop where the provider may emit a `request_human_input`
   * envelope instead of a final answer; the engine writes a
   * `turn-NNN-question.json`, polls for the matching answer file, and
   * resumes the provider session with the answer text.
   */
  enableUserInput?: boolean;
}

export interface ProviderActorOutput {
  status: "completed" | "failed";
  nodeId: string;
  round: number;
  summary: string;
  commitSha: string;
  /** True if fixture-replayed; false if real LLM. */
  fromFixture: boolean;
}

export interface FixtureMeta {
  scenario: string;
  node_outputs?: Record<
    string,
    Record<
      string,
      {
        note_section?: string;
        summary?: string;
        guardian_output?: unknown;
        files?: Record<string, string>;
        /**
         * F-012/K3-mini: pre-recorded in-step turns. When present, the
         * fixture replay writes turn-NNN-question.json and
         * turn-NNN-answer.json under runs/<runId>/turns/<nodeId>/ in
         * lockstep, then proceeds to apply note_section / files /
         * summary as the final outcome. Lets a fixture exercise the
         * F-012 turn-file machinery without invoking a real provider.
         */
        turns?: Array<{ question: string; answer: string }>;
      }
    >
  >;
}

export const runProvider = fromPromise<
  ProviderActorOutput,
  ProviderActorInput
>(async ({ input, signal }) => {
  const { nodeId, round, worktreePath } = input;
  const roundKey = `round-${round}`;
  const nodeFixture =
    input.fixtureMeta?.node_outputs?.[nodeId]?.[roundKey];

  ensureGit(worktreePath);

  // F-011/H10-5: capture ticket file hash before provider/fixture work
  // so we can reject any actor that tries to edit it without authorization.
  const ticketPreHash = hashTicket(worktreePath);

  let summary: string;
  let noteSection: string;

  if (nodeFixture) {
    // ── Fixture replay ─────────────────────────────────────────────────
    // F-012/K3-mini: when the fixture declares `turns`, the replay
    // mimics the in-step Q/A loop by writing question + answer files in
    // lockstep. The note-section / files / summary then carry the
    // *final* outcome as a normal fixture entry.
    if (nodeFixture.turns && nodeFixture.turns.length > 0 && input.runId) {
      const now = new Date().toISOString();
      let turnIdx = 0;
      for (const t of nodeFixture.turns) {
        turnIdx += 1;
        writeTurnQuestion({
          worktreePath,
          runId: input.runId,
          question: {
            status: "pending",
            node_id: nodeId,
            round,
            turn: turnIdx,
            asked_at: now,
            ask: { question: t.question },
          },
        });
        writeTurnAnswer({
          worktreePath,
          runId: input.runId,
          answer: {
            status: "completed",
            node_id: nodeId,
            round,
            turn: turnIdx,
            answered_at: now,
            answer: { text: t.answer },
            via: "cli",
          },
        });
      }
    }

    summary = nodeFixture.summary ?? `${nodeId} ${roundKey}`;
    noteSection = nodeFixture.note_section ?? "";

    // Apply file overrides (e.g. repair patches a source file).
    if (nodeFixture.files) {
      for (const [relPath, content] of Object.entries(nodeFixture.files)) {
        const full = join(worktreePath, relPath);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
    }
  } else if (input.enableUserInput) {
    // ── F-012/K2: real-mode in-step turn loop ─────────────────────────
    if (!input.provider) {
      throw new Error(
        `provider actor: enable_user_input requires real provider (no fixture for ${nodeId} ${roundKey})`,
      );
    }
    if (!input.runId) {
      throw new Error(
        `provider actor: enable_user_input requires runId (cannot persist turn files without it)`,
      );
    }
    const result = await runTurnLoop({
      input,
      signal,
      worktreePath,
      ticketPreHash,
    });
    summary = result.summary;
    noteSection = result.noteSection;
  } else {
    // ── Real provider invocation ───────────────────────────────────────
    if (!input.provider) {
      throw new Error(
        `provider actor: no fixture for ${nodeId} ${roundKey} and no real provider configured`,
      );
    }
    const prompt = buildPromptForProvider({
      nodeId,
      round,
      role: input.role ?? "reviewer",
      promptSpec: input.promptSpec ?? {},
    });
    const editable = roleNeedsEdit(input.role ?? "reviewer", nodeId);
    // F-001/J4: if this node is configured to resume an upstream node's
    // session, look it up and pass --resume to the provider. On miss we
    // silently fall back to a fresh invocation; on a CLI rejection we
    // surface the error (caller can decide whether to retry).
    let resumeSessionId: string | undefined;
    if (input.resumeSessionFrom && input.runId) {
      const rec = readProviderSession({
        worktreePath,
        runId: input.runId,
        nodeId: input.resumeSessionFrom,
      });
      if (rec && rec.provider === input.provider) {
        resumeSessionId = rec.sessionId;
      } else if (rec && rec.provider !== input.provider) {
        process.stderr.write(
          `[run-provider] ${nodeId}: cannot resume — recorded session for ${input.resumeSessionFrom} is provider=${rec.provider}, but this node is provider=${input.provider}. Falling back to fresh.\n`,
        );
      }
    }
    const result = await invokeProvider(input.provider, {
      prompt,
      cwd: worktreePath,
      signal,
      editable,
      ...(resumeSessionId ? { resumeSessionId } : {}),
    });
    if (result.exitCode !== 0 || result.timedOut) {
      throw new Error(
        `${input.provider} ${nodeId} ${roundKey} failed (exit=${result.exitCode}, timedOut=${result.timedOut}): ${result.stderrTail.slice(-500)}`,
      );
    }
    const text = result.text.trim();
    if (text.length === 0) {
      throw new Error(
        `${input.provider} ${nodeId} ${roundKey} produced empty output`,
      );
    }
    summary = extractSummary(text, `${nodeId} ${roundKey}`);
    noteSection = `## ${nodeId} (round ${round})\n\n${text}\n`;

    // F-001/J3: persist the provider session id (when the CLI surfaced
    // one) so a later node can `--resume` this conversation. Best-effort:
    // if runId is missing or the file write fails, the worst case is a
    // resume-configured downstream falls back to a fresh invocation.
    if (input.runId && result.sessionId) {
      try {
        saveProviderSession({
          worktreePath,
          runId: input.runId,
          nodeId,
          round,
          provider: input.provider,
          sessionId: result.sessionId,
        });
      } catch (e) {
        process.stderr.write(
          `[run-provider] failed to save session id for ${nodeId} ${roundKey}: ${(e as Error).message}\n`,
        );
      }
    }
  }

  // F-011/H10-5: providers (reviewer / implement / repair / assist /
  // planner) MUST NOT modify the ticket. Catch any LLM-tool-use slip
  // before we stage / commit so the violation surfaces clearly.
  assertTicketUnmodified({
    worktreePath,
    preHash: ticketPreHash,
    actor: { kind: "provider", nodeId, role: input.role },
  });

  // ── Append note + (maybe) commit ──────────────────────────────────────
  if (noteSection) {
    appendFileSync(
      join(worktreePath, "current-note.md"),
      "\n" + noteSection + "\n",
    );
  }
  run("git", ["add", "-A"], worktreePath);

  // F-011/H10-3: drop D-003. Reviewer nodes inside a review_loop
  // parallel_group only stage their note diff; the next aggregator
  // (or repair) commit picks them up. Net effect: a clean run produces
  // ~8 commits instead of ~16 — bisect granularity is preserved at
  // the meaningful-step level (assist / investigate_plan / plan_review
  // aggregate / plan_gate / implement / code_quality_review aggregate /
  // final_verification + close), and reviewer audit lives in the note's
  // section headers (which the aggregator commit folds in).
  const skipCommit = isReviewerInLoop(nodeId);
  let sha: string;
  if (skipCommit) {
    sha = run("git", ["rev-parse", "HEAD"], worktreePath).stdout.trim();
  } else {
    const subject = `[${nodeId}/${roundKey}] ${summary}`;
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
        `provider actor: git commit failed for ${nodeId} ${roundKey}: ${commitResult.stderr}`,
      );
    }
    sha = run("git", ["rev-parse", "HEAD"], worktreePath).stdout.trim();
  }

  return {
    status: "completed",
    nodeId,
    round,
    summary,
    commitSha: sha,
    fromFixture: !!nodeFixture,
  };
});

interface PromptBuilderInput {
  nodeId: string;
  round: number;
  role: string;
  promptSpec: { intent?: string; checkpoints?: string[]; note_section?: string };
}

/**
 * True when this provider_step is a reviewer member of a review_loop's
 * parallel_group. F-011/H10-3: such nodes stage their note diff instead
 * of producing their own commit; the aggregator's commit folds them in.
 *
 * Reviewer ids follow the macro-expanded pattern `<parent>.<role>_<i>`,
 * e.g. `plan_review.devils_advocate_1`. Aggregator (`.aggregate`) and
 * repair (`.repair`) deliberately don't match — they keep committing.
 */
function isReviewerInLoop(nodeId: string): boolean {
  return /\.[a-z][a-z0-9_]*_\d+$/.test(nodeId);
}

/** True when the role / node implies file edits (implementer + repair). */
function roleNeedsEdit(role: string, nodeId: string): boolean {
  const r = role.toLowerCase();
  if (
    r === "implementer" ||
    r === "implement" ||
    r === "repair" ||
    r.endsWith("_repair")
  ) return true;
  // Naming convention: any node id ending in `.repair` is a repair node.
  if (nodeId.toLowerCase().endsWith(".repair")) return true;
  return false;
}

/**
 * Role-driven prompt selection.
 *
 * Roles map to authoring patterns:
 *   - assist: pick up the ticket, write Status section. No code edits.
 *   - planner / investigate_plan: investigate + plan, write to note. No code edits.
 *   - implementer / repair: edit source + tests. Heavy tool use.
 *   - reviewer-style (devils_advocate / code_reviewer / critical / etc.): read + review,
 *     end with VERDICT line. No edits.
 *   - aggregator / final_verifier: handled by guardian actor (separate file).
 */
function buildPromptForProvider(p: PromptBuilderInput): string {
  const role = p.role.toLowerCase();
  if (role === "assist") return buildAssistPrompt(p);
  if (role === "planner" || role === "investigate" || role === "investigator") {
    return buildPlannerPrompt(p);
  }
  if (
    role === "implementer" ||
    role === "implement" ||
    role === "repair" ||
    role.endsWith("_repair")
  ) {
    return buildImplementerPrompt(p);
  }
  // F-012/K6: dedicated role for the turn-loop smoke. Its template is
  // explicit about asking exactly one clarifying question, which makes
  // the smoke deterministic enough to verify the loop without having
  // to coax a generic role into asking.
  if (role === "turn_smoke") {
    return renderPrompt("turn-smoke", {
      nodeId: p.nodeId,
      intent: p.promptSpec.intent,
    });
  }
  // Default: reviewer pattern (works for any review-shaped role).
  return buildReviewerPrompt(p);
}

function buildAssistPrompt(p: PromptBuilderInput): string {
  return renderPrompt("assist", {
    nodeId: p.nodeId,
    intent: p.promptSpec.intent,
  });
}

function buildPlannerPrompt(p: PromptBuilderInput): string {
  return renderPrompt("planner", {
    nodeId: p.nodeId,
    round: p.round,
    checkpoints: p.promptSpec.checkpoints ?? [],
  });
}

function implementerMode(role: string, nodeId: string): "plan_repair" | "code_repair" | "default" {
  const r = role.toLowerCase();
  const lc = nodeId.toLowerCase();
  // plan_review.repair: address findings against the PLAN artifact, not code.
  // The repair node loops back into plan_review, so source edits here would
  // jump ahead of the implement node and pollute the plan stage.
  if (r === "plan_repair" || (lc.startsWith("plan_review.") && lc.includes("repair"))) {
    return "plan_repair";
  }
  if (r.includes("repair") || lc.includes("repair")) return "code_repair";
  return "default";
}

function buildImplementerPrompt(p: PromptBuilderInput): string {
  return renderPrompt("implementer", {
    nodeId: p.nodeId,
    round: p.round,
    mode: implementerMode(p.role, p.nodeId),
    checkpoints: p.promptSpec.checkpoints ?? [],
  });
}

function buildReviewerPrompt(p: PromptBuilderInput): string {
  // Naming convention: any node id under `plan_review.*` is a plan reviewer
  // (reviews the plan artifact, not the source diff).
  const mode = p.nodeId.toLowerCase().startsWith("plan_review.")
    ? "plan"
    : "default";
  return renderPrompt("reviewer", {
    nodeId: p.nodeId,
    round: p.round,
    role: p.role,
    mode,
    intent: p.promptSpec.intent,
    checkpoints: p.promptSpec.checkpoints ?? [],
  });
}

function extractSummary(text: string, fallback: string): string {
  // Find the verdict line and use it as a summary; otherwise truncate the
  // first non-empty line.
  const verdictMatch = text.match(/VERDICT:\s*([^\n]+)/i);
  if (verdictMatch) return `Verdict: ${verdictMatch[1].trim()}`.slice(0, 280);
  const firstLine = text.split("\n").find((l) => l.trim().length > 0);
  if (firstLine) return firstLine.trim().slice(0, 280);
  return fallback;
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

// ─── F-012/K2: in-step turn loop helpers ─────────────────────────────────

const TURN_LOOP_MAX_TURNS = 10;

const ENVELOPE_INSTRUCTION = `

## Output format

Respond with a single JSON object matching this envelope:

\`\`\`
{ "kind": "final" | "ask",
  "final": { "summary": string, "details"?: string },
  "ask":   { "question": string, "options"?: [{ "label": string, "description"?: string }], "context"?: string } }
\`\`\`

- Use \`kind: "final"\` when you have everything you need. \`final.summary\` is one line; \`final.details\` is the full markdown body that goes into the note (no Q/A — that's logged separately).
- Use \`kind: "ask"\` only when a specific decision genuinely requires a human. The question must be answerable in one turn. Provide \`options\` when there's a small enumerable set of answers; otherwise omit and accept free-form text.
- Do NOT mix prose and JSON; the entire response is the JSON object.`;

function envelopeJsonSchema(): Record<string, unknown> {
  // Inline schema (no $refs) so the CLI's --json-schema / --output-schema
  // flag can accept it as a single payload. Mirrors
  // schemas/provider-step-output.schema.json but with $defs flattened.
  return {
    type: "object",
    additionalProperties: false,
    required: ["kind"],
    properties: {
      kind: { type: "string", enum: ["final", "ask"] },
      final: {
        type: "object",
        additionalProperties: false,
        required: ["summary"],
        properties: {
          summary: { type: "string", minLength: 1, maxLength: 280 },
          details: { type: "string", maxLength: 16000 },
        },
      },
      ask: {
        type: "object",
        additionalProperties: false,
        required: ["question"],
        properties: {
          question: { type: "string", minLength: 1, maxLength: 2000 },
          options: {
            type: "array",
            maxItems: 10,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label"],
              properties: {
                label: { type: "string", minLength: 1, maxLength: 200 },
                description: { type: "string", maxLength: 2000 },
              },
            },
          },
          context: { type: "string", maxLength: 4000 },
        },
      },
    },
  };
}

function parseEnvelope(
  text: string,
  jsonOutput: unknown,
): ProviderStepOutputEnvelope | null {
  // Schema-constrained CLI runs surface the parsed object directly; we
  // validate it with Ajv (defense in depth) and accept on hit.
  const v = getValidator();
  const tryAccept = (candidate: unknown) => {
    if (candidate === undefined || candidate === null) return null;
    const r = v.validate<ProviderStepOutputEnvelope>(
      SCHEMA_IDS.providerStepOutput,
      candidate,
    );
    return r.ok === true ? r.data : null;
  };
  const fromJson = tryAccept(jsonOutput);
  if (fromJson) return fromJson;
  // Fallback for resumed turns where the CLI couldn't enforce a schema:
  // try to parse the assistant text as JSON, optionally pulling out the
  // first {...} block when there's stray prose.
  if (!text) return null;
  const trimmed = text.trim();
  const candidates: unknown[] = [];
  try { candidates.push(JSON.parse(trimmed)); } catch { /* fall through */ }
  // Match a fenced block: ```json ... ``` or just first {...}.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { candidates.push(JSON.parse(fenced[1].trim())); } catch { /* */ }
  }
  const brace = trimmed.match(/\{[\s\S]*\}/);
  if (brace) {
    try { candidates.push(JSON.parse(brace[0])); } catch { /* */ }
  }
  for (const c of candidates) {
    const accepted = tryAccept(c);
    if (accepted) return accepted;
  }
  return null;
}

interface TurnLoopArgs {
  input: ProviderActorInput;
  signal: AbortSignal | undefined;
  worktreePath: string;
  ticketPreHash: string | null;
}

interface TurnLoopResult {
  summary: string;
  noteSection: string;
}

async function runTurnLoop(args: TurnLoopArgs): Promise<TurnLoopResult> {
  const { input, signal, worktreePath } = args;
  const { nodeId, round } = input;
  const runId = input.runId!;
  const provider = input.provider!;
  const role = input.role ?? "implementer";
  const editable = roleNeedsEdit(role, nodeId);
  const schema = envelopeJsonSchema();

  // Initial prompt = role prompt + envelope instruction.
  const basePrompt = buildPromptForProvider({
    nodeId,
    round,
    role,
    promptSpec: input.promptSpec ?? {},
  });
  let prompt = basePrompt + ENVELOPE_INSTRUCTION;
  let resumeSessionId: string | undefined;

  // Optional cross-step resume (F-001): when this node also has
  // resume_session_from set, start by resuming that node's session.
  if (input.resumeSessionFrom) {
    const rec = readProviderSession({
      worktreePath,
      runId,
      nodeId: input.resumeSessionFrom,
    });
    if (rec && rec.provider === provider) {
      resumeSessionId = rec.sessionId;
    }
  }

  let final: TurnFinal | null = null;
  const turnsLog: Array<{ ask: TurnAsk; answer: string }> = [];

  for (let turnIdx = 1; turnIdx <= TURN_LOOP_MAX_TURNS; turnIdx++) {
    if (signal?.aborted) {
      throw new Error(
        `[run-provider] aborted in turn loop for ${nodeId} round-${round} turn=${turnIdx}`,
      );
    }
    const isInitial = turnIdx === 1 && resumeSessionId === undefined;
    const result = await invokeProvider(provider, {
      prompt,
      cwd: worktreePath,
      signal,
      editable,
      // codex `exec resume` doesn't accept --output-schema, so only
      // attach the schema on the first un-resumed call. Subsequent
      // turns rely on the LLM remembering the envelope (with
      // graceful-fallback parsing if it doesn't).
      ...(isInitial ? { jsonSchema: schema } : {}),
      ...(resumeSessionId ? { resumeSessionId } : {}),
    });
    if (result.exitCode !== 0 || result.timedOut) {
      throw new Error(
        `${provider} ${nodeId} round-${round} turn=${turnIdx} failed (exit=${result.exitCode}, timedOut=${result.timedOut}): ${result.stderrTail.slice(-500)}`,
      );
    }

    // Update session id for this node (claude returns a new id per call;
    // codex returns a stable id — both are handled by overwrite).
    if (result.sessionId) {
      saveProviderSession({
        worktreePath,
        runId,
        nodeId,
        round,
        provider,
        sessionId: result.sessionId,
      });
      resumeSessionId = result.sessionId;
    }

    const envelope = parseEnvelope(result.text, result.jsonOutput);
    if (!envelope) {
      // Graceful degradation: treat the raw text as a final answer.
      const text = result.text.trim() || `(empty response from ${provider})`;
      final = {
        summary: extractSummary(text, `${nodeId} round-${round}`),
        details: text,
      };
      process.stderr.write(
        `[run-provider] turn=${turnIdx} ${provider} did not return envelope; treating raw output as final\n`,
      );
      break;
    }
    if (envelope.kind === "final" && envelope.final) {
      final = envelope.final;
      break;
    }
    if (envelope.kind === "ask" && envelope.ask) {
      writeTurnQuestion({
        worktreePath,
        runId,
        question: {
          status: "pending",
          node_id: nodeId,
          round,
          turn: turnIdx,
          asked_at: new Date().toISOString(),
          ...(resumeSessionId ? { session_id: resumeSessionId } : {}),
          ask: envelope.ask,
        },
      });
      const answer = await awaitTurnAnswer({
        worktreePath,
        runId,
        nodeId,
        turn: turnIdx,
        signal,
      });
      turnsLog.push({ ask: envelope.ask, answer: answer.answer.text });
      // Next loop: prompt is just the user answer; resumeSessionId is
      // already set so the provider continues the same conversation.
      prompt = answer.answer.text;
      continue;
    }
    // Envelope parsed but the kind/body combination is malformed.
    throw new Error(
      `${provider} ${nodeId} round-${round} turn=${turnIdx}: envelope parsed but missing matching body for kind=${envelope.kind}`,
    );
  }

  if (!final) {
    throw new Error(
      `[run-provider] ${nodeId} round-${round}: turn loop exceeded ${TURN_LOOP_MAX_TURNS} turns without a final answer`,
    );
  }

  // Build the note section: final body + any Q/A logs underneath. Keeps
  // the audit visible without bloating the commit (questions+answers
  // also persist under runs/.../turns/ during the step).
  const lines: string[] = [];
  lines.push(`## ${nodeId} (round ${round})`, "");
  if (final.details) {
    lines.push(final.details, "");
  } else {
    lines.push(final.summary, "");
  }
  for (let i = 0; i < turnsLog.length; i++) {
    const t = turnsLog[i];
    lines.push(`### Turn ${i + 1} — asked`, "", t.ask.question, "");
    lines.push(`**User answered:** ${t.answer}`, "");
  }

  // Cleanup turn files now that the step's outcome is durable in note.
  // Best-effort; the .pdh-flow/ tree is ephemeral anyway.
  clearTurnsDir({ worktreePath, runId, nodeId });

  return {
    summary: final.summary,
    noteSection: lines.join("\n"),
  };
}
