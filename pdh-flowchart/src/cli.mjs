#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { loadDotEnv } from "./env.mjs";
import { describeFlow, buildFlowView, getInitialStep, getStep, loadFlow, nextStep, outcomeFromDecision, renderMermaidFlow } from "./flow.mjs";
import { evaluateStepGuards } from "./guards.mjs";
import { runCodex } from "./codex-adapter.mjs";
import { runClaude } from "./claude-adapter.mjs";
import { runCalcSmoke } from "./smoke-calc.mjs";
import { createGateSummary, commitStep, ticketClose, ticketStart } from "./actions.mjs";
import { writeReviewerPromptArtifact, writeReviewRepairPromptArtifact, writeStepPrompt } from "./prompt-templates.mjs";
import { captureNoteTicketPatchProposal, snapshotNoteTicketFiles } from "./patch-proposals.mjs";
import { defaultJudgementKind, loadJudgements, writeJudgement } from "./judgements.mjs";
import { runFinalVerification } from "./final-verification.mjs";
import { formatDoctor, runDoctor } from "./doctor.mjs";
import { withRunLock } from "./locks.mjs";
import { answerLatestInterruption, createInterruption, latestOpenInterruption, loadStepInterruptions, renderInterruptionMarkdown } from "./interruptions.mjs";
import { writeFailureSummary } from "./failure-summary.mjs";
import { appendStepHistoryEntry, loadCurrentNote, saveCurrentNote } from "./note-state.mjs";
import {
  allowedAssistSignals,
  appendAssistSignal,
  loadLatestAssistSignal,
  markAssistSessionFinished,
  markAssistSessionStarted,
  prepareAssistSession,
  updateLatestAssistSignal
} from "./assist-runtime.mjs";
import {
  activeReviewPlan,
  aggregateReviewerOutputs,
  expandReviewerInstances,
  loadReviewRepairOutput,
  loadReviewerOutput,
  loadReviewerOutputsForStepRound,
  materializeAggregatedReview,
  reviewAccepted,
  reviewRoundDir,
  reviewRoundReviewerAttemptDir,
  reviewRoundReviewerOutputPath,
  reviewRepairOutputPath,
  writeLatestReviewerOutputMirror,
  writeReviewRepairResult,
  writeReviewRoundAggregate,
  writeReviewerAttemptResult
} from "./review-runtime.mjs";
import { judgementFromUiOutput, loadStepUiOutput, writeStepUiRuntime } from "./step-ui.mjs";
import { clearStepCommitRecord, loadStepCommitRecord, writeStepCommitRecord } from "./step-commit.mjs";
import {
  appendProgressEvent,
  cleanupRunArtifacts,
  defaultStateDir,
  ensureCanonicalFiles,
  hasCompletedProviderAttempt,
  latestAttemptResult,
  latestHumanGate,
  clearHumanGateRecommendation,
  latestProviderSession,
  loadRuntime,
  nextStepAttempt,
  openHumanGate,
  progressPath,
  readProgressEvents,
  resetStepArtifacts,
  resolveHumanGate,
  saveRun,
  startRun,
  stepDir,
  updateRun,
  updateHumanGateRecommendation,
  writeAttemptResult
} from "./runtime-state.mjs";

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...warningArgs) => {
  const warningName =
    typeof warning === "object" && warning !== null
      ? warning.name
      : typeof warningArgs[0] === "string"
        ? warningArgs[0]
        : warningArgs[0]?.type;
  if (warningName !== "ExperimentalWarning") {
    emitWarning(warning, ...warningArgs);
  }
};

const args = process.argv.slice(2);
const command = args.shift();

try {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "init") {
    cmdInit(args);
  } else if (command === "run") {
    await cmdRun(args);
  } else if (command === "status") {
    cmdStatus(args);
  } else if (command === "logs") {
    await cmdLogs(args);
  } else if (command === "show-gate") {
    cmdShowGate(args);
  } else if (command === "doctor") {
    cmdDoctor(args);
  } else if (command === "web") {
    await cmdWeb(args);
  } else if (command === "prompt") {
    await cmdPrompt(args);
  } else if (command === "metadata") {
    cmdMetadata(args);
  } else if (command === "judgement") {
    await cmdJudgement(args);
  } else if (command === "verify") {
    await cmdVerify(args);
  } else if (command === "guards") {
    await cmdGuards(args);
  } else if (command === "run-provider") {
    await cmdRunProvider(args);
  } else if (command === "resume") {
    await cmdResume(args);
  } else if (command === "run-next") {
    await cmdRunNext(args);
  } else if (command === "gate-summary") {
    await cmdGateSummary(args);
  } else if (command === "interrupt") {
    await cmdInterrupt(args);
  } else if (command === "answer") {
    await cmdAnswer(args);
  } else if (command === "assist-open") {
    await cmdAssistOpen(args);
  } else if (command === "assist-signal") {
    await cmdAssistSignal(args);
  } else if (command === "apply-assist-signal") {
    await cmdApplyAssistSignal(args);
  } else if (command === "accept-recommendation") {
    await cmdAcceptRecommendation(args);
  } else if (command === "decline-recommendation") {
    await cmdDeclineRecommendation(args);
  } else if (command === "show-interrupts") {
    cmdShowInterrupts(args);
  } else if (["approve", "reject", "request-changes", "cancel"].includes(command)) {
    await cmdHumanDecision(command, args);
  } else if (command === "commit-step") {
    cmdCommitStep(args);
  } else if (command === "ticket-start") {
    cmdTicketStart(args);
  } else if (command === "ticket-close") {
    cmdTicketClose(args);
  } else if (command === "cleanup") {
    cmdCleanup(args);
  } else if (command === "smoke-calc") {
    await cmdSmokeCalc(args);
  } else if (command === "flow") {
    cmdFlow(args);
  } else if (command === "flow-graph") {
    cmdFlowGraph(args);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`pdh-flowchart: ${error.message}`);
  process.exitCode = 1;
}

function printHelp() {
  console.log(`pdh-flowchart

Usage:
  pdh-flowchart init [--repo DIR]
  pdh-flowchart run --ticket ID [--repo DIR] [--variant full|light] [--start-step PD-C-5] [--force-reset]
  pdh-flowchart run-next [--repo DIR] [--limit 20] [--manual-provider] [--stop-after-step] [--timeout-ms MS] [--idle-timeout-ms MS]
  pdh-flowchart run-provider [--repo DIR] [--step PD-C-6] [--prompt-file FILE] [--timeout-ms MS] [--idle-timeout-ms MS] [--max-attempts N]
  pdh-flowchart resume [--repo DIR] [--step PD-C-6]
  pdh-flowchart prompt [--repo DIR] [--step PD-C-6]
  pdh-flowchart metadata [--repo DIR]
  pdh-flowchart judgement [--repo DIR] [--step PD-C-4] [--kind plan_review] [--status "No Critical/Major"] [--summary TEXT]
  pdh-flowchart verify [--repo DIR] [--command "scripts/test-all.sh"]
  pdh-flowchart guards [--repo DIR] [--step PD-C-9]
  pdh-flowchart gate-summary [--repo DIR] [--step PD-C-5]
  pdh-flowchart approve [--repo DIR] [--step PD-C-5] [--reason TEXT]
  pdh-flowchart reject [--repo DIR] [--step PD-C-5] [--reason TEXT]
  pdh-flowchart request-changes [--repo DIR] [--step PD-C-5] [--reason TEXT]
  pdh-flowchart interrupt [--repo DIR] (--message TEXT | --file FILE) [--step PD-C-6]
  pdh-flowchart answer [--repo DIR] (--message TEXT | --file FILE) [--step PD-C-6]
  pdh-flowchart assist-open [--repo DIR] [--step PD-C-5] [--prepare-only] [--model MODEL] [--bare]
  pdh-flowchart assist-signal [--repo DIR] [--step PD-C-5] --signal recommend-approve|recommend-request-changes|recommend-reject|recommend-rerun-from|answer|continue [--reason TEXT] [--target-step PD-C-4] [--message TEXT] [--file FILE] [--no-run-next]
  pdh-flowchart apply-assist-signal [--repo DIR] [--step PD-C-4] [--no-run-next]
  pdh-flowchart accept-recommendation [--repo DIR] [--step PD-C-5] [--no-run-next]
  pdh-flowchart decline-recommendation [--repo DIR] [--step PD-C-5] [--reason TEXT]
  pdh-flowchart show-interrupts [--repo DIR] [--step PD-C-6] [--all] [--path]
  pdh-flowchart status [--repo DIR]
  pdh-flowchart logs [--repo DIR] [--follow] [--json]
  pdh-flowchart show-gate [--repo DIR] [--step PD-C-5] [--path]
  pdh-flowchart cleanup [--repo DIR] [--clear-run-id]
  pdh-flowchart flow [--variant full|light]
  pdh-flowchart flow-graph [--variant full|light] [--format mermaid|json] [--repo DIR]
  pdh-flowchart doctor [--repo DIR] [--json]
  pdh-flowchart web [--repo DIR] [--host 127.0.0.1] [--port 8765]
  pdh-flowchart smoke-calc [--workdir DIR]

Notes:
  - current-note.md frontmatter is the canonical runtime state.
  - current-ticket.md and current-note.md stay repo-local and human-readable.
  - .pdh-flowchart/ holds transient prompts, raw logs, interruptions, gate summaries, and other local artifacts.
  - Provider commands load .env for API keys. Unit-style checks do not call external providers.
`);
}

function cmdInit(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  ensureCanonicalFiles(repo);
  const note = loadCurrentNote(repo);
  saveCurrentNote(repo, note);
  mkdirSync(defaultStateDir(repo), { recursive: true });
  console.log(`Initialized canonical files in ${repo}`);
  console.log(`- ${join(repo, "current-note.md")}`);
  console.log(`- ${join(repo, "current-ticket.md")}`);
}

async function cmdRun(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const ticket = required(options, "ticket");
  const variant = options.variant ?? "full";
  const flowId = options.flow ?? "pdh-ticket-core";
  const flow = loadFlow(flowId);
  const startStep = options["start-step"] ?? getInitialStep(flow, variant);
  assertStepInVariant(flow, variant, startStep);

  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = loadRuntime(repo);
    if (runtime.run?.id && options["force-reset"] !== "true") {
      throw new Error("An active run already exists in current-note.md. Pass --force-reset to replace it.");
    }
    const started = startRun({ repoPath: repo, ticket, variant, flowId, startStep });
    maybeStartTicket({ repo, ticket, required: options["require-ticket-start"] === "true", runId: started.run.id, stepId: started.run.current_step_id });
    syncStepUiRuntime({ repo });
    console.log(started.run.id);
    console.log(`Current step: ${formatStepName(getStep(started.flow, started.run.current_step_id))}`);
    console.log(`Next: ${runNextCommand(repo)}`);
  } });
}

function cmdFlow(argv) {
  const options = parseOptions(argv);
  const variant = options.variant ?? "full";
  const flow = loadFlow(options.flow ?? "pdh-ticket-core");
  console.log(describeFlow(flow, variant));
}

function cmdFlowGraph(argv) {
  const options = parseOptions(argv);
  const variant = options.variant ?? "full";
  const flow = loadFlow(options.flow ?? "pdh-ticket-core");
  const repo = resolve(options.repo ?? process.cwd());
  const currentStepId = options.current ?? loadRuntime(repo).run?.current_step_id ?? null;
  if (options.format === "json") {
    console.log(JSON.stringify(buildFlowView(flow, variant, currentStepId), null, 2));
    return;
  }
  console.log(renderMermaidFlow(flow, variant, currentStepId));
}

async function cmdGuards(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const runtime = loadRuntime(repo);
  const stepId = options.step ?? runtime.run?.current_step_id;
  if (!stepId) {
    throw new Error("No current step. Use --step or start a run first.");
  }
  const step = getStep(runtime.flow, stepId);
  const gate = runtime.run?.id ? latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId }) : null;
  hydrateStepArtifactsBeforeGuards({ repo, runtime, step });
  const results = evaluateCurrentGuards({ repo, runtime, step, gate });
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => result.status === "failed")) {
    process.exitCode = 1;
  }
}

