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

  let summary: string;
  let noteSection: string;

  if (nodeFixture) {
    // ── Fixture replay ─────────────────────────────────────────────────
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
    const result = await invokeProvider(input.provider, {
      prompt,
      cwd: worktreePath,
      signal,
      editable,
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
  }

  // ── Append note + commit (common to both modes) ────────────────────────
  if (noteSection) {
    appendFileSync(
      join(worktreePath, "current-note.md"),
      "\n" + noteSection + "\n",
    );
  }
  run("git", ["add", "-A"], worktreePath);
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
  const sha = run("git", ["rev-parse", "HEAD"], worktreePath).stdout.trim();

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
