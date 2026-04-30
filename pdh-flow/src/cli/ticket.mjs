// CLI commands for ticket lifecycle and run artifact maintenance.
import { resolve } from "node:path";
import { commitStep, ticketClose, ticketStart } from "../runtime/actions.mjs";
import { appendStepHistoryEntry } from "../core/note-state.mjs";
import {
  cleanupRunArtifacts,
  loadPdhMeta,
  loadRuntime,
  savePdhMeta
} from "../runtime/runtime-state.mjs";
import { parseOptions, required } from "./utils.mjs";

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