async function cmdRunNext(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const limit = Number(options.limit ?? "20");
  const stopAfterStep = options["stop-after-step"] === "true";
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit must be a positive integer");
  }

  await withRuntimeLock({ repo, options, action: async () => {
    const trace = [];
    for (let count = 0; count < limit; count += 1) {
      const runtime = requireRuntime(repo);
      const { run, flow, stateDir } = runtime;
      const step = getStep(flow, run.current_step_id);

      if (run.status === "completed") {
        console.log(JSON.stringify({ status: "completed", currentStepId: run.current_step_id, trace }, null, 2));
        return;
      }
      if (run.status === "failed") {
        printBlocked({
          status: "failed",
          stepId: step.id,
          reason: "provider_failed",
          provider: step.provider,
          nextCommands: [statusCommand(repo), resumeCommand(repo)]
        }, trace, options);
        process.exitCode = 1;
        return;
      }

      const interruptionBlock = blockIfOpenInterruption({ repo, runtime, step, options });
      if (interruptionBlock) {
        printBlocked(interruptionBlock, trace, options);
        process.exitCode = interruptionBlock.status === "interrupted" ? 0 : 1;
        return;
      }

      if (step.provider !== "runtime" && !hasCompletedProviderAttempt({ stateDir, runId: run.id, stepId: step.id, provider: step.provider })) {
        if (options["manual-provider"] === "true") {
          updateRun(repo, { status: "blocked", current_step_id: step.id });
          const result = {
            status: "blocked",
            stepId: step.id,
            reason: "provider_step_requires_execution",
            provider: step.provider,
            nextCommand: nextProviderCommand(repo)
          };
          appendProgressEvent({
            repoPath: repo,
            runId: run.id,
            stepId: step.id,
            type: "blocked",
            provider: "runtime",
            message: `${step.id} provider_step_requires_execution`,
            payload: result
          });
          syncStepUiRuntime({ repo, stepId: step.id, nextCommands: [nextProviderCommand(repo)] });
          trace.push(result);
          printBlocked(result, trace, options);
          return;
        }

        trace.push({ status: "provider_started", stepId: step.id, provider: step.provider });
        const providerResult = await executeProviderStep({ repo, runtime, step, options });
        if (providerResult.status === "blocked") {
          const block = {
            status: "blocked",
            stepId: step.id,
            reason: "review_rounds_exhausted",
            provider: step.provider,
            message: providerResult.result?.finalMessage ?? `${step.id} requires user intervention after repeated review rounds.`,
            failureSummary: providerResult.failureSummary?.artifactPath ?? providerResult.failureSummary,
            nextCommands: blockedStopCommands(repo, step.id)
          };
          trace.push(block);
          printBlocked(block, trace, options);
          return;
        }
        if (providerResult.status !== "completed") {
          trace.push({ status: "failed", stepId: step.id, provider: step.provider });
          printProviderResult({ repo, runtime: requireRuntime(repo), step, result: providerResult, options, trace });
          process.exitCode = 1;
          return;
        }
        continue;
      }

      if (isHumanGateStep(step)) {
        const gate = latestHumanGate({ stateDir, runId: run.id, stepId: step.id });
        if (!gate || gate.status === "needs_human") {
          const summary = ensureGateSummary({ repo, runtime, step });
          updateRun(repo, { status: "needs_human", current_step_id: step.id });
          syncStepUiRuntime({ repo, stepId: step.id, nextCommands: humanStopCommands(repo, step.id) });
          const result = {
            status: "needs_human",
            stepId: step.id,
            summary: summary.artifactPath,
            nextCommands: humanStopCommands(repo, step.id)
          };
          trace.push(result);
          console.log(JSON.stringify({ ...result, trace }, null, 2));
          return;
        }
      }

      const gate = isHumanGateStep(step) ? latestHumanGate({ stateDir, runId: run.id, stepId: step.id }) : null;
      hydrateStepArtifactsBeforeGuards({ repo, runtime, step });
      const guardResults = evaluateCurrentGuards({ repo, runtime, step, gate });
      const failed = guardResults.filter((guard) => guard.status === "failed");
      if (failed.length > 0) {
        updateRun(repo, { status: "blocked", current_step_id: step.id });
        const message = describeGuardFailureMessage(failed);
        const summary = createFailureSummaryForBlock({ repo, runtime, step, failedGuards: failed, message });
        syncStepUiRuntime({ repo, stepId: step.id, guardResults, nextCommands: blockedStopCommands(repo, step.id) });
        const block = {
          status: "blocked",
          stepId: step.id,
          reason: "guard_failed",
          provider: step.provider,
          message,
          failedGuards: failed,
          failureSummary: summary.artifactPath,
          nextCommands: blockedStopCommands(repo, step.id)
        };
        trace.push(block);
        printBlocked(block, trace, options);
        return;
      }

      const outcome = isHumanGateStep(step)
        ? outcomeFromDecision(gate?.decision)
        : "success";
      if (!outcome) {
        const summary = ensureGateSummary({ repo, runtime, step });
        updateRun(repo, { status: "needs_human", current_step_id: step.id });
        syncStepUiRuntime({ repo, stepId: step.id, nextCommands: humanStopCommands(repo, step.id) });
        const result = {
          status: "needs_human",
          stepId: step.id,
          summary: summary.artifactPath,
          nextCommands: humanStopCommands(repo, step.id)
        };
        trace.push(result);
        console.log(JSON.stringify({ ...result, trace }, null, 2));
        return;
      }

      const advanced = advanceRun({ repo, runtime, step, outcome });
      trace.push(advanced);
      if (advanced.status === "completed") {
        console.log(JSON.stringify({ ...advanced, trace }, null, 2));
        return;
      }
      if (stopAfterStep) {
        printStoppedAfterStep({
          completedStepId: step.id,
          nextStep: getStep(flow, advanced.to),
          repo,
          trace,
          options
        });
        return;
      }
    }

    printBlocked({ status: "blocked", reason: "limit_reached", limit }, [], options);
    process.exitCode = 1;
  } });
}

async function cmdRunProvider(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const step = getStep(runtime.flow, stepId);
    const interruptionBlock = blockIfOpenInterruption({ repo, runtime, step, options });
    if (interruptionBlock) {
      printBlocked(interruptionBlock, [], options);
      process.exitCode = 1;
      return;
    }
    const result = await executeProviderStep({ repo, runtime, step, options });
    printProviderResult({ repo, runtime: requireRuntime(repo), step, result, options, trace: [] });
    if (result.status !== "completed") {
      process.exitCode = 1;
    }
  } });
}

async function cmdResume(argv) {
  await cmdRunProvider([...argv, "--resume", "latest"]);
}

async function cmdPrompt(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const prompt = writeStepPrompt({ repoPath: repo, stateDir: runtime.stateDir, run: runtime.run, flow: runtime.flow, stepId });
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId,
      type: "artifact",
      provider: "runtime",
      message: `prompt generated ${prompt.artifactPath}`,
      payload: { artifactPath: prompt.artifactPath }
    });
    console.log(prompt.artifactPath);
  } });
}

function cmdMetadata(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const note = loadCurrentNote(repo);
  console.log(JSON.stringify(note.pdh, null, 2));
}

async function cmdJudgement(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const result = writeJudgement({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId,
      kind: options.kind ?? defaultJudgementKind(stepId),
      status: options.status ?? null,
      summary: options.summary ?? null,
      source: options.source ?? "runtime",
      details: { reason: options.reason ?? null }
    });
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId,
      type: "artifact",
      provider: "runtime",
      message: `judgement ${result.judgement.kind}: ${result.judgement.status}`,
      payload: { artifactPath: result.artifactPath, judgement: result.judgement }
    });
    syncStepUiRuntime({ repo, stepId });
    console.log(JSON.stringify(result, null, 2));
  } });
}

async function cmdVerify(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    if (stepId !== "PD-C-9" && options.force !== "true") {
      throw new Error(`verify is for PD-C-9; current step is ${stepId}. Pass --force to override.`);
    }
    const result = runFinalVerification({
      repoPath: repo,
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId,
      command: options.command ?? null
    });
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId,
      type: "artifact",
      provider: "runtime",
      message: `final verification ${result.result.status}`,
      payload: result
    });
    syncStepUiRuntime({ repo, stepId });
    console.log(JSON.stringify(result, null, 2));
    if (result.result.status !== "passed") {
      process.exitCode = 1;
    }
  } });
}

async function cmdGateSummary(argv) {
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
    const summary = ensureGateSummary({ repo, runtime, step });
    updateRun(repo, { status: "needs_human", current_step_id: stepId });
    syncStepUiRuntime({ repo, stepId, nextCommands: humanStopCommands(repo, stepId) });
    console.log(summary.artifactPath);
    console.log(`Next: ${showGateCommand(repo, stepId)}`);
  } });
}

async function cmdHumanDecision(command, argv) {
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
      decision: decisionByCommand[command],
      reason: options.reason ?? null
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

async function cmdInterrupt(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const message = readMessageOption(options, "interrupt");
    const interruption = createInterruption({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId,
      message,
      source: options.source ?? "user",
      kind: options.kind ?? "clarification"
    });
    updateRun(repo, { status: "interrupted", current_step_id: stepId });
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId,
      type: "interrupted",
      provider: "runtime",
      message: `${stepId} interrupted`,
      payload: interruption
    });
    syncStepUiRuntime({ repo, stepId, nextCommands: interruptStopCommands(repo, stepId) });
    console.log(`${stepId} interrupted`);
    console.log(`Interrupt: ${interruption.artifactPath}`);
    console.log("Next:");
    for (const commandText of interruptStopCommands(repo, stepId)) {
      console.log(`- ${commandText}`);
    }
  } });
}

async function cmdAnswer(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const message = readMessageOption(options, "answer");
    const interruption = answerLatestInterruption({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId,
      message,
      source: options.source ?? "user"
    });
    updateRun(repo, { status: "running", current_step_id: stepId });
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId,
      type: "interrupt_answered",
      provider: "runtime",
      message: `${stepId} interrupt answered`,
      payload: interruption
    });
    syncStepUiRuntime({ repo, stepId, nextCommands: [runNextCommand(repo)] });
    console.log(`${stepId} answered`);
    console.log(`Answer: ${interruption.answerPath}`);
    console.log(`Next: ${runNextCommand(repo)}`);
  } });
}

async function cmdAssistOpen(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  loadDotEnv();
  let prepared = null;
  let runId = null;
  let stepId = null;
  let runtimeStatus = null;

  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const step = getStep(runtime.flow, stepId);
    const allowedSignals = allowedAssistSignals({ runStatus: runtime.run.status, step, runtime });
    prepared = prepareAssistSession({
      repoPath: repo,
      runtime,
      step,
      bare: options.bare === "true",
      model: options.model ?? null
    });
    runId = runtime.run.id;
    runtimeStatus = runtime.run.status;
    appendProgressEvent({
      repoPath: repo,
      runId,
      stepId,
      type: "assist_prepared",
      provider: "runtime",
      message: `${stepId} assist prepared`,
      payload: {
        sessionId: prepared.sessionId,
        manifestPath: prepared.manifestPath,
        promptPath: prepared.promptPath,
        allowedSignals: prepared.allowedSignals
      }
    });
    syncStepUiRuntime({ repo, stepId });
  } });

  const args = buildAssistClaudeArgs({
    prepared,
    model: options.model ?? null,
    bare: options.bare === "true"
  });

  if (options["prepare-only"] === "true") {
    console.log(JSON.stringify({
      sessionId: prepared.sessionId,
      manifestPath: prepared.manifestPath,
      promptPath: prepared.promptPath,
      systemPromptPath: prepared.systemPromptPath,
      allowedSignals: prepared.allowedSignals,
      wrappers: {
        signal: prepared.wrappers.signalScriptPath,
        test: prepared.wrappers.testScriptPath
      },
      command: [process.env.CLAUDE_BIN || "claude", ...args]
    }, null, 2));
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("assist-open needs a TTY. Use --prepare-only for non-interactive use.");
  }

  markAssistSessionStarted({
    stateDir: defaultStateDir(repo),
    runId,
    stepId,
    sessionId: prepared.sessionId,
    command: [process.env.CLAUDE_BIN || "claude", ...args]
  });
  appendProgressEvent({
    repoPath: repo,
    runId,
    stepId,
    type: "assist_started",
    provider: "runtime",
    message: `${stepId} assist started`,
    payload: {
      sessionId: prepared.sessionId,
      status: runtimeStatus
    }
  });

  console.log(`Assist session: ${prepared.sessionId}`);
  console.log(`Manifest: ${prepared.manifestPath}`);
  console.log(`Prompt: ${prepared.promptPath}`);
  console.log(`Allowed signals: ${prepared.allowedSignals.join(", ")}`);

  const exit = await spawnAssistClaude({
    repo,
    args,
    command: process.env.CLAUDE_BIN || "claude"
  });

  markAssistSessionFinished({
    stateDir: defaultStateDir(repo),
    runId,
    stepId,
    sessionId: prepared.sessionId,
    exitCode: exit.exitCode,
    signal: exit.signal
  });
  appendProgressEvent({
    repoPath: repo,
    runId,
    stepId,
    type: "assist_finished",
    provider: "runtime",
    message: `${stepId} assist ${exit.exitCode === 0 ? "completed" : "failed"}`,
    payload: {
      sessionId: prepared.sessionId,
      exitCode: exit.exitCode,
      signal: exit.signal
    }
  });
  if (exit.exitCode !== 0) {
    process.exitCode = exit.exitCode ?? 1;
  }
}

async function cmdAssistSignal(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const signal = normalizeAssistSignal(required(options, "signal"));
  const autoRunNext = options["no-run-next"] !== "true";
  let response = null;
  let shouldRunNext = false;

  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const step = getStep(runtime.flow, stepId);
    const allowedSignals = allowedAssistSignals({ runStatus: runtime.run.status, step, runtime });
    if (!allowedSignals.includes(signal)) {
      throw new Error(`Signal ${signal} is not allowed while status=${runtime.run.status} step=${stepId}. Allowed: ${allowedSignals.join(", ") || "(none)"}`);
    }

    const reason = options.reason ?? null;
    const message = signal === "answer" ? readMessageOption(options, "assist-signal") : null;
    const targetStepId = signal === "recommend-rerun-from" ? required(options, "target-step") : null;
    const recorded = appendAssistSignal({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId,
      signal,
      reason,
      message,
      runNext: autoRunNext
    });

    if (runtime.run.status === "needs_human") {
      if (signal === "recommend-rerun-from") {
        assertRerunTarget({ runtime, currentStepId: stepId, targetStepId });
      }
      const summary = refreshGateSummary({ repo, runtime, step });
      const gate = updateHumanGateRecommendation({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId,
        action: signal.replace(/^recommend-/, "").replaceAll("-", "_"),
        reason,
        target_step_id: targetStepId,
        source: "assist"
      });
      updateRun(repo, { status: "needs_human", current_step_id: stepId });
      appendProgressEvent({
        repoPath: repo,
        runId: runtime.run.id,
        stepId,
        type: "human_gate_recommended",
        provider: "runtime",
        message: `${stepId} ${gate.recommendation?.action || signal} via assist`,
        payload: { ...gate, assistSignal: recorded, summary: summary.artifactPath }
      });
      syncStepUiRuntime({ repo, stepId, nextCommands: recommendedStopCommands(repo, stepId) });
      response = {
        status: "ok",
        stepId,
        signal,
        recommendation: gate.recommendation,
        summary: summary.artifactPath,
        runNext: false
      };
      return;
    }

    if (runtime.run.status === "interrupted") {
      const interruption = answerLatestInterruption({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId,
        message,
        source: "assist"
      });
      updateRun(repo, { status: "running", current_step_id: stepId });
      appendProgressEvent({
        repoPath: repo,
        runId: runtime.run.id,
        stepId,
        type: "interrupt_answered",
        provider: "runtime",
        message: `${stepId} interrupt answered via assist`,
        payload: { ...interruption, assistSignal: recorded }
      });
      syncStepUiRuntime({ repo, stepId, nextCommands: [runNextCommand(repo)] });
      response = {
        status: "ok",
        stepId,
        signal,
        answered: interruption.id,
        runNext: autoRunNext
      };
      shouldRunNext = autoRunNext;
      return;
    }

    if (runtime.run.status === "failed") {
      updateLatestAssistSignal({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId,
        mutator(current) {
          if (!current || current.id !== recorded.id) {
            return current;
          }
          return {
            ...current,
            status: "pending"
          };
        }
      });
      appendProgressEvent({
        repoPath: repo,
        runId: runtime.run.id,
        stepId,
        type: "assist_continue_requested",
        provider: "runtime",
        message: `${stepId} rerun requested via assist`,
        payload: recorded
      });
      syncStepUiRuntime({ repo, stepId, nextCommands: [assistOpenCommand(repo, stepId), applyAssistSignalCommand(repo, stepId), resumeCommand(repo)] });
      response = {
        status: "ok",
        stepId,
        signal,
        pendingConfirmation: true,
        next: applyAssistSignalCommand(repo, stepId),
        runNext: false
      };
      return;
    }

    updateRun(repo, { status: "running", current_step_id: stepId });
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId,
      type: "assist_continue",
      provider: "runtime",
      message: `${stepId} continue via assist`,
      payload: recorded
    });
    syncStepUiRuntime({ repo, stepId, nextCommands: [runNextCommand(repo)] });
    response = {
      status: "ok",
      stepId,
      signal,
      runNext: autoRunNext
    };
    shouldRunNext = autoRunNext;
  } });

  console.log(JSON.stringify(response, null, 2));
  if (shouldRunNext) {
    await cmdRunNext(["--repo", repo]);
  }
}

