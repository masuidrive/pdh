// CLI commands for human-gate handling: gate-summary, approve / reject /
// request-changes / cancel, and show-gate.
import { resolve } from "node:path";
import { formatRecommendation } from "./assist.mjs";
import { getStep } from "../core/flow.mjs";
import {
  gateDecisionText,
  gateNoteHeadingsFor,
  gateTicketHeadingFor
} from "../runtime/actions.mjs";
import {
  appendProgressEvent,
  latestHumanGate,
  resolveHumanGate,
  updateRun
} from "../runtime/runtime-state.mjs";
import {
  ensureGateSummary,
  refreshGateSummary,
  syncStepUiRuntime,
  withRuntimeLock
} from "./index.mjs";
import {
  assertCurrentStep,
  humanStopCommands,
  isHumanGateStep,
  parseOptions,
  requireRuntime,
  runNextCommand,
  showGateCommand
} from "./utils.mjs";

export async function cmdGateSummary(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const step = getStep(runtime.flow, stepId);
    if (!isHumanGateStep(step)) {
      throw new Error(`${stepId} is not a human gate step`);
    }
    const gate = options.refresh === "true"
      ? refreshGateSummary({ repo, runtime, step })
      : ensureGateSummary({ repo, runtime, step });
    updateRun(repo, { status: "needs_human", current_step_id: stepId });
    syncStepUiRuntime({ repo, stepId, nextCommands: humanStopCommands(repo, stepId) });
    console.log(`Decision: ${gateDecisionText(stepId)}`);
    if (gate?.baseline?.commit) {
      console.log(`Baseline: ${gate.baseline.commit.slice(0, 7)}${gate.baseline.step_id ? ` from ${gate.baseline.step_id}` : ""}`);
    }
    if (gate?.rerun_requirement?.target_step_id) {
      console.log(`Rerun: ${gate.rerun_requirement.target_step_id}${gate.rerun_requirement.reason ? ` (${gate.rerun_requirement.reason})` : ""}`);
    }
    const ticketHeading = gateTicketHeadingFor(stepId);
    if (ticketHeading) {
      console.log(`Read: current-ticket.md ${ticketHeading}`);
    }
    for (const heading of gateNoteHeadingsFor(stepId)) {
      console.log(`Read: current-note.md ${heading}`);
    }
    console.log(`Next: ${showGateCommand(repo, stepId)}`);
  } });
}

export async function cmdHumanDecision(command, argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const decisionByCommand = {
    approve: "approved",
    reject: "rejected",
    "request-changes": "changes_requested",
    cancel: "cancelled"
  };
  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const step = getStep(runtime.flow, stepId);
    if (!isHumanGateStep(step)) {
      throw new Error(`${stepId} is not a human gate step`);
    }
    ensureGateSummary({ repo, runtime, step });
    const gate = resolveHumanGate({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId,
      decision: decisionByCommand[command]
    });
    updateRun(repo, { status: "running", current_step_id: stepId });
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId,
      type: "human_gate_resolved",
      provider: "runtime",
      message: `${stepId} ${gate.decision}`,
      payload: gate
    });
    syncStepUiRuntime({ repo, stepId, nextCommands: [runNextCommand(repo)] });
    console.log(`${stepId} ${gate.decision}`);
    console.log(`Next: ${runNextCommand(repo)}`);
  } });
}

export function cmdShowGate(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const runtime = requireRuntime(repo);
  const stepId = options.step ?? runtime.run.current_step_id;
  assertCurrentStep(runtime.run, stepId, options);
  const gate = latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId });
  if (!gate || gate.status !== "needs_human") {
    throw new Error(`No active human gate for ${stepId}`);
  }
  if (options.json === "true") {
    console.log(JSON.stringify(gate, null, 2));
    return;
  }
  console.log(`Step: ${stepId}`);
  console.log(`Decision: ${gateDecisionText(stepId)}`);
  if (gate.baseline?.commit) {
    console.log(`Baseline: ${gate.baseline.commit.slice(0, 7)}${gate.baseline.step_id ? ` from ${gate.baseline.step_id}` : ""}`);
  }
  if (gate.rerun_requirement?.target_step_id) {
    console.log(`Rerun: ${gate.rerun_requirement.target_step_id}${gate.rerun_requirement.reason ? ` (${gate.rerun_requirement.reason})` : ""}`);
  }
  if (gate.recommendation?.status === "pending") {
    console.log(`Recommendation: ${formatRecommendation(gate.recommendation)}`);
  }
  const ticketHeading = gateTicketHeadingFor(stepId);
  if (ticketHeading) {
    console.log(`Read: current-ticket.md ${ticketHeading}`);
  }
  for (const heading of gateNoteHeadingsFor(stepId)) {
    console.log(`Read: current-note.md ${heading}`);
  }
}

