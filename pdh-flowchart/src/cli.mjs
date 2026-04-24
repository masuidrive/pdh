#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { loadDotEnv } from "./env.mjs";
import { describeFlow, buildFlowView, getInitialStep, getStep, loadFlow, nextStep, outcomeFromDecision, renderMermaidFlow } from "./flow.mjs";
import { evaluateStepGuards } from "./guards.mjs";
import { runCodex } from "./codex-adapter.mjs";
import { runClaude } from "./claude-adapter.mjs";
import { runCalcSmoke } from "./smoke-calc.mjs";
import { createGateSummary, commitStep, ticketClose, ticketStart } from "./actions.mjs";
import { writeStepPrompt } from "./prompt-templates.mjs";
import { captureNoteTicketPatchProposal, snapshotNoteTicketFiles } from "./patch-proposals.mjs";
import { defaultJudgementKind, loadJudgements, writeJudgement } from "./judgements.mjs";
import { runFinalVerification } from "./final-verification.mjs";
import { formatDoctor, runDoctor } from "./doctor.mjs";
import { withRunLock } from "./locks.mjs";
import { answerLatestInterruption, createInterruption, latestOpenInterruption, loadStepInterruptions, renderInterruptionMarkdown } from "./interruptions.mjs";
import { writeFailureSummary } from "./failure-summary.mjs";
import { appendStepHistoryEntry, loadCurrentNote, saveCurrentNote } from "./note-state.mjs";
import {
  appendProgressEvent,
  cleanupRunArtifacts,
  defaultStateDir,
  ensureCanonicalFiles,
  hasCompletedProviderAttempt,
  latestAttemptResult,
  latestHumanGate,
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
  pdh-flowchart run-next [--repo DIR] [--limit 20] [--manual-provider] [--stop-after-step]
  pdh-flowchart run-provider [--repo DIR] [--step PD-C-6] [--prompt-file FILE] [--timeout-ms MS] [--max-attempts N]
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
          trace.push(result);
          printBlocked(result, trace, options);
          return;
        }

        trace.push({ status: "provider_started", stepId: step.id, provider: step.provider });
        const providerResult = await executeProviderStep({ repo, runtime, step, options });
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
          const result = {
            status: "needs_human",
            stepId: step.id,
            summary: summary.artifactPath,
            nextCommands: humanDecisionCommands(repo, step.id)
          };
          trace.push(result);
          console.log(JSON.stringify({ ...result, trace }, null, 2));
          return;
        }
      }

      const gate = isHumanGateStep(step) ? latestHumanGate({ stateDir, runId: run.id, stepId: step.id }) : null;
      const guardResults = evaluateCurrentGuards({ repo, runtime, step, gate });
      const failed = guardResults.filter((guard) => guard.status === "failed");
      if (failed.length > 0) {
        updateRun(repo, { status: "blocked", current_step_id: step.id });
        const summary = createFailureSummaryForBlock({ repo, runtime, step, failedGuards: failed });
        const block = {
          status: "blocked",
          stepId: step.id,
          reason: "guard_failed",
          provider: step.provider,
          failedGuards: failed,
          failureSummary: summary.artifactPath,
          nextCommand: runNextCommand(repo)
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
        const result = {
          status: "needs_human",
          stepId: step.id,
          summary: summary.artifactPath,
          nextCommands: humanDecisionCommands(repo, step.id)
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
    console.log(`${stepId} interrupted`);
    console.log(`Interrupt: ${interruption.artifactPath}`);
    console.log("Next:");
    for (const commandText of interruptAnswerCommands(repo, stepId)) {
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
    console.log(`${stepId} answered`);
    console.log(`Answer: ${interruption.answerPath}`);
    console.log(`Next: ${runNextCommand(repo)}`);
  } });
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
  console.log("Mode: read-only");
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
  loadDotEnv();

  const runId = runtime.run.id;
  const stepId = step.id;
  const promptPath = options["prompt-file"]
    ? resolve(options["prompt-file"])
    : writePromptArtifact({ repo, runtime, stepId });
  const prompt = readFileSync(promptPath, "utf8");
  const timeoutMs = providerTimeoutMs({ options, flow: runtime.flow, step });
  let attempt = options.attempt !== undefined
    ? positiveInteger(options.attempt, "--attempt")
    : nextStepAttempt({ stateDir: runtime.stateDir, runId, stepId });
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
  while (attempt <= maxAttempts) {
    rawLogPath = join(runtime.stateDir, "runs", runId, "steps", stepId, `attempt-${attempt}`, `${step.provider}.raw.jsonl`);
    const resume = resolveProviderResume({ runtime, stepId, provider: step.provider, option: options.resume ?? null });
    const before = snapshotNoteTicketFiles({ repoPath: repo });
    updateRun(repo, { status: "running", current_step_id: stepId });
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
          killGraceMs: providerKillGraceMs(options),
          onEvent(event) {
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
          permissionMode: options["permission-mode"] ?? (options.bypass === "true" ? "bypassPermissions" : "acceptEdits"),
          resume,
          timeoutMs,
          killGraceMs: providerKillGraceMs(options),
          onEvent(event) {
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
        exitCode: result.exitCode,
        finalMessage: result.finalMessage,
        stderr: result.stderr,
        timedOut: result.timedOut === true,
        signal: result.signal ?? null,
        sessionId: result.sessionId ?? null,
        resumeToken: result.sessionId ?? null,
        rawLogPath,
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
      payload: { nextAttempt: attempt + 1, maxAttempts, delayMs, exitCode: result.exitCode, timedOut: result.timedOut === true }
    });
    await sleep(delayMs);
    attempt += 1;
  }

  updateRun(repo, { status: status === "completed" ? "running" : "failed", current_step_id: stepId });
  const failureSummary = status === "completed"
    ? null
    : createProviderFailureSummary({ repo, runtime: requireRuntime(repo), step, attempt, maxAttempts, rawLogPath, result: lastResult });
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

function evaluateCurrentGuards({ repo, runtime, step, gate = null }) {
  const guardResults = evaluateStepGuards(runtime.flow, step.id, {
    repoPath: repo,
    artifacts: collectGuardArtifacts(runtime, step.id),
    judgements: runtime.run.id ? loadJudgements({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }) : [],
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
    finalizeCompletedRun({ repo, runtime, step });
    return { status: "completed", from: step.id, to: target, outcome };
  }

  resetStepArtifacts({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: target });
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
  return { status: "advanced", from: step.id, to: target, outcome };
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
  const summary = createGateSummary({ repoPath: repo, stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id });
  openHumanGate({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    prompt: step.human_gate?.prompt ?? `${step.id} human gate`,
    summary: summary.artifactPath
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

function collectGuardArtifacts(runtime, stepId) {
  const stepPath = stepDir(runtime.stateDir, runtime.run.id, stepId);
  return [
    { kind: "human_gate_summary", path: join(stepPath, "human-gate-summary.md") },
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

function createFailureSummaryForBlock({ repo, runtime, step, failedGuards }) {
  const summary = writeFailureSummary({
    stateDir: runtime.stateDir,
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    reason: "guard_failed",
    provider: step.provider,
    status: "blocked",
    failedGuards,
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

function createProviderFailureSummary({ repo, runtime, step, attempt, maxAttempts, rawLogPath, result }) {
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
    signal: result?.signal ?? null,
    rawLogPath,
    finalMessage: result?.finalMessage ?? null,
    stderr: result?.stderr ?? null,
    nextCommands: [statusCommand(repo), resumeCommand(repo)]
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
    nextCommands: interruptAnswerCommands(repo, step.id)
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

function providerKillGraceMs(options) {
  return nonNegativeInteger(options["kill-grace-ms"] ?? "5000", "--kill-grace-ms");
}

function retryDelayMs(options, attempt) {
  const baseMs = nonNegativeInteger(options["retry-backoff-ms"] ?? "1000", "--retry-backoff-ms");
  const maxMs = nonNegativeInteger(options["retry-backoff-max-ms"] ?? "30000", "--retry-backoff-max-ms");
  return Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt - 1)));
}

function resolveProviderResume({ runtime, stepId, provider, option }) {
  if (!option) {
    return null;
  }
  if (!["true", "latest", "last"].includes(option)) {
    return option;
  }
  const session = latestProviderSession({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId, provider });
  const token = session?.resume_token ?? session?.session_id ?? null;
  if (!token) {
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

function latestStepCommit(repo, stepId) {
  const result = runGit(repo, ["log", "--format=%H%x00%s", "-50"]);
  if (!result) {
    return null;
  }
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  const pattern = new RegExp(`^\\[${stepId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`);
  for (const line of lines) {
    const [hash, subject] = line.split("\0");
    if (pattern.test(subject)) {
      return hash.slice(0, 7);
    }
  }
  return null;
}

function runGit(repo, args) {
  const result = spawnSync("git", args, { cwd: repo, text: true, encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  return result;
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

function runNextCommand(repo) {
  return `node src/cli.mjs run-next --repo ${shellQuote(repo)}`;
}

function statusCommand(repo) {
  return `node src/cli.mjs status --repo ${shellQuote(repo)}`;
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

function nextProviderCommand(repo) {
  return `node src/cli.mjs run-provider --repo ${shellQuote(repo)}`;
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