async function cmdApplyAssistSignal(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const autoRunNext = options["no-run-next"] !== "true";
  let response = null;
  let shouldRunNext = false;

  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const signal = loadLatestAssistSignal({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId });
    if (!signal) {
      throw new Error(`${stepId} does not have a latest assist signal`);
    }
    if (signal.signal !== "continue") {
      throw new Error(`${stepId} latest assist signal is ${signal.signal}; only continue can be applied here`);
    }
    if (runtime.run.status !== "failed" && runtime.run.status !== "blocked") {
      throw new Error(`${stepId} assist continue can only be applied while status is failed or blocked; current status is ${runtime.run.status}`);
    }
    const updatedSignal = updateLatestAssistSignal({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId,
      mutator(current) {
        if (!current || current.id !== signal.id) {
          return current;
        }
        return {
          ...current,
          status: "accepted",
          accepted_at: new Date().toISOString()
        };
      }
    }) ?? signal;
    updateRun(repo, { status: "running", current_step_id: stepId });
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId,
      type: "assist_continue_accepted",
      provider: "runtime",
      message: `${stepId} rerun accepted via assist`,
      payload: updatedSignal
    });
    syncStepUiRuntime({ repo, stepId, nextCommands: [rerunCurrentStepCommand(repo)] });
    response = {
      status: "ok",
      stepId,
      signal: updatedSignal.signal,
      runNext: autoRunNext
    };
    shouldRunNext = autoRunNext;
  } });

  console.log(JSON.stringify(response, null, 2));
  if (shouldRunNext) {
    await cmdRunNext(["--repo", repo, "--force"]);
  }
}

async function cmdAcceptRecommendation(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const autoRunNext = options["no-run-next"] !== "true";
  let response = null;
  let shouldRunNext = false;

  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const step = getStep(runtime.flow, stepId);
    if (!isHumanGateStep(step)) {
      throw new Error(`${stepId} is not a human gate step`);
    }
    const gate = latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId });
    const recommendation = gate?.recommendation;
    if (!recommendation || recommendation.status !== "pending") {
      throw new Error(`${stepId} does not have a pending recommendation`);
    }
    assertRecommendationCompatibleWithGateEdits({ runtime, stepId, gate, recommendation });

    let advanced = null;
    if (recommendation.action === "rerun_from") {
      const targetStepId = recommendation.target_step_id;
      if (!targetStepId) {
        throw new Error(`${stepId} recommendation is missing target_step_id`);
      }
      assertRerunTarget({ runtime, currentStepId: stepId, targetStepId });
      resolveHumanGate({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId,
        decision: "changes_requested",
        reason: recommendation.reason ?? `accepted recommendation to rerun from ${targetStepId}`
      });
      advanced = rerunFromStep({
        repo,
        runtime,
        step,
        targetStepId,
        reason: recommendation.reason
      });
    } else {
      const decision = gateDecisionFromRecommendation(recommendation.action);
      if (!decision) {
        throw new Error(`Unsupported recommendation action: ${recommendation.action}`);
      }
      resolveHumanGate({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId,
        decision,
        reason: recommendation.reason ?? null
      });
      advanced = advanceRun({
        repo,
        runtime,
        step,
        outcome: outcomeFromDecision(decision)
      });
    }

    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId,
      type: "human_gate_recommendation_accepted",
      provider: "runtime",
      message: `${stepId} accepted ${recommendation.action}`,
      payload: {
        recommendation,
        result: advanced
      }
    });
    response = {
      status: "ok",
      stepId,
      accepted: recommendation,
      result: advanced,
      runNext: autoRunNext && advanced?.status !== "completed"
    };
    shouldRunNext = autoRunNext && advanced?.status !== "completed";
  } });

  console.log(JSON.stringify(response, null, 2));
  if (shouldRunNext) {
    await cmdRunNext(["--repo", repo]);
  }
}

async function cmdDeclineRecommendation(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  let response = null;

  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const step = getStep(runtime.flow, stepId);
    if (!isHumanGateStep(step)) {
      throw new Error(`${stepId} is not a human gate step`);
    }
    const gate = latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId });
    const recommendation = gate?.recommendation;
    if (!recommendation || recommendation.status !== "pending") {
      throw new Error(`${stepId} does not have a pending recommendation`);
    }
    clearHumanGateRecommendation({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId
    });
    updateRun(repo, { status: "needs_human", current_step_id: stepId });
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId,
      type: "human_gate_recommendation_declined",
      provider: "runtime",
      message: `${stepId} declined ${recommendation.action}`,
      payload: {
        recommendation,
        reason: options.reason ?? null
      }
    });
    syncStepUiRuntime({ repo, stepId, nextCommands: humanStopCommands(repo, stepId) });
    response = {
      status: "ok",
      stepId,
      declined: recommendation,
      next: assistOpenCommand(repo, stepId)
    };
  } });

  console.log(JSON.stringify(response, null, 2));
}

function cmdShowInterrupts(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const runtime = requireRuntime(repo);
  const stepId = options.step ?? runtime.run.current_step_id;
  assertCurrentStep(runtime.run, stepId, options);
  const interruptions = loadStepInterruptions({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId });
  const selected = options.all === "true" ? interruptions : interruptions.slice(-1);
  if (!selected.length) {
    console.log(`No interruptions for ${stepId}`);
    return;
  }
  if (options.path === "true") {
    for (const interruption of selected) {
      console.log(interruption.artifactPath);
    }
    return;
  }
  console.log(selected.map(renderInterruptionMarkdown).join("\n"));
}

function cmdCommitStep(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const result = commitStep({ repoPath: repo, stepId: required(options, "step"), message: options.message ?? null });
  console.log(JSON.stringify(result, null, 2));
}

function cmdTicketStart(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const result = ticketStart({ repoPath: repo, ticket: required(options, "ticket") });
  console.log(JSON.stringify(result, null, 2));
}

function cmdTicketClose(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const result = ticketClose({ repoPath: repo });
  console.log(JSON.stringify(result, null, 2));
}

function cmdCleanup(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const runtime = loadRuntime(repo);
  if (!runtime.run?.id) {
    throw new Error("No active run artifacts to clean up");
  }
  appendStepHistoryEntry(repo, {
    stepId: "CLEANUP",
    status: "local_artifacts_removed",
    summary: `Removed .pdh-flowchart/runs/${runtime.run.id}`,
    commit: "-"
  });
  const removed = cleanupRunArtifacts({ repoPath: repo, runId: runtime.run.id });
  if (options["clear-run-id"] === "true") {
    const note = loadCurrentNote(repo);
    saveCurrentNote(repo, {
      ...note,
      pdh: {
        ...note.pdh,
        run_id: null,
        updated_at: new Date().toISOString()
      }
    });
  }
  console.log(`Removed ${removed}`);
}

function cmdStatus(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const runtime = loadRuntime(repo);
  const run = runtime.run;
  if (!run) {
    console.log("Status: idle");
    console.log(`Repo: ${repo}`);
    console.log("Run: -");
    return;
  }
  const step = getStep(runtime.flow, run.current_step_id);
  console.log(`Run: ${run.id ?? "-"}`);
  console.log(`Ticket: ${run.ticket_id ?? "-"}`);
  console.log(`Flow: ${run.flow_id}@${run.flow_variant}`);
  console.log(`Status: ${run.status}`);
  console.log(`Current Step: ${formatStepName(step)}`);
  if (step.summary) {
    console.log(`Step Summary: ${step.summary}`);
  }
  if (step.userAction) {
    console.log(`User Action: ${step.userAction}`);
  }
  console.log(`Provider: ${step.provider}`);
  console.log(`Mode: ${step.mode}`);
  if (step.guards?.length) {
    console.log(`Guards: ${step.guards.map((guard) => guard.id).join(", ")}`);
  }
  const gate = run.id ? latestHumanGate({ stateDir: runtime.stateDir, runId: run.id, stepId: step.id }) : null;
  if (gate) {
    console.log(`Human Gate: ${gate.status}${gate.decision ? ` (${gate.decision})` : ""}`);
    if (gate.summary) {
      console.log(`Gate Summary: ${gate.summary}`);
    }
    if (gate.recommendation?.status === "pending") {
      console.log(`Recommendation: ${formatRecommendation(gate.recommendation)}`);
    }
  }
  const interruption = run.id ? latestOpenInterruption({ stateDir: runtime.stateDir, runId: run.id, stepId: step.id }) : null;
  if (interruption) {
    console.log(`Interruption: open ${interruption.id}`);
    console.log(`Interruption File: ${interruption.artifactPath}`);
  }
  const latestAttempt = run.id ? latestAttemptResult({ stateDir: runtime.stateDir, runId: run.id, stepId: step.id, provider: step.provider }) : null;
  if (latestAttempt?.rawLogPath) {
    console.log(`Latest Raw Log: ${latestAttempt.rawLogPath}`);
  }
  console.log("Recent Events:");
  for (const event of readProgressEvents({ repoPath: repo, runId: run.id, limit: Number(options.limit ?? "20") })) {
    console.log(`- ${event.ts} ${event.stepId ?? "-"} ${event.type} ${event.message ?? ""}`);
  }
}

async function cmdLogs(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const runtime = requireRuntime(repo);
  const path = progressPath(runtime.stateDir, runtime.run.id);
  let cursor = 0;
  const events = readProgressEvents({ repoPath: repo, runId: runtime.run.id, limit: Number(options.limit ?? "50") });
  for (const event of events) {
    printEvent(event, options.json === "true");
  }
  if (!existsSync(path) || options.follow !== "true") {
    return;
  }
  cursor = statSync(path).size;
  const intervalMs = Number(options.interval ?? "1000");
  while (true) {
    await sleep(intervalMs);
    if (!existsSync(path)) {
      return;
    }
    const size = statSync(path).size;
    if (size <= cursor) {
      continue;
    }
    const chunk = readFileSync(path, "utf8").slice(cursor);
    cursor = size;
    for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
      try {
        printEvent(JSON.parse(line), options.json === "true");
      } catch {
        // Ignore partial lines.
      }
    }
  }
}

function cmdShowGate(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const runtime = requireRuntime(repo);
  const stepId = options.step ?? runtime.run.current_step_id;
  assertCurrentStep(runtime.run, stepId, options);
  const gate = latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId });
  if (!gate?.summary) {
    throw new Error(`No human gate summary found for ${stepId}`);
  }
  if (options.path === "true") {
    console.log(gate.summary);
    return;
  }
  console.log(readFileSync(gate.summary, "utf8"));
}

function cmdDoctor(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const result = runDoctor({ repoPath: repo });
  if (options.json === "true") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatDoctor(result));
  }
  if (result.status === "fail") {
    process.exitCode = 1;
  }
}

