// CLI commands for ticket lifecycle and run artifact maintenance.
import { resolve } from "node:path";
import { commitStep, ticketClose, ticketCloseDryRun, ticketStart } from "../runtime/actions.ts";
import { appendStepHistoryEntry } from "../repo/note.ts";
import {
  cleanupRunArtifacts,
  loadPdhMeta,
  loadRuntime,
  savePdhMeta
} from "../runtime/state.ts";
import { parseOptions, required } from "./utils.ts";

export function cmdCommitStep(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const ticket = options.ticket ?? loadPdhMeta(repo).ticket ?? null;
  const result = commitStep({ repoPath: repo, stepId: required(options, "step"), message: options.message ?? null, ticket });
  console.log(JSON.stringify(result, null, 2));
}

export function cmdTicketStart(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const result = ticketStart({ repoPath: repo, ticket: required(options, "ticket") });
  console.log(JSON.stringify(result, null, 2));
}

export function cmdTicketClose(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const result = ticketClose({ repoPath: repo });
  console.log(JSON.stringify(result, null, 2));
}

// Probe whether `ticket.sh close` would succeed without performing it.
// Surfaces collision / dirty-main / merge-conflict failures so an agent
// or user can repair the obstruction before approving the close gate.
export function cmdClosePreflight(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const args = options["keep-worktree"] === "false" ? [] : ["--keep-worktree"];
  const result = ticketCloseDryRun({ repoPath: repo, args });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

export function cmdCleanup(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const runtime = loadRuntime(repo, { normalizeStaleRunning: true });
  if (!runtime.run?.id) {
    throw new Error("No active run artifacts to clean up");
  }
  appendStepHistoryEntry(repo, {
    stepId: "CLEANUP",
    status: "local_artifacts_removed",
    summary: `Removed .pdh-flow/runs/${runtime.run.id}`,
    commit: "-"
  });
  const removed = cleanupRunArtifacts({ repoPath: repo, runId: runtime.run.id });
  if (options["clear-run-id"] === "true") {
    const pdh = loadPdhMeta(repo);
    savePdhMeta(repo, {
      ...pdh,
      run_id: null,
      updated_at: new Date().toISOString()
    });
  }
  console.log(`Removed ${removed}`);
}
