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
  const lines: string[] = [];
  lines.push(
    `You are picking up a ticket. Node: ${p.nodeId}, role=assist.`,
  );
  lines.push("");
  lines.push(
    "Read current-ticket.md to understand the ticket. Then write a concise Status section describing:",
  );
  lines.push("  - What this ticket is asking for");
  lines.push("  - Initial assumptions about scope");
  lines.push("  - What you'll investigate next");
  lines.push("");
  lines.push(
    "Do not edit source code. Use Read tools to inspect the repo. Your output will be appended to current-note.md as a section by the engine.",
  );
  lines.push("");
  if (p.promptSpec.intent) {
    lines.push(`Author intent: ${p.promptSpec.intent}`);
  }
  return lines.join("\n");
}

function buildPlannerPrompt(p: PromptBuilderInput): string {
  const lines: string[] = [];
  lines.push(
    `You are the planner for this ticket. Node: ${p.nodeId} (round ${p.round}).`,
  );
  lines.push("");
  lines.push(
    "Read current-ticket.md, current-note.md (especially the assist section), and the source tree to understand:",
  );
  lines.push("  - Existing implementation");
  lines.push("  - Blast radius of the requested change");
  lines.push("  - Dependencies and constraints");
  lines.push("");
  lines.push("Then produce a concrete implementation plan covering:");
  lines.push("  - Files to be modified (path + summary)");
  lines.push("  - Test strategy (which tests to add or update)");
  lines.push("  - Risks + mitigations");
  lines.push("");
  if (p.promptSpec.checkpoints && p.promptSpec.checkpoints.length > 0) {
    lines.push("Required checkpoints:");
    for (const c of p.promptSpec.checkpoints) lines.push(`  - ${c}`);
    lines.push("");
  }
  lines.push(
    "Do not edit source code. Use Read tools. Your output will be appended to current-note.md as a plan section.",
  );
  return lines.join("\n");
}

function buildImplementerPrompt(p: PromptBuilderInput): string {
  const isRepair =
    p.role.toLowerCase().includes("repair") ||
    p.nodeId.toLowerCase().includes("repair");
  const lines: string[] = [];
  if (isRepair) {
    lines.push(
      `You are repairing the implementation. Node: ${p.nodeId} (round ${p.round}).`,
    );
    lines.push("");
    lines.push(
      "Read current-note.md to understand: (1) the prior implementation, (2) the blocking findings raised by the most recent aggregate. Apply minimal, focused edits to address those findings.",
    );
  } else {
    lines.push(
      `You are the implementer. Node: ${p.nodeId} (round ${p.round}).`,
    );
    lines.push("");
    lines.push(
      "Read current-ticket.md (acceptance criteria), current-note.md (the plan), and the source tree. Implement the change according to the plan.",
    );
  }
  lines.push("");
  lines.push("Required behaviour:");
  lines.push("  - Use Edit / Write / Bash tools to modify files.");
  lines.push("  - Add or update tests so the AC is verified by automation.");
  lines.push(
    "  - When done, summarise what you changed in 5-10 lines (will be committed as the node's evidence section).",
  );
  if (p.promptSpec.checkpoints && p.promptSpec.checkpoints.length > 0) {
    lines.push("");
    lines.push("Checkpoints:");
    for (const c of p.promptSpec.checkpoints) lines.push(`  - ${c}`);
  }
  lines.push("");
  lines.push(
    "Do NOT run `git commit` or any git history-mutating command. The runtime owns commits — leave changes in the working tree.",
  );
  return lines.join("\n");
}

function buildReviewerPrompt(p: PromptBuilderInput): string {
  const lines: string[] = [];
  lines.push(`You are a ${p.role} reviewer. Node: ${p.nodeId} (round ${p.round}).`);
  lines.push("");
  if (p.promptSpec.intent) {
    lines.push(`Goal: ${p.promptSpec.intent}`);
  } else {
    lines.push("Goal: review the implementation in this repository.");
  }
  lines.push("");
  lines.push(
    "Read the relevant files (current-ticket.md, current-note.md, and the source tree) to understand what was implemented in the most recent commits.",
  );
  if (p.promptSpec.checkpoints && p.promptSpec.checkpoints.length > 0) {
    lines.push("");
    lines.push("Focus areas:");
    for (const c of p.promptSpec.checkpoints) lines.push(`  - ${c}`);
  }
  lines.push("");
  lines.push("Output requirements:");
  lines.push("  1. Produce a concise review (markdown is fine, ~10-30 lines).");
  lines.push("  2. Cite file:line where relevant.");
  lines.push("  3. End with one of these verdict lines exactly:");
  lines.push("       VERDICT: No Critical/Major");
  lines.push("       VERDICT: Critical");
  lines.push("       VERDICT: Major");
  lines.push("");
  lines.push("Do not edit or create any files. Use only Read tools.");
  return lines.join("\n");
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