async function cmdWeb(argv) {
  const { startWebServer } = await import("./web-server.mjs");
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const host = options.host ?? "127.0.0.1";
  const port = nonNegativeInteger(options.port ?? "8765", "--port");
  const { server, url } = await startWebServer({ repoPath: repo, host, port });
  console.log(`Web UI: ${url}`);
  console.log("Mode: viewer + assist terminal");
  console.log(`Repo: ${repo}`);
  await new Promise((resolveServer) => {
    const shutdown = () => server.close(resolveServer);
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

async function cmdSmokeCalc(argv) {
  const options = parseOptions(argv);
  loadDotEnv();
  const result = await runCalcSmoke({
    rootDir: resolve(options.workdir ?? "/tmp/pdh-flowchart-calc-smoke"),
    bypass: options.bypass !== "false",
    timeoutMs: nonNegativeInteger(options["timeout-ms"] ?? String(10 * 60 * 1000), "--timeout-ms")
  });
  writeFileSync(join(result.rootDir, "smoke-result.json"), JSON.stringify(result, null, 2));
  console.log(`Codex exit: ${result.codexExitCode}`);
  console.log(`Verify: uv run calc 1+2 -> ${result.verifyStdout || "(empty)"} (exit ${result.verifyExitCode})`);
  console.log(`Passed: ${result.passed ? "yes" : "no"}`);
  console.log(`Workdir: ${result.rootDir}`);
  console.log(`Raw log: ${result.rawLogPath}`);
  if (!result.passed) {
    process.exitCode = 1;
  }
}

async function executeProviderStep({ repo, runtime, step, options }) {
  if (step.provider === "runtime") {
    throw new Error(`${step.id} is runtime-owned and does not have a provider prompt`);
  }
  const reviewPlan = activeReviewPlan(runtime.flow, runtime.run.flow_variant, step.id);
  if (step.mode === "review" && reviewPlan?.reviewers?.length) {
    if (options["prompt-file"]) {
      throw new Error(`${step.id} uses runtime-owned parallel reviewer prompts; --prompt-file is not supported for this step.`);
    }
    return executeParallelReviewStep({ repo, runtime, step, reviewPlan, options });
  }
  loadDotEnv();

  const runId = runtime.run.id;
  const stepId = step.id;
  const promptPath = options["prompt-file"]
    ? resolve(options["prompt-file"])
    : writePromptArtifact({ repo, runtime, stepId });
  const prompt = readFileSync(promptPath, "utf8");
  const timeoutMs = providerTimeoutMs({ options, flow: runtime.flow, step });
  const idleTimeoutMs = providerIdleTimeoutMs({ options, flow: runtime.flow, step });
  let attempt = options.attempt !== undefined
    ? positiveInteger(options.attempt, "--attempt")
    : nextStepAttempt({ stateDir: runtime.stateDir, runId, stepId });
  const startAttempt = attempt;
  let maxAttempts = providerMaxAttempts({ options, flow: runtime.flow, step, startAttempt: attempt });
  if (attempt > maxAttempts && options.force !== "true") {
    throw new Error(`${stepId} exhausted max attempts (${maxAttempts}); pass --force, --attempt, or --max-attempts to override.`);
  }
  if (attempt > maxAttempts) {
    maxAttempts = attempt;
  }

  let status = "failed";
  let rawLogPath = null;
  let lastResult = null;
  const headBeforeStep = currentHead(repo);
  clearStepCommitRecord({ stateDir: runtime.stateDir, runId, stepId });
  while (attempt <= maxAttempts) {
    rawLogPath = join(runtime.stateDir, "runs", runId, "steps", stepId, `attempt-${attempt}`, `${step.provider}.raw.jsonl`);
    const resume = resolveProviderResume({
      runtime,
      stepId,
      provider: step.provider,
      option: options.resume ?? (attempt > startAttempt ? "latest" : null),
      allowMissing: options.resume === undefined && attempt > startAttempt
    });
    const before = snapshotNoteTicketFiles({ repoPath: repo });
    updateRun(repo, { status: "running", current_step_id: stepId });
    let attemptState = {
      provider: step.provider,
      status: "running",
      pid: null,
      exitCode: null,
      finalMessage: null,
      stderr: "",
      timedOut: false,
      timeoutKind: null,
      signal: null,
      sessionId: null,
      resumeToken: null,
      rawLogPath,
      startedAt: new Date().toISOString(),
      lastEventAt: null
    };
    writeAttemptResult({
      stateDir: runtime.stateDir,
      runId,
      stepId,
      attempt,
      result: attemptState
    });
    appendProgressEvent({
      repoPath: repo,
      runId,
      stepId,
      attempt,
      type: "step_started",
      provider: step.provider,
      message: `${stepId} started`
    });

    const result = step.provider === "codex"
      ? await runCodex({
          cwd: repo,
          prompt,
          rawLogPath,
          bypass: options.bypass !== "false",
          model: options.model ?? null,
          resume,
          timeoutMs,
          idleTimeoutMs,
          killGraceMs: providerKillGraceMs(options),
          onSpawn({ pid }) {
            attemptState = {
              ...attemptState,
              pid: pid ?? null
            };
            writeAttemptResult({
              stateDir: runtime.stateDir,
              runId,
              stepId,
              attempt,
              result: attemptState
            });
          },
          onEvent(event) {
            attemptState = {
              ...attemptState,
              finalMessage: event.finalMessage ?? attemptState.finalMessage,
              sessionId: event.sessionId ?? attemptState.sessionId,
              resumeToken: event.sessionId ?? attemptState.resumeToken,
              lastEventAt: new Date().toISOString()
            };
            writeAttemptResult({
              stateDir: runtime.stateDir,
              runId,
              stepId,
              attempt,
              result: attemptState
            });
            appendProgressEvent({
              repoPath: repo,
              runId,
              stepId,
              attempt,
              type: event.type,
              provider: step.provider,
              message: event.message,
              payload: event.payload ?? {}
            });
          }
        })
      : await runClaude({
          cwd: repo,
          prompt,
          rawLogPath,
          bare: options.bare === "true",
          includePartialMessages: options["include-partial-messages"] === "true",
          model: options.model ?? null,
          permissionMode: options["permission-mode"] ?? (options.bypass !== "false" ? "bypassPermissions" : "acceptEdits"),
          resume,
          timeoutMs,
          idleTimeoutMs,
          killGraceMs: providerKillGraceMs(options),
          onSpawn({ pid }) {
            attemptState = {
              ...attemptState,
              pid: pid ?? null
            };
            writeAttemptResult({
              stateDir: runtime.stateDir,
              runId,
              stepId,
              attempt,
              result: attemptState
            });
          },
          onEvent(event) {
            attemptState = {
              ...attemptState,
              finalMessage: event.finalMessage ?? attemptState.finalMessage,
              sessionId: event.sessionId ?? attemptState.sessionId,
              resumeToken: event.sessionId ?? attemptState.resumeToken,
              lastEventAt: new Date().toISOString()
            };
            writeAttemptResult({
              stateDir: runtime.stateDir,
              runId,
              stepId,
              attempt,
              result: attemptState
            });
            appendProgressEvent({
              repoPath: repo,
              runId,
              stepId,
              attempt,
              type: event.type,
              provider: step.provider,
              message: event.message,
              payload: event.payload ?? {}
            });
          }
        });

    lastResult = result;
    status = result.exitCode === 0 ? "completed" : "failed";
    writeAttemptResult({
      stateDir: runtime.stateDir,
      runId,
      stepId,
      attempt,
      result: {
        provider: step.provider,
        status,
        pid: result.pid ?? attemptState.pid ?? null,
        exitCode: result.exitCode,
        finalMessage: result.finalMessage,
        stderr: result.stderr,
        timedOut: result.timedOut === true,
        timeoutKind: result.timeoutKind ?? null,
        signal: result.signal ?? null,
        sessionId: result.sessionId ?? attemptState.sessionId ?? null,
        resumeToken: result.sessionId ?? attemptState.resumeToken ?? null,
        rawLogPath,
        startedAt: attemptState.startedAt,
        lastEventAt: attemptState.lastEventAt,
        finishedAt: new Date().toISOString()
      }
    });
    appendProgressEvent({
      repoPath: repo,
      runId,
      stepId,
      attempt,
      type: "step_finished",
      provider: step.provider,
      message: `${stepId} ${status}`,
      payload: {
        exitCode: result.exitCode,
        rawLogPath,
        finalMessage: result.finalMessage,
        stderr: result.stderr
      }
    });
    const patchProposal = captureNoteTicketPatchProposal({
      repoPath: repo,
      stateDir: runtime.stateDir,
      runId,
      stepId,
      attempt,
      before
    });
    if (patchProposal.status === "written") {
      appendProgressEvent({
        repoPath: repo,
        runId,
        stepId,
        attempt,
        type: "artifact",
        provider: "runtime",
        message: `note/ticket patch proposal ${patchProposal.artifactPath}`,
        payload: patchProposal
      });
    }
    if (status === "completed") {
      const stepCommit = writeStepCommitRecord({
        repoPath: repo,
        stateDir: runtime.stateDir,
        runId,
        stepId,
        beforeCommit: headBeforeStep
      });
      if (stepCommit) {
        appendProgressEvent({
          repoPath: repo,
          runId,
          stepId,
          attempt,
          type: "artifact",
          provider: "runtime",
          message: `step commit ${stepCommit.short_commit}`,
          payload: { artifactPath: stepCommit.artifactPath, stepCommit }
        });
      }
      materializeJudgementFromUiOutput({
        repo,
        runtime,
        step,
        providerResult: result
      });
    }
    if (status === "completed" || attempt >= maxAttempts) {
      break;
    }
    const delayMs = retryDelayMs(options, attempt);
    appendProgressEvent({
      repoPath: repo,
      runId,
      stepId,
      attempt,
      type: "retry",
      provider: "runtime",
      message: `retrying ${step.provider} attempt ${attempt + 1} after ${delayMs}ms`,
      payload: {
        nextAttempt: attempt + 1,
        maxAttempts,
        delayMs,
        exitCode: result.exitCode,
        timedOut: result.timedOut === true,
        timeoutKind: result.timeoutKind ?? null,
        resume: resume ?? null
      }
    });
    await sleep(delayMs);
    attempt += 1;
  }

  updateRun(repo, { status: status === "completed" ? "running" : "failed", current_step_id: stepId });
  const failureSummary = status === "completed"
    ? null
    : createProviderFailureSummary({ repo, runtime: requireRuntime(repo), step, attempt, maxAttempts, rawLogPath, result: lastResult });
  syncStepUiRuntime({
    repo,
    stepId,
    nextCommands: status === "completed"
      ? [runNextCommand(repo)]
      : [statusCommand(repo), resumeCommand(repo)]
  });
  return {
    status,
    attempt,
    maxAttempts,
    rawLogPath,
    stepId,
    provider: step.provider,
    result: lastResult,
    failureSummary
  };
}

async function executeParallelReviewStep({ repo, runtime, step, reviewPlan, options }) {
  loadDotEnv();

  const runId = runtime.run.id;
  const stepId = step.id;
  const timeoutMs = providerTimeoutMs({ options, flow: runtime.flow, step });
  const idleTimeoutMs = providerIdleTimeoutMs({ options, flow: runtime.flow, step });
  let attempt = options.attempt !== undefined
    ? positiveInteger(options.attempt, "--attempt")
    : nextStepAttempt({ stateDir: runtime.stateDir, runId, stepId });
  const startAttempt = attempt;
  let maxAttempts = providerMaxAttempts({ options, flow: runtime.flow, step, startAttempt: attempt });
  if (attempt > maxAttempts && options.force !== "true") {
    throw new Error(`${stepId} exhausted max attempts (${maxAttempts}); pass --force, --attempt, or --max-attempts to override.`);
  }
  if (attempt > maxAttempts) {
    maxAttempts = attempt;
  }

  const reviewers = expandReviewerInstances(reviewPlan);
  if (reviewers.length === 0) {
    throw new Error(`${stepId} review plan did not resolve any reviewers`);
  }
  const maxRounds = reviewMaxRoundsForStep(runtime.flow, reviewPlan);
  const repairProvider = reviewRepairProviderForStep(runtime.flow, step, reviewPlan);

  let status = "failed";
  let rawLogPath = join(runtime.stateDir, "runs", runId, "steps", stepId, "reviewers");
  let lastResult = null;
  let roundHistory = [];
  const headBeforeStep = currentHead(repo);
  clearStepCommitRecord({ stateDir: runtime.stateDir, runId, stepId });
  while (attempt <= maxAttempts) {
    const before = snapshotNoteTicketFiles({ repoPath: repo });
    updateRun(repo, { status: "running", current_step_id: stepId });
    let attemptState = {
      provider: step.provider,
      status: "running",
      pid: null,
      exitCode: null,
      finalMessage: null,
      stderr: "",
      timedOut: false,
      timeoutKind: null,
      signal: null,
      sessionId: null,
      resumeToken: null,
      rawLogPath,
      startedAt: new Date().toISOString(),
      lastEventAt: null
    };
    writeAttemptResult({
      stateDir: runtime.stateDir,
      runId,
      stepId,
      attempt,
      result: attemptState
    });
    appendProgressEvent({
      repoPath: repo,
      runId,
      stepId,
      attempt,
      type: "step_started",
      provider: "runtime",
      message: `${stepId} reviewer batch started`,
      payload: {
        reviewers: reviewers.map((reviewer) => ({ reviewerId: reviewer.reviewerId, provider: reviewer.provider || step.provider })),
        maxRounds,
        repairProvider
      }
    });
    roundHistory = [];
    let priorFindingsByReviewer = new Map();
    let materialized = null;
    for (let round = 1; round <= maxRounds; round += 1) {
      appendProgressEvent({
        repoPath: repo,
        runId,
        stepId,
        attempt,
        type: "review_round_started",
        provider: "runtime",
        message: `${stepId} review round ${round} started`,
        payload: { round, maxRounds, repairProvider }
      });

      const reviewerRuns = await Promise.all(reviewers.map((reviewer) =>
        executeReviewerRun({
          repo,
          runtime,
          step,
          reviewer,
          attempt,
          round,
          priorFindings: priorFindingsByReviewer.get(reviewer.reviewerId) ?? [],
          timeoutMs,
          idleTimeoutMs,
          options
        })
      ));
      const failedReviewer = reviewerRuns.find((reviewer) => reviewer.result.exitCode !== 0);
      const aggregate = failedReviewer
        ? null
        : aggregateReviewerOutputs({
            step,
            reviewPlan,
            reviewers: reviewerRuns
          });

      if (aggregate) {
        const aggregatePath = writeReviewRoundAggregate({
          stateDir: runtime.stateDir,
          runId,
          stepId,
          round,
          aggregate
        });
        appendProgressEvent({
          repoPath: repo,
          runId,
          stepId,
          attempt,
          type: "artifact",
          provider: "runtime",
          message: `review round ${round} aggregate ${aggregatePath}`,
          payload: { round, artifactPath: aggregatePath, status: aggregate.status }
        });
      }

      if (failedReviewer) {
        status = "failed";
        lastResult = {
          exitCode: failedReviewer.result.exitCode,
          finalMessage: `${failedReviewer.label} failed`,
          stderr: failedReviewer.result.stderr ?? "",
          timedOut: failedReviewer.result.timedOut === true,
          timeoutKind: failedReviewer.result.timeoutKind ?? null,
          signal: failedReviewer.result.signal ?? null
        };
        rawLogPath = failedReviewer.result.rawLogPath ?? rawLogPath;
        break;
      }
      if (aggregate?.status === "invalid_reviewer_output" || aggregate?.status === "missing_reviewer_output") {
        status = "failed";
        lastResult = {
          exitCode: 2,
          finalMessage: aggregate.summary,
          stderr: aggregate.summary,
          timedOut: false,
          timeoutKind: null,
          signal: null
        };
        break;
      }

      priorFindingsByReviewer = new Map(reviewerRuns.map((reviewerRun) => [
        reviewerRun.reviewerId,
        (reviewerRun.output?.findings ?? []).filter((finding) => ["critical", "major", "minor"].includes(finding.severity))
      ]));

      const roundRecord = {
        round,
        status: aggregate.status,
        summary: aggregate.summary,
        blockingFindings: aggregate.blockingFindings ?? aggregate.topFindings ?? [],
        repairSummary: null,
        verification: [],
        remainingRisks: []
      };
      roundHistory.push(roundRecord);

      if (reviewAccepted(aggregate)) {
        materialized = materializeAggregatedReview({
          repoPath: repo,
          runtime,
          step,
          reviewPlan,
          aggregate,
          rounds: roundHistory,
          commit: true
        });
        appendReviewMaterializedEvents({ repo, runId, stepId, attempt, materialized });
        appendProgressEvent({
          repoPath: repo,
          runId,
          stepId,
          attempt,
          type: "review_round_finished",
          provider: "runtime",
          message: `${stepId} review round ${round} passed`,
          payload: { round, status: aggregate.status }
        });
        status = "completed";
        lastResult = {
          exitCode: 0,
          finalMessage: aggregate.summary,
          stderr: "",
          timedOut: false,
          timeoutKind: null,
          signal: null
        };
        break;
      }

      if (round >= maxRounds) {
        materialized = materializeAggregatedReview({
          repoPath: repo,
          runtime,
          step,
          reviewPlan,
          aggregate,
          rounds: roundHistory,
          commit: true
        });
        appendReviewMaterializedEvents({ repo, runId, stepId, attempt, materialized });
        appendProgressEvent({
          repoPath: repo,
          runId,
          stepId,
          attempt,
          type: "review_round_limit",
          provider: "runtime",
          message: `${stepId} exhausted ${maxRounds} review rounds`,
          payload: { round, maxRounds, status: aggregate.status }
        });
        status = "blocked";
        lastResult = {
          exitCode: 3,
          finalMessage: `${stepId} exhausted ${maxRounds} review rounds`,
          stderr: aggregate.summary,
          timedOut: false,
          timeoutKind: null,
          signal: null
        };
        break;
      }

      const repair = await executeReviewRepair({
        repo,
        runtime,
        step,
        reviewPlan,
        aggregate,
        attempt,
        round,
        provider: repairProvider,
        timeoutMs,
        idleTimeoutMs,
        options
      });
      roundRecord.repairSummary = repair.output?.summary || repair.result.finalMessage || "";
      roundRecord.verification = repair.output?.verification ?? [];
      roundRecord.remainingRisks = repair.output?.remainingRisks ?? [];
      if (repair.result.exitCode !== 0) {
        status = "failed";
        lastResult = {
          exitCode: repair.result.exitCode,
          finalMessage: `${repairProvider} repair failed in round ${round}`,
          stderr: repair.result.stderr ?? "",
          timedOut: repair.result.timedOut === true,
          timeoutKind: repair.result.timeoutKind ?? null,
          signal: repair.result.signal ?? null
        };
        rawLogPath = repair.result.rawLogPath ?? rawLogPath;
        break;
      }
      if (!repair.output || repair.output.parseErrors?.length) {
        status = "failed";
        lastResult = {
          exitCode: 4,
          finalMessage: `repair output missing or invalid in round ${round}`,
          stderr: repair.output?.parseErrors?.join("\n") || "repair output missing",
          timedOut: false,
          timeoutKind: null,
          signal: null
        };
        rawLogPath = repair.result.rawLogPath ?? rawLogPath;
        break;
      }
      appendProgressEvent({
        repoPath: repo,
        runId,
        stepId,
        attempt,
        type: "review_round_finished",
        provider: "runtime",
        message: `${stepId} review round ${round} repaired; rerunning reviewers`,
        payload: { round, status: aggregate.status, verification: repair.output.verification ?? [] }
      });
    }

    writeAttemptResult({
      stateDir: runtime.stateDir,
      runId,
      stepId,
      attempt,
      result: {
        provider: step.provider,
        status,
        pid: lastResult?.pid ?? attemptState.pid ?? null,
        exitCode: lastResult?.exitCode ?? null,
        finalMessage: lastResult?.finalMessage ?? null,
        stderr: lastResult?.stderr ?? "",
        timedOut: lastResult?.timedOut === true,
        timeoutKind: lastResult?.timeoutKind ?? null,
        signal: lastResult?.signal ?? null,
        sessionId: null,
        resumeToken: null,
        rawLogPath,
        startedAt: attemptState.startedAt,
        lastEventAt: new Date().toISOString(),
        finishedAt: new Date().toISOString()
      }
    });
    appendProgressEvent({
      repoPath: repo,
      runId,
      stepId,
      attempt,
      type: "step_finished",
      provider: "runtime",
      message: `${stepId} ${status}`,
      payload: {
        exitCode: lastResult?.exitCode ?? null,
        rawLogPath,
        finalMessage: lastResult?.finalMessage ?? null,
        stderr: lastResult?.stderr ?? ""
      }
    });
    const patchProposal = captureNoteTicketPatchProposal({
      repoPath: repo,
      stateDir: runtime.stateDir,
      runId,
      stepId,
      attempt,
      before
    });
    if (patchProposal.status === "written") {
      appendProgressEvent({
        repoPath: repo,
        runId,
        stepId,
        attempt,
        type: "artifact",
        provider: "runtime",
        message: `note/ticket patch proposal ${patchProposal.artifactPath}`,
        payload: patchProposal
      });
    }
    if (status === "completed") {
      const stepCommit = writeStepCommitRecord({
        repoPath: repo,
        stateDir: runtime.stateDir,
        runId,
        stepId,
        beforeCommit: headBeforeStep
      });
      if (stepCommit) {
        appendProgressEvent({
          repoPath: repo,
          runId,
          stepId,
          attempt,
          type: "artifact",
          provider: "runtime",
          message: `step commit ${stepCommit.short_commit}`,
          payload: { artifactPath: stepCommit.artifactPath, stepCommit }
        });
      }
    }
    if (status === "completed" || status === "blocked" || attempt >= maxAttempts) {
      break;
    }
    const delayMs = retryDelayMs(options, attempt);
    appendProgressEvent({
      repoPath: repo,
      runId,
      stepId,
      attempt,
      type: "retry",
      provider: "runtime",
      message: `retrying reviewer batch attempt ${attempt + 1} after ${delayMs}ms`,
      payload: {
        nextAttempt: attempt + 1,
        maxAttempts,
        delayMs,
        exitCode: lastResult?.exitCode ?? null,
        timedOut: lastResult?.timedOut === true,
        timeoutKind: lastResult?.timeoutKind ?? null
      }
    });
    await sleep(delayMs);
    attempt += 1;
  }

  updateRun(repo, { status: status === "completed" ? "running" : status, current_step_id: stepId });
  const failureSummary = status === "completed"
    ? null
    : status === "blocked"
      ? createReviewRoundLimitSummary({
          repo,
          runtime: requireRuntime(repo),
          step,
          attempt,
          maxAttempts,
          maxRounds,
          reviewContext: summarizeReviewRounds(roundHistory),
          message: `${stepId} reached ${maxRounds} review rounds without satisfying ${reviewPlan.passWhen?.[0] ?? "the review pass condition"}.`
        })
      : createProviderFailureSummary({
          repo,
          runtime: requireRuntime(repo),
          step,
          attempt,
          maxAttempts,
          rawLogPath,
          result: lastResult,
          reviewContext: step.mode === "review" ? summarizePartialReviewContext(loadReviewerOutputsForStepRound({
            stateDir: runtime.stateDir,
            runId: runtime.run.id,
            stepId,
            round: roundHistory.length > 0 ? roundHistory[roundHistory.length - 1].round : null
          })) : null
        });
  syncStepUiRuntime({
    repo,
    stepId,
    nextCommands: status === "completed"
      ? [runNextCommand(repo)]
      : status === "blocked"
        ? blockedStopCommands(repo, stepId)
        : [statusCommand(repo), assistOpenCommand(repo, stepId), resumeCommand(repo)]
  });
  return {
    status,
    attempt,
    maxAttempts,
    rawLogPath,
    stepId,
    provider: step.provider,
    result: lastResult,
    failureSummary
  };
}

async function executeReviewerRun({ repo, runtime, step, reviewer, attempt, round, priorFindings, timeoutMs, idleTimeoutMs, options }) {
  const promptArtifact = writeReviewerPromptArtifact({
    repoPath: repo,
    stateDir: runtime.stateDir,
    run: runtime.run,
    flow: runtime.flow,
    stepId: step.id,
    reviewer,
    round,
    priorFindings
  });
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    attempt,
    type: "artifact",
    provider: "runtime",
    message: `reviewer prompt ${promptArtifact.artifactPath}`,
    payload: { reviewerId: reviewer.reviewerId, artifactPath: promptArtifact.artifactPath, round }
  });
  const provider = reviewer.provider || step.provider;
  const rawLogPath = join(reviewRoundReviewerAttemptDir({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    round,
    reviewerId: reviewer.reviewerId,
    attempt
  }), `${provider}.raw.jsonl`);

  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    attempt,
    type: "reviewer_started",
    provider,
    message: `${reviewer.label} started`,
    payload: { reviewerId: reviewer.reviewerId, provider, round }
  });

  let reviewerAttemptState = {
    round,
    provider,
    status: "running",
    pid: null,
    exitCode: null,
    finalMessage: null,
    stderr: "",
    timedOut: false,
    timeoutKind: null,
    signal: null,
    rawLogPath,
    startedAt: new Date().toISOString(),
    finishedAt: null
  };
  writeReviewerAttemptResult({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    reviewerId: reviewer.reviewerId,
    attempt,
    result: reviewerAttemptState
  });

  const result = await runProviderInvocation({
    provider,
    cwd: repo,
    prompt: promptArtifact.body,
    rawLogPath,
    timeoutMs,
    idleTimeoutMs,
    options,
    disableSlashCommands: provider === "claude",
    settingSources: provider === "claude" ? "user" : null,
    onSpawn({ pid }) {
      reviewerAttemptState = {
        ...reviewerAttemptState,
        pid: pid ?? null
      };
      writeReviewerAttemptResult({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId: step.id,
        reviewerId: reviewer.reviewerId,
        attempt,
        result: reviewerAttemptState
      });
    },
    onEvent(event) {
      appendProgressEvent({
        repoPath: repo,
        runId: runtime.run.id,
        stepId: step.id,
        attempt,
        type: `reviewer_${event.type}`,
        provider,
        message: `${reviewer.label}: ${event.message}`,
        payload: {
          reviewerId: reviewer.reviewerId,
          round,
          sessionId: event.sessionId ?? null,
          finalMessage: event.finalMessage ?? null,
          event: event.payload ?? {}
        }
      });
    }
  });
  writeReviewerAttemptResult({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    reviewerId: reviewer.reviewerId,
    attempt,
    result: {
      round,
      provider,
      status: result.exitCode === 0 ? "completed" : "failed",
      pid: result.pid ?? reviewerAttemptState.pid ?? null,
      exitCode: result.exitCode,
      finalMessage: result.finalMessage,
      stderr: result.stderr,
      timedOut: result.timedOut === true,
      timeoutKind: result.timeoutKind ?? null,
      signal: result.signal ?? null,
      rawLogPath,
      finishedAt: new Date().toISOString()
    }
  });

  const output = result.exitCode === 0
    ? loadReviewerOutput({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId: step.id,
        reviewerId: reviewer.reviewerId,
        round
      })
    : null;
  if (output) {
    writeLatestReviewerOutputMirror({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId: step.id,
      reviewerId: reviewer.reviewerId,
      output: {
        status: output.status,
        summary: output.summary,
        findings: output.findings,
        notes: output.notes
      }
    });
  }

  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    attempt,
    type: "reviewer_finished",
    provider,
    message: `${reviewer.label} ${result.exitCode === 0 ? "completed" : "failed"}`,
    payload: {
      reviewerId: reviewer.reviewerId,
      round,
      provider,
      exitCode: result.exitCode,
      outputPath: reviewRoundReviewerOutputPath({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId: step.id,
        round,
        reviewerId: reviewer.reviewerId
      })
    }
  });

  return {
    ...reviewer,
    provider,
    round,
    result: {
      ...result,
      rawLogPath
    },
    output
  };
}

async function executeReviewRepair({ repo, runtime, step, reviewPlan, aggregate, attempt, round, provider, timeoutMs, idleTimeoutMs, options }) {
  const promptArtifact = writeReviewRepairPromptArtifact({
    repoPath: repo,
    stateDir: runtime.stateDir,
    run: runtime.run,
    flow: runtime.flow,
    stepId: step.id,
    reviewPlan,
    aggregate,
    round,
    provider
  });
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    attempt,
    type: "artifact",
    provider: "runtime",
    message: `review repair prompt ${promptArtifact.artifactPath}`,
    payload: { round, provider, artifactPath: promptArtifact.artifactPath }
  });

  const rawLogPath = join(reviewRoundDir({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    round
  }), `${provider}.raw.jsonl`);
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    attempt,
    type: "review_repair_started",
    provider,
    message: `${step.id} repair round ${round} started`,
    payload: { round, provider }
  });

  let repairAttemptState = {
    provider,
    round,
    status: "running",
    pid: null,
    exitCode: null,
    finalMessage: null,
    stderr: "",
    timedOut: false,
    timeoutKind: null,
    signal: null,
    rawLogPath,
    startedAt: new Date().toISOString(),
    finishedAt: null
  };
  writeReviewRepairResult({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    round,
    result: repairAttemptState
  });

  const result = await runProviderInvocation({
    provider,
    cwd: repo,
    prompt: promptArtifact.body,
    rawLogPath,
    timeoutMs,
    idleTimeoutMs,
    options,
    disableSlashCommands: provider === "claude",
    settingSources: provider === "claude" ? "user" : null,
    onSpawn({ pid }) {
      repairAttemptState = {
        ...repairAttemptState,
        pid: pid ?? null
      };
      writeReviewRepairResult({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId: step.id,
        round,
        result: repairAttemptState
      });
    },
    onEvent(event) {
      appendProgressEvent({
        repoPath: repo,
        runId: runtime.run.id,
        stepId: step.id,
        attempt,
        type: `review_repair_${event.type}`,
        provider,
        message: `${step.id} repair round ${round}: ${event.message}`,
        payload: {
          round,
          sessionId: event.sessionId ?? null,
          finalMessage: event.finalMessage ?? null,
          event: event.payload ?? {}
        }
      });
    }
  });

  const resultPath = writeReviewRepairResult({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    round,
    result: {
      provider,
      pid: result.pid ?? repairAttemptState.pid ?? null,
      status: result.exitCode === 0 ? "completed" : "failed",
      exitCode: result.exitCode,
      finalMessage: result.finalMessage,
      stderr: result.stderr,
      timedOut: result.timedOut === true,
      timeoutKind: result.timeoutKind ?? null,
      signal: result.signal ?? null,
      rawLogPath,
      finishedAt: new Date().toISOString()
    }
  });
  const output = result.exitCode === 0
    ? loadReviewRepairOutput({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId: step.id,
        round
      })
    : null;
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    attempt,
    type: "review_repair_finished",
    provider,
    message: `${step.id} repair round ${round} ${result.exitCode === 0 ? "completed" : "failed"}`,
    payload: {
      round,
      provider,
      exitCode: result.exitCode,
      resultPath,
      outputPath: reviewRepairOutputPath({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId: step.id,
        round
      })
    }
  });
  return {
    provider,
    result: {
      ...result,
      rawLogPath
    },
    output
  };
}

async function runProviderInvocation({
  provider,
  cwd,
  prompt,
  rawLogPath,
  timeoutMs,
  idleTimeoutMs,
  options,
  onEvent,
  onSpawn = () => {},
  resume = null,
  forceBareClaude = false,
  disableSlashCommands = false,
  settingSources = null
}) {
  if (provider === "codex") {
    return runCodex({
      cwd,
      prompt,
      rawLogPath,
      bypass: options.bypass !== "false",
      model: options.model ?? null,
      resume,
      timeoutMs,
      idleTimeoutMs,
      killGraceMs: providerKillGraceMs(options),
      onSpawn,
      onEvent
    });
  }
  return runClaude({
    cwd,
    prompt,
    rawLogPath,
    bare: forceBareClaude || options.bare === "true",
    disableSlashCommands,
    settingSources,
    includePartialMessages: options["include-partial-messages"] === "true",
    model: options.model ?? null,
    permissionMode: options["permission-mode"] ?? (options.bypass !== "false" ? "bypassPermissions" : "acceptEdits"),
    resume,
    timeoutMs,
    idleTimeoutMs,
    killGraceMs: providerKillGraceMs(options),
    onSpawn,
    onEvent
  });
}

function materializeJudgementFromUiOutput({ repo, runtime, step, providerResult }) {
  const defaultKind = defaultJudgementKind(step.id);
  if (!defaultKind || !runtime.run?.id) {
    return null;
  }
  const existing = loadJudgements({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id
  });
  if (existing.some((item) => item.kind === defaultKind)) {
    return null;
  }
  const uiOutput = loadStepUiOutput({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id
  });
  if (uiOutput?.parseErrors?.length) {
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId: step.id,
      type: "warning",
      provider: "runtime",
      message: `ui-output parse recovered with ${uiOutput.parseErrors.length} error(s)`,
      payload: {
        artifactPath: uiOutput.artifactPath,
        parseErrors: uiOutput.parseErrors
      }
    });
  }
  const judgement = judgementFromUiOutput(step.id, uiOutput);
  if (!judgement) {
    return null;
  }
  const summary = judgement.summary || uiOutput?.notes || providerResult?.finalMessage || "";
  const result = writeJudgement({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    kind: judgement.kind,
    status: judgement.status,
    summary,
    source: `${step.provider}:ui-output`,
    details: {
      provider: step.provider,
      notes: uiOutput?.notes || null
    }
  });
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    type: "artifact",
    provider: "runtime",
    message: `judgement ${result.judgement.kind}: ${result.judgement.status}`,
    payload: { artifactPath: result.artifactPath, judgement: result.judgement }
  });
  return result;
}

function hydrateStepArtifactsBeforeGuards({ repo, runtime, step }) {
  materializeJudgementFromUiOutput({
    repo,
    runtime,
    step,
    providerResult: null
  });
}

function evaluateCurrentGuards({ repo, runtime, step, gate = null }) {
  const uiOutput = runtime.run.id ? loadStepUiOutput({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }) : null;
  const stepCommit = runtime.run.id ? loadStepCommitRecord({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }) : null;
  const latestAttempt = step.provider === "runtime"
    ? null
    : latestAttemptResult({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id, provider: step.provider });
  const guardResults = evaluateStepGuards(runtime.flow, step.id, {
    repoPath: repo,
    artifacts: collectGuardArtifacts(runtime, step.id),
    judgements: runtime.run.id ? loadJudgements({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }) : [],
    uiOutput,
    latestAttempt,
    stepCommit,
    humanDecision: gate?.decision ?? null,
    ticketClosed: false
  });
  for (const result of guardResults) {
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId: step.id,
      type: result.status === "failed" ? "guard_failed" : "guard_finished",
      provider: "runtime",
      message: `${result.guardId}: ${result.status}`,
      payload: result
    });
  }
  return guardResults;
}

function advanceRun({ repo, runtime, step, outcome }) {
  const target = nextStep(runtime.flow, runtime.run.flow_variant, step.id, outcome);
  if (!target) {
    throw new Error(`No transition from ${step.id} for ${outcome}`);
  }
  const commit = latestStepCommit(repo, step.id);
  appendStepHistoryEntry(repo, {
    stepId: step.id,
    status: outcome,
    commit: commit ?? "-",
    summary: target === "COMPLETE" ? "Reached flow completion" : `Advanced to ${target}`
  });

  if (target === "COMPLETE") {
    syncStepUiRuntime({ repo, stepId: step.id, nextCommands: [] });
    finalizeCompletedRun({ repo, runtime, step });
    return { status: "completed", from: step.id, to: target, outcome };
  }

  resetTransitionArtifacts({
    runtime,
    currentStepId: step.id,
    targetStepId: target
  });
  updateRun(repo, { status: "running", current_step_id: target });
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    type: "status",
    provider: "runtime",
    message: `[${step.id}] -> [${target}]`,
    payload: { outcome, target }
  });
  syncStepUiRuntime({ repo, stepId: step.id, nextCommands: [runNextCommand(repo)] });
  syncStepUiRuntime({ repo, stepId: target, nextCommands: [runNextCommand(repo)] });
  return { status: "advanced", from: step.id, to: target, outcome };
}

function rerunFromStep({ repo, runtime, step, targetStepId, reason = null }) {
  resetTransitionArtifacts({
    runtime,
    currentStepId: step.id,
    targetStepId
  });
  updateRun(repo, { status: "running", current_step_id: targetStepId });
  appendStepHistoryEntry(repo, {
    stepId: step.id,
    status: "assist_rerun_from",
    commit: latestStepCommit(repo, step.id) ?? "-",
    summary: `Accepted assist recommendation to rerun from ${targetStepId}${reason ? `: ${reason}` : ""}`
  });
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    type: "status",
    provider: "runtime",
    message: `[${step.id}] -> [${targetStepId}] (assist rerun)`,
    payload: {
      outcome: "assist_rerun_from",
      target: targetStepId,
      reason
    }
  });
  syncStepUiRuntime({ repo, stepId: step.id, nextCommands: [runNextCommand(repo)] });
  syncStepUiRuntime({ repo, stepId: targetStepId, nextCommands: [runNextCommand(repo)] });
  return {
    status: "advanced",
    from: step.id,
    to: targetStepId,
    outcome: "assist_rerun_from"
  };
}

function resetTransitionArtifacts({ runtime, currentStepId, targetStepId }) {
  const sequence = runtime.flow.variants?.[runtime.run.flow_variant]?.sequence ?? [];
  const currentIndex = sequence.indexOf(currentStepId);
  const targetIndex = sequence.indexOf(targetStepId);
  if (currentIndex >= 0 && targetIndex >= 0 && targetIndex <= currentIndex) {
    for (let index = targetIndex; index <= currentIndex; index += 1) {
      resetStepArtifacts({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId: sequence[index]
      });
    }
    return;
  }
  resetStepArtifacts({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: targetStepId
  });
}

function finalizeCompletedRun({ repo, runtime, step }) {
  const runId = runtime.run.id;
  appendStepHistoryEntry(repo, {
    stepId: "CLEANUP",
    status: "local_artifacts_removed",
    commit: "-",
    summary: `Removed .pdh-flowchart/runs/${runId} before close`
  });
  cleanupRunArtifacts({ repoPath: repo, runId });
  let closeResult = { status: "skipped", reason: "ticket.sh not found" };
  if (existsSync(join(repo, "ticket.sh"))) {
    closeResult = ticketClose({ repoPath: repo });
    appendStepHistoryEntry(repo, {
      stepId: "PD-C-10",
      status: "ticket_closed",
      commit: "-",
      summary: "Ran ticket.sh close"
    });
  }
  const note = loadCurrentNote(repo);
  saveCurrentNote(repo, {
    ...note,
    pdh: {
      ...note.pdh,
      status: "completed",
      current_step: step.id,
      run_id: null,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    }
  });
  if (closeResult.status === "ok") {
    console.log(`ticket.sh close: ${firstLine(closeResult.stdout || closeResult.stderr || "ok")}`);
  }
}

function ensureGateSummary({ repo, runtime, step }) {
  const existing = latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id });
  if (existing?.summary && existsSync(existing.summary)) {
    return { artifactPath: existing.summary, body: readFileSync(existing.summary, "utf8") };
  }
  const gateContext = deriveHumanGateContext({ repo, runtime, step, existingGate: existing });
  const summary = createGateSummary({
    repoPath: repo,
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    gate: gateContext
  });
  openHumanGate({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    prompt: step.human_gate?.prompt ?? `${step.id} human gate`,
    summary: summary.artifactPath,
    baseline: gateContext.baseline,
    rerunRequirement: gateContext.rerun_requirement
  });
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    type: "artifact",
    provider: "runtime",
    message: `human gate summary ${summary.artifactPath}`,
    payload: { artifactPath: summary.artifactPath }
  });
  return summary;
}

function refreshGateSummary({ repo, runtime, step }) {
  const existing = latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id });
  const gateContext = deriveHumanGateContext({ repo, runtime, step, existingGate: existing });
  const summary = createGateSummary({
    repoPath: repo,
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    gate: gateContext
  });
  openHumanGate({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    prompt: step.human_gate?.prompt ?? `${step.id} human gate`,
    summary: summary.artifactPath,
    baseline: gateContext.baseline,
    rerunRequirement: gateContext.rerun_requirement
  });
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    type: "artifact",
    provider: "runtime",
    message: `human gate summary refreshed ${summary.artifactPath}`,
    payload: { artifactPath: summary.artifactPath }
  });
  return summary;
}

function collectGuardArtifacts(runtime, stepId) {
  const stepPath = stepDir(runtime.stateDir, runtime.run.id, stepId);
  return [
    { kind: "human_gate_summary", path: join(stepPath, "human-gate-summary.md") },
    { kind: "step_commit", path: join(stepPath, "step-commit.json") },
    ...loadJudgements({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId }).map((judgement) => ({
      kind: judgement.kind,
      path: judgement.artifactPath
    }))
  ];
}

function writePromptArtifact({ repo, runtime, stepId }) {
  const prompt = writeStepPrompt({ repoPath: repo, stateDir: runtime.stateDir, run: runtime.run, flow: runtime.flow, stepId });
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId,
    type: "artifact",
    provider: "runtime",
    message: `prompt generated ${prompt.artifactPath}`,
    payload: { artifactPath: prompt.artifactPath }
  });
  return prompt.artifactPath;
}

function describeGuardFailureMessage(failedGuards) {
  if (!failedGuards?.length) {
    return null;
  }
  if (failedGuards.length > 1) {
    return `Multiple required checks are still incomplete. Start with: ${failedGuards[0].guardId} — ${failedGuards[0].evidence}`;
  }
  const [guard] = failedGuards;
  if (guard.type === "judgement_status" && /ui-output\.yaml has parse errors/i.test(guard.evidence || "")) {
    return `The provider finished, but the guard-facing judgement could not be materialized because ui-output.yaml is malformed. Re-run \`run-next\`; if it repeats, inspect ui-output.yaml and the step prompt.`;
  }
  if (guard.type === "judgement_status" && /present in ui-output\.yaml/i.test(guard.evidence || "")) {
    return `The provider wrote a review judgement into ui-output.yaml, but the runtime judgement artifact is missing. Re-run \`run-next\`; if it repeats, inspect ui-output.yaml and judgements/.`;
  }
  if (guard.type === "judgement_status" && /provider step completed/i.test(guard.evidence || "")) {
    return `The provider step completed, but the review evidence needed by the guard is still missing. Inspect ui-output.yaml and judgements/ before retrying.`;
  }
  return `${guard.guardId} is still incomplete: ${guard.evidence}`;
}

function createFailureSummaryForBlock({ repo, runtime, step, failedGuards, message = null }) {
  const summary = writeFailureSummary({
    stateDir: runtime.stateDir,
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    reason: "guard_failed",
    provider: step.provider,
    status: "blocked",
    failedGuards,
    message,
    nextCommands: [statusCommand(repo), runNextCommand(repo)]
  });
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    type: "artifact",
    provider: "runtime",
    message: `failure summary ${summary.artifactPath}`,
    payload: { artifactPath: summary.artifactPath, reason: "guard_failed" }
  });
  return summary;
}

function createProviderFailureSummary({ repo, runtime, step, attempt, maxAttempts, rawLogPath, result, reviewContext = null }) {
  const reviewMessage = providerFailureDiagnosis({ step, result, reviewContext });
  const summary = writeFailureSummary({
    stateDir: runtime.stateDir,
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    reason: result?.timedOut ? "provider_timeout" : "provider_failed",
    provider: step.provider,
    status: "failed",
    attempt,
    maxAttempts,
    exitCode: result?.exitCode ?? null,
    timedOut: result?.timedOut === true,
    timeoutKind: result?.timeoutKind ?? null,
    signal: result?.signal ?? null,
    rawLogPath,
    finalMessage: result?.finalMessage ?? null,
    stderr: result?.stderr ?? null,
    reviewContext,
    message: reviewMessage,
    nextCommands: [statusCommand(repo), assistOpenCommand(repo, step.id), resumeCommand(repo)]
  });
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    attempt,
    type: "artifact",
    provider: "runtime",
    message: `failure summary ${summary.artifactPath}`,
    payload: { artifactPath: summary.artifactPath }
  });
  return summary;
}

function createReviewRoundLimitSummary({ repo, runtime, step, attempt, maxAttempts, maxRounds, reviewContext = null, message = null }) {
  const summary = writeFailureSummary({
    stateDir: runtime.stateDir,
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    reason: "review_rounds_exhausted",
    provider: step.provider,
    status: "blocked",
    attempt,
    maxAttempts,
    reviewContext,
    message: message ?? `${step.id} exhausted ${maxRounds} review rounds.`,
    nextCommands: blockedStopCommands(repo, step.id)
  });
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    attempt,
    type: "artifact",
    provider: "runtime",
    message: `failure summary ${summary.artifactPath}`,
    payload: { artifactPath: summary.artifactPath, reason: "review_rounds_exhausted" }
  });
  return summary;
}

function providerFailureDiagnosis({ step, result, reviewContext }) {
  const finalMessage = String(result?.finalMessage || "");
  const stderr = String(result?.stderr || "");
  if (step.mode === "review" && step.provider === "claude" && /not logged in/i.test(finalMessage)) {
    return "Claude reviewer subprocess failed in non-interactive bare-style startup. Interactive Claude may still work, but reviewer automation needs the non-bare path. Re-run this step after the runtime update or investigate `claude -p` versus `claude --bare -p` behavior.";
  }
  if (step.mode === "review" && /authentication_failed/i.test(stderr)) {
    return "Claude reviewer subprocess could not authenticate in its current launch mode. Compare the working `claude -p ...` path with the failing reviewer path before retrying.";
  }
  if (reviewContext?.topFindings?.[0]) {
    return `Completed reviewer findings are still available. First unresolved issue: ${reviewContext.topFindings[0].title}`;
  }
  return null;
}

function summarizePartialReviewContext(reviewers) {
  const completedReviewers = reviewers
    .filter((reviewer) => reviewer?.output)
    .map((reviewer) => ({
      reviewerId: reviewer.reviewerId,
      label: reviewer.label || reviewer.reviewerId,
      provider: reviewer.provider || "",
      status: reviewer.output.status || "",
      summary: reviewer.output.summary || ""
    }));
  const findings = reviewers.flatMap((reviewer) =>
    (reviewer?.output?.findings ?? []).map((finding) => ({
      ...finding,
      reviewerId: reviewer.reviewerId,
      reviewerLabel: reviewer.label || reviewer.reviewerId
    }))
  );
  const topFindings = findings.filter((finding) => ["critical", "major"].includes(finding.severity));
  if (!completedReviewers.length && !topFindings.length) {
    return null;
  }
  return {
    completedReviewers,
    topFindings
  };
}

function summarizeReviewRounds(roundHistory) {
  if (!roundHistory.length) {
    return null;
  }
  const latest = roundHistory[roundHistory.length - 1];
  return {
    completedReviewers: [],
    topFindings: latest.blockingFindings ?? [],
    rounds: roundHistory.map((round) => ({
      round: round.round,
      status: round.status,
      summary: round.summary
    }))
  };
}

function appendReviewMaterializedEvents({ repo, runId, stepId, attempt, materialized }) {
  appendProgressEvent({
    repoPath: repo,
    runId,
    stepId,
    attempt,
    type: "artifact",
    provider: "runtime",
    message: `aggregated review ui-output ${materialized.uiOutputPath}`,
    payload: { artifactPath: materialized.uiOutputPath }
  });
  if (materialized.judgement) {
    appendProgressEvent({
      repoPath: repo,
      runId,
      stepId,
      attempt,
      type: "artifact",
      provider: "runtime",
      message: `judgement ${materialized.judgement.judgement.kind}: ${materialized.judgement.judgement.status}`,
      payload: { artifactPath: materialized.judgement.artifactPath, judgement: materialized.judgement.judgement }
    });
  }
  appendProgressEvent({
    repoPath: repo,
    runId,
    stepId,
    attempt,
    type: "artifact",
    provider: "runtime",
    message: `review note updated ${materialized.noteSection}`,
    payload: { section: materialized.noteSection }
  });
  appendProgressEvent({
    repoPath: repo,
    runId,
    stepId,
    attempt,
    type: "commit",
    provider: "runtime",
    message: materialized.commit.message ?? `${stepId} commit ${materialized.commit.status}`,
    payload: materialized.commit
  });
}

function reviewMaxRoundsForStep(flow, reviewPlan) {
  return positiveInteger(reviewPlan?.maxRounds ?? flow.defaults?.reviewMaxRounds ?? 6, "reviewMaxRounds");
}

function reviewRepairProviderForStep(flow, step, reviewPlan) {
  return reviewPlan?.repairProvider || flow.defaults?.reviewRepairProvider || step.provider;
}

function printProviderResult({ repo, runtime, step, result, options, trace = [] }) {
  if (options.json === "true") {
    console.log(JSON.stringify({ ...result, trace }, null, 2));
    return;
  }
  console.log(`${step.id} ${result.status}`);
  console.log(`Attempt: ${result.attempt}/${result.maxAttempts}`);
  console.log(`Raw log: ${result.rawLogPath}`);
  if (result.status === "completed") {
    console.log(`Next: ${runNextCommand(repo)}`);
  } else {
    console.log(`Failure Summary: ${result.failureSummary.artifactPath}`);
    console.log(`Next: ${statusCommand(repo)}`);
    console.log(`Retry: ${resumeCommand(repo)}`);
  }
}

function printEvent(event, json = false) {
  if (json) {
    console.log(JSON.stringify(event));
    return;
  }
  const provider = event.provider ? ` ${event.provider}` : "";
  const message = event.message ? ` ${event.message}` : "";
  console.log(`${event.ts} ${event.stepId ?? "-"} ${event.type}${provider}${message}`);
}

function printBlocked(result, trace = [], options = {}) {
  if (options.json === "true") {
    console.log(JSON.stringify({ ...result, trace }, null, 2));
    return;
  }
  const step = result.stepId ? ` ${result.stepId}` : "";
  const reason = result.reason ? ` (${result.reason})` : "";
  const label = result.status === "failed" ? "Failed" : result.status === "interrupted" ? "Interrupted" : "Blocked";
  console.log(`${label}:${step}${reason}`);
  if (result.provider) {
    console.log(`Provider: ${result.provider}`);
  }
  const transitions = trace.filter((entry) => entry.status === "advanced");
  if (transitions.length > 0) {
    console.log(`Trace: ${transitions.map((entry) => `${entry.from} -> ${entry.to}`).join(", ")}`);
  }
  if (result.message) {
    console.log(`Message: ${result.message}`);
  }
  if (result.failedGuards?.length) {
    console.log("Failed Guards:");
    for (const guard of result.failedGuards) {
      console.log(`- ${guard.guardId}: ${guard.evidence}`);
    }
  }
  if (result.failureSummary) {
    console.log(`Failure Summary: ${result.failureSummary}`);
  }
  if (result.nextCommand) {
    console.log(`Next: ${result.nextCommand}`);
  }
  if (result.nextCommands?.length) {
    console.log("Next:");
    for (const commandText of result.nextCommands) {
      console.log(`- ${commandText}`);
    }
  }
  if (result.reason === "limit_reached") {
    console.log(`Limit: ${result.limit}`);
  }
}

function printStoppedAfterStep({ completedStepId, nextStep, repo, trace = [], options = {} }) {
  const result = {
    status: "stopped",
    reason: "stop_after_step",
    completedStepId,
    currentStepId: nextStep.id,
    nextCommand: runNextCommand(repo)
  };
  if (options.json === "true") {
    console.log(JSON.stringify({ ...result, trace }, null, 2));
    return;
  }
  console.log(`Stopped After Step: ${completedStepId} -> ${nextStep.id}`);
  console.log(`Current step: ${formatStepName(nextStep)}`);
  console.log(`Next: ${result.nextCommand}`);
}

function blockIfOpenInterruption({ repo, runtime, step, options }) {
  if (options.force === "true") {
    return null;
  }
  const interruption = latestOpenInterruption({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id });
  if (!interruption) {
    return null;
  }
  updateRun(repo, { status: "interrupted", current_step_id: step.id });
  const result = {
    status: "interrupted",
    stepId: step.id,
    reason: "needs_interrupt_answer",
    provider: step.provider,
    message: `Open interruption ${interruption.id} must be answered before ${step.id} continues.`,
    artifactPath: interruption.artifactPath,
    nextCommands: interruptStopCommands(repo, step.id)
  };
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    type: "interrupted",
    provider: "runtime",
    message: `${step.id} needs interrupt answer`,
    payload: result
  });
  syncStepUiRuntime({ repo, stepId: step.id, nextCommands: interruptStopCommands(repo, step.id) });
  return result;
}

function maybeStartTicket({ repo, ticket, required = false, runId, stepId }) {
  if (!ticket) {
    return;
  }
  if (!existsSync(join(repo, "ticket.sh"))) {
    if (required) {
      throw new Error("ticket.sh start required but ticket.sh was not found");
    }
    appendProgressEvent({
      repoPath: repo,
      runId,
      stepId,
      type: "status",
      provider: "runtime",
      message: "ticket.sh start skipped: ticket.sh not found",
      payload: { ticket }
    });
    return;
  }
  const result = ticketStart({ repoPath: repo, ticket });
  appendProgressEvent({
    repoPath: repo,
    runId,
    stepId,
    type: "tool_finished",
    provider: "runtime",
    message: `ticket.sh start ${ticket}`,
    payload: result
  });
}

function syncStepUiRuntime({ repo, stepId = null, guardResults = null, nextCommands = null }) {
  const runtime = loadRuntime(repo);
  if (!runtime.run?.id || !runtime.run.current_step_id) {
    return null;
  }
  const resolvedStepId = stepId ?? runtime.run.current_step_id;
  const step = getStep(runtime.flow, resolvedStepId);
  return writeStepUiRuntime({
    repoPath: repo,
    runtime,
    step,
    guardResults,
    nextCommands: nextCommands ?? defaultUiNextCommands({ repo, runtime, step })
  });
}

function defaultUiNextCommands({ repo, runtime, step }) {
  if (runtime.run.current_step_id !== step.id) {
    return [];
  }
  if (runtime.run.status === "needs_human" && isHumanGateStep(step)) {
    return humanStopCommands(repo, step.id);
  }
  if (runtime.run.status === "interrupted") {
    return interruptStopCommands(repo, step.id);
  }
  if (runtime.run.status === "blocked") {
    return blockedStopCommands(repo, step.id);
  }
  if (runtime.run.status === "failed") {
    return [statusCommand(repo), resumeCommand(repo)];
  }
  return [runNextCommand(repo)];
}

function requireRuntime(repo) {
  const runtime = loadRuntime(repo);
  if (!runtime.run?.current_step_id || !runtime.run?.flow_id) {
    throw new Error("No active run found in current-note.md");
  }
  return runtime;
}

async function withRuntimeLock({ repo, options = {}, action }) {
  const runtime = loadRuntime(repo);
  const runId = runtime.run?.id ?? "active";
  return await withRunLock({
    stateDir: defaultStateDir(repo),
    runId,
    waitMs: nonNegativeInteger(options["lock-wait-ms"] ?? process.env.PDH_FLOWCHART_LOCK_WAIT_MS ?? "0", "--lock-wait-ms"),
    staleMs: nonNegativeInteger(options["lock-stale-ms"] ?? process.env.PDH_FLOWCHART_LOCK_STALE_MS ?? String(12 * 60 * 60 * 1000), "--lock-stale-ms")
  }, action);
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const eq = token.indexOf("=");
    if (eq > 0) {
      options[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = "true";
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return number;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return number;
}

function providerMaxAttempts({ options, flow, step, startAttempt }) {
  if (options["max-attempts"] !== undefined) {
    return positiveInteger(options["max-attempts"], "--max-attempts");
  }
  if (options.attempt !== undefined) {
    return startAttempt;
  }
  return positiveInteger(step.maxAttempts ?? flow.defaults?.maxAttempts ?? 1, "maxAttempts");
}

function providerTimeoutMs({ options, flow, step }) {
  if (options["timeout-ms"] !== undefined) {
    return nonNegativeInteger(options["timeout-ms"], "--timeout-ms");
  }
  const minutes = step.timeoutMinutes ?? flow.defaults?.timeoutMinutes ?? null;
  if (minutes === null) {
    return null;
  }
  const number = Number(minutes);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error("provider timeoutMinutes must be a non-negative number");
  }
  return Math.round(number * 60 * 1000);
}

function providerIdleTimeoutMs({ options, flow, step }) {
  if (options["idle-timeout-ms"] !== undefined) {
    return nonNegativeInteger(options["idle-timeout-ms"], "--idle-timeout-ms");
  }
  const minutes = step.idleTimeoutMinutes ?? flow.defaults?.idleTimeoutMinutes ?? null;
  if (minutes === null || minutes === undefined) {
    return null;
  }
  const number = Number(minutes);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error("provider idleTimeoutMinutes must be a non-negative number");
  }
  return Math.round(number * 60 * 1000);
}

function providerKillGraceMs(options) {
  return nonNegativeInteger(options["kill-grace-ms"] ?? "5000", "--kill-grace-ms");
}

function retryDelayMs(options, attempt) {
  const baseMs = nonNegativeInteger(options["retry-backoff-ms"] ?? "1000", "--retry-backoff-ms");
  const maxMs = nonNegativeInteger(options["retry-backoff-max-ms"] ?? "30000", "--retry-backoff-max-ms");
  return Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt - 1)));
}

function resolveProviderResume({ runtime, stepId, provider, option, allowMissing = false }) {
  if (!option) {
    return null;
  }
  if (!["true", "latest", "last"].includes(option)) {
    return option;
  }
  const session = latestProviderSession({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId, provider });
  const token = session?.resume_token ?? session?.session_id ?? null;
  if (!token) {
    if (allowMissing) {
      return null;
    }
    throw new Error(`No saved ${provider} session for ${stepId}; cannot resume`);
  }
  return token;
}

function required(options, key) {
  if (!options[key]) {
    throw new Error(`Missing --${key}`);
  }
  return options[key];
}

function readMessageOption(options, commandName) {
  if (options.message !== undefined) {
    return options.message;
  }
  if (options.file) {
    return readFileSync(resolve(options.file), "utf8");
  }
  throw new Error(`${commandName} requires --message TEXT or --file FILE`);
}

function deriveHumanGateContext({ repo, runtime, step, existingGate = null }) {
  const baseline = humanGateBaseline({ repo, runtime, step, existingGate });
  const diff = gateBaselineDiff({ repo, baseline });
  const rerunRequirement = inferHumanGateRerunRequirement({
    stepId: step.id,
    changedFiles: diff.changedFiles,
    noteSections: diff.noteSections,
    ticketSections: diff.ticketSections
  });
  return {
    ...(existingGate ?? {}),
    baseline,
    rerun_requirement: rerunRequirement
  };
}

function humanGateBaseline({ repo, runtime, step, existingGate = null }) {
  if (existingGate?.baseline?.commit) {
    return existingGate.baseline;
  }
  const previousStepId = previousStepInVariant(runtime.flow, runtime.run.flow_variant, step.id);
  const previousStepCommit = previousStepId ? latestStepCommit(repo, previousStepId, { short: false }) : null;
  const headCommit = currentHead(repo);
  return {
    commit: previousStepCommit ?? headCommit ?? null,
    step_id: previousStepId ?? null,
    ref: previousStepCommit ? "step_commit" : (headCommit ? "head" : "working_tree"),
    captured_at: new Date().toISOString()
  };
}

function gateBaselineDiff({ repo, baseline }) {
  if (!baseline?.commit) {
    return { changedFiles: [], ticketSections: [], noteSections: [] };
  }
  const ticketDocPath = resolveCurrentDocPathAtCommit(repo, baseline.commit, "current-ticket.md");
  const noteDocPath = resolveCurrentDocPathAtCommit(repo, baseline.commit, "current-note.md");
  const ticketBefore = gitShowFile(repo, baseline.commit, ticketDocPath);
  const ticketAfter = readFileIfExists(join(repo, "current-ticket.md"));
  const noteBefore = stripPdhMetadata(gitShowFile(repo, baseline.commit, noteDocPath));
  const noteAfter = stripPdhMetadata(readFileIfExists(join(repo, "current-note.md")));
  const changedFiles = normalizeGateChangedFiles(repo, splitLines(runGit(repo, ["diff", "--name-only", baseline.commit, "--"]).stdout));
  return {
    changedFiles,
    ticketSections: changedMarkdownSections(ticketBefore, ticketAfter),
    noteSections: changedMarkdownSections(noteBefore, noteAfter, { ignoreSections: new Set(["Step History"]) })
  };
}

function inferHumanGateRerunRequirement({ stepId, changedFiles, noteSections, ticketSections }) {
  const files = Array.isArray(changedFiles) ? changedFiles : [];
  const note = Array.isArray(noteSections) ? noteSections : [];
  const ticket = Array.isArray(ticketSections) ? ticketSections : [];
  const signalFiles = files.filter((path) => !["current-note.md", "current-ticket.md"].includes(path));
  if (signalFiles.length === 0 && note.length === 0 && ticket.length === 0) {
    return null;
  }
  if (stepId === "PD-C-5") {
    if (note.some((section) => ["PD-C-2. 調査結果", "Discoveries"].includes(section))) {
      return rerunRequirement("PD-C-2", "gate edits changed investigation evidence", files, ticket, note);
    }
    if (ticket.some((section) => ["Why", "What", "Product AC", "Implementation Notes"].includes(section))
      || note.includes("PD-C-3. 計画")) {
      return rerunRequirement("PD-C-3", "gate edits changed ticket intent or implementation plan", files, ticket, note);
    }
    if (signalFiles.length > 0 || note.includes("PD-C-4. 計画レビュー結果")) {
      return rerunRequirement("PD-C-4", "gate edits changed reviewable material before implementation starts", files, ticket, note);
    }
    return null;
  }
  if (stepId === "PD-C-10") {
    if (signalFiles.length > 0) {
      return rerunRequirement("PD-C-7", "gate edits changed implementation or tests after review", files, ticket, note);
    }
    if (ticket.some((section) => ["Why", "What", "Product AC", "Implementation Notes"].includes(section))
      || note.some((section) => ["PD-C-7. 品質検証結果", "PD-C-8. 目的妥当性確認"].includes(section))) {
      return rerunRequirement("PD-C-7", "gate edits changed review or product-validity evidence", files, ticket, note);
    }
    if (note.some((section) => ["PD-C-9. プロセスチェックリスト", "AC 裏取り結果"].includes(section))) {
      return rerunRequirement("PD-C-9", "gate edits changed final verification evidence", files, ticket, note);
    }
  }
  return null;
}

function rerunRequirement(targetStepId, reason, changedFiles, changedTicketSections, changedNoteSections) {
  return {
    target_step_id: targetStepId,
    reason,
    changed_files: changedFiles,
    changed_ticket_sections: changedTicketSections,
    changed_note_sections: changedNoteSections
  };
}

function changedMarkdownSections(beforeText, afterText, { ignoreSections = new Set() } = {}) {
  const before = markdownSections(beforeText, { ignoreSections });
  const after = markdownSections(afterText, { ignoreSections });
  const changed = [];
  const headings = new Set([...before.keys(), ...after.keys()]);
  for (const heading of headings) {
    if ((before.get(heading) ?? "").trim() !== (after.get(heading) ?? "").trim()) {
      changed.push(heading);
    }
  }
  return changed.sort();
}

function markdownSections(text, { ignoreSections = new Set() } = {}) {
  const body = String(text ?? "").replace(/\r\n/g, "\n");
  const map = new Map();
  const matches = [...body.matchAll(/^##\s+(.+)$/gm)];
  for (let index = 0; index < matches.length; index += 1) {
    const heading = matches[index][1].trim();
    if (ignoreSections.has(heading)) {
      continue;
    }
    const start = matches[index].index + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : body.length;
    map.set(heading, body.slice(start, end).trim());
  }
  return map;
}

function stripPdhMetadata(text) {
  const raw = String(text ?? "");
  const frontmatter = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return frontmatter ? raw.slice(frontmatter[0].length) : raw;
}

function resolveCurrentDocPathAtCommit(repo, commit, aliasPath) {
  if (gitFileExists(repo, commit, aliasPath)) {
    return aliasPath;
  }
  const targetPath = currentDocTargetPath(repo, aliasPath);
  if (targetPath && gitFileExists(repo, commit, targetPath)) {
    return targetPath;
  }
  return aliasPath;
}

function normalizeGateChangedFiles(repo, changedFiles) {
  const aliases = new Map();
  const noteTarget = currentDocTargetPath(repo, "current-note.md");
  const ticketTarget = currentDocTargetPath(repo, "current-ticket.md");
  if (noteTarget) {
    aliases.set(noteTarget, "current-note.md");
  }
  if (ticketTarget) {
    aliases.set(ticketTarget, "current-ticket.md");
  }
  return changedFiles.map((path) => aliases.get(path) ?? path);
}

function currentDocTargetPath(repo, aliasPath) {
  try {
    const target = readlinkSync(join(repo, aliasPath));
    return relative(repo, resolve(repo, target)).replaceAll("\\", "/");
  } catch {
    return null;
  }
}

function gitFileExists(repo, commit, relativePath) {
  return Boolean(runGit(repo, ["cat-file", "-e", `${commit}:${relativePath}`]));
}

function gitShowFile(repo, commit, relativePath) {
  return runGit(repo, ["show", `${commit}:${relativePath}`])?.stdout ?? "";
}

function readFileIfExists(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function previousStepInVariant(flow, variant, stepId) {
  const sequence = flow.variants?.[variant]?.sequence ?? [];
  const index = sequence.indexOf(stepId);
  return index > 0 ? sequence[index - 1] : null;
}

function assertRecommendationCompatibleWithGateEdits({ runtime, stepId, gate, recommendation }) {
  const requiredTargetStepId = gate?.rerun_requirement?.target_step_id;
  if (!requiredTargetStepId) {
    return;
  }
  if (recommendation.action !== "rerun_from") {
    if (recommendation.action === "reject") {
      return;
    }
    throw new Error(`${stepId} gate edits require rerun from ${requiredTargetStepId}: ${gate.rerun_requirement.reason}`);
  }
  const sequence = runtime.flow.variants?.[runtime.run.flow_variant]?.sequence ?? [];
  const requiredIndex = sequence.indexOf(requiredTargetStepId);
  const targetIndex = sequence.indexOf(recommendation.target_step_id);
  if (targetIndex < 0 || requiredIndex < 0) {
    return;
  }
  if (targetIndex > requiredIndex) {
    throw new Error(`${stepId} gate edits require rerun from ${requiredTargetStepId} or earlier, but the recommendation targets ${recommendation.target_step_id}. ${gate.rerun_requirement.reason}`);
  }
}

function latestStepCommit(repo, stepId, { short = true } = {}) {
  const result = runGit(repo, ["log", "--format=%H%x00%s", "-50"]);
  if (!result) {
    return null;
  }
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  const pattern = new RegExp(`^\\[${stepId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`);
  for (const line of lines) {
    const [hash, subject] = line.split("\0");
    if (pattern.test(subject)) {
      return short ? hash.slice(0, 7) : hash;
    }
  }
  return null;
}

function currentHead(repo) {
  return runGit(repo, ["rev-parse", "HEAD"])?.stdout.trim() || null;
}

function runGit(repo, args) {
  const result = spawnSync("git", args, { cwd: repo, text: true, encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  return result;
}

function splitLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function assertStepInVariant(flow, variant, stepId) {
  const sequence = flow.variants?.[variant]?.sequence ?? [];
  if (!sequence.includes(stepId)) {
    throw new Error(`${stepId} is not in ${variant} flow`);
  }
}

function assertCurrentStep(run, stepId, options = {}) {
  if (options.force === "true") {
    return;
  }
  if (run.current_step_id !== stepId) {
    throw new Error(`Current step is ${run.current_step_id}; refusing to operate on ${stepId}. Pass --force to override.`);
  }
}

function isHumanGateStep(step) {
  return step.provider === "runtime" && step.mode === "human" && Boolean(step.human_gate);
}

function formatStepName(step) {
  return step.label ? `${step.id} ${step.label}` : step.id;
}

function humanDecisionCommands(repo, stepId) {
  const repoArg = ` --repo ${shellQuote(repo)}`;
  return [
    `node src/cli.mjs approve${repoArg} --step ${stepId} --reason ok`,
    `node src/cli.mjs request-changes${repoArg} --step ${stepId} --reason "<reason>"`,
    `node src/cli.mjs reject${repoArg} --step ${stepId} --reason "<reason>"`
  ];
}

function humanStopCommands(repo, stepId) {
  return [showGateCommand(repo, stepId), assistOpenCommand(repo, stepId), ...humanDecisionCommands(repo, stepId)];
}

function recommendationCommands(repo, stepId) {
  const repoArg = ` --repo ${shellQuote(repo)}`;
  return [
    `node src/cli.mjs accept-recommendation${repoArg} --step ${stepId}`,
    `node src/cli.mjs decline-recommendation${repoArg} --step ${stepId} --reason "<reason>"`
  ];
}

function recommendedStopCommands(repo, stepId) {
  return [showGateCommand(repo, stepId), assistOpenCommand(repo, stepId), ...recommendationCommands(repo, stepId)];
}

function runNextCommand(repo) {
  return `node src/cli.mjs run-next --repo ${shellQuote(repo)}`;
}

function rerunCurrentStepCommand(repo) {
  return `node src/cli.mjs run-next --repo ${shellQuote(repo)} --force`;
}

function statusCommand(repo) {
  return `node src/cli.mjs status --repo ${shellQuote(repo)}`;
}

function assistOpenCommand(repo, stepId) {
  return `node src/cli.mjs assist-open --repo ${shellQuote(repo)} --step ${stepId}`;
}

function applyAssistSignalCommand(repo, stepId) {
  return `node src/cli.mjs apply-assist-signal --repo ${shellQuote(repo)} --step ${stepId}`;
}

function resumeCommand(repo) {
  return `node src/cli.mjs resume --repo ${shellQuote(repo)}`;
}

function showGateCommand(repo, stepId) {
  return `node src/cli.mjs show-gate --repo ${shellQuote(repo)} --step ${stepId}`;
}

function interruptAnswerCommands(repo, stepId) {
  return [
    `node src/cli.mjs show-interrupts --repo ${shellQuote(repo)} --step ${stepId}`,
    `node src/cli.mjs answer --repo ${shellQuote(repo)} --step ${stepId} --message "<answer>"`
  ];
}

function interruptStopCommands(repo, stepId) {
  return [
    `node src/cli.mjs show-interrupts --repo ${shellQuote(repo)} --step ${stepId}`,
    assistOpenCommand(repo, stepId),
    `node src/cli.mjs answer --repo ${shellQuote(repo)} --step ${stepId} --message "<answer>"`
  ];
}

function blockedStopCommands(repo, stepId) {
  return [
    assistOpenCommand(repo, stepId),
    runNextCommand(repo)
  ];
}

function nextProviderCommand(repo) {
  return `node src/cli.mjs run-provider --repo ${shellQuote(repo)}`;
}

function buildAssistClaudeArgs({ prepared, model = null, bare = false }) {
  const args = [
    "--append-system-prompt",
    prepared.systemPrompt,
    "--setting-sources",
    "user",
    "--permission-mode",
    "bypassPermissions",
    "-n",
    `pdh-assist:${prepared.manifest.step.id}`
  ];
  if (bare) {
    args.unshift("--bare");
  }
  if (model) {
    args.push("--model", model);
  }
  args.push(prepared.prompt);
  return args;
}

function normalizeAssistSignal(signal) {
  const normalized = String(signal ?? "").trim();
  const aliases = {
    approve: "recommend-approve",
    reject: "recommend-reject",
    "request-changes": "recommend-request-changes"
  };
  return aliases[normalized] ?? normalized;
}

function gateDecisionFromRecommendation(action) {
  const mapping = {
    approve: "approved",
    request_changes: "changes_requested",
    reject: "rejected"
  };
  return mapping[action] ?? null;
}

function formatRecommendation(recommendation) {
  if (!recommendation) {
    return "-";
  }
  const target = recommendation.target_step_id ? ` -> ${recommendation.target_step_id}` : "";
  const reason = recommendation.reason ? ` (${recommendation.reason})` : "";
  return `${recommendation.action}${target}${reason}`;
}

function assertRerunTarget({ runtime, currentStepId, targetStepId }) {
  const sequence = runtime.flow.variants?.[runtime.run.flow_variant]?.sequence ?? [];
  const currentIndex = sequence.indexOf(currentStepId);
  const targetIndex = sequence.indexOf(targetStepId);
  if (targetIndex < 0) {
    throw new Error(`Unknown rerun target for ${runtime.run.flow_variant}: ${targetStepId}`);
  }
  if (currentIndex < 0) {
    throw new Error(`Current step ${currentStepId} is not part of ${runtime.run.flow_variant}`);
  }
  if (targetIndex >= currentIndex) {
    throw new Error(`Rerun target must be earlier than ${currentStepId}; got ${targetStepId}`);
  }
}

async function spawnAssistClaude({ repo, command, args }) {
  const child = spawn(command, args, {
    cwd: repo,
    stdio: "inherit",
    env: process.env
  });
  return await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ exitCode: code ?? (signal ? 1 : 0), signal }));
  });
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstLine(text) {
  return String(text ?? "").trim().split(/\r?\n/)[0] || "(empty)";
}
