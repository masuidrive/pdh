#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readlinkSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import {
  cmdAcceptProposal,
  cmdApplyAssistSignal,
  cmdAssistOpen,
  cmdAssistSignal,
  cmdDeclineProposal,
  cmdTicketAssistOpen,
  cmdTicketStartRequest,
  formatProposal
} from "./assist.ts";
import { cmdDiagnose } from "./diagnose.ts";
import { cmdSubAgentContext } from "./sub-agent-context.ts";
import {
  cmdGateSummary,
  cmdHumanDecision,
  cmdShowGate
} from "./gate.ts";
import {
  cmdCleanup,
  cmdClosePreflight,
  cmdCommitStep,
  cmdTicketClose,
  cmdTicketStart
} from "./ticket.ts";
import {
  cmdDoctor,
  cmdFlow,
  cmdFlowGraph,
  cmdLogs,
  cmdMetadata,
  cmdShowInterrupts,
  cmdStatus
} from "./inspect.ts";
import { runProviderCli } from "./provider-cli.ts";
import {
  applyAssistSignalCommand,
  assertCurrentStep,
  assertRerunTarget,
  assertStepInVariant,
  assistOpenCommand,
  blockedStopCommands,
  firstLine,
  formatStepName,
  humanDecisionCommands,
  humanStopCommands,
  interruptAnswerCommands,
  interruptStopCommands,
  isHumanGateStep,
  nextProviderCommand,
  parseOptions,
  proposalCommands,
  proposalStopCommands,
  requireRuntime,
  rerunCurrentStepCommand,
  required,
  resumeCommand,
  runNextCommand,
  shellQuote,
  showGateCommand,
  sleep,
  stopCommand,
  statusCommand
} from "./utils.ts";
import { loadDotEnv } from "../support/env.ts";
import { runtimeCliCommand } from "./cli-command.ts";
import type { AnyRecord, CliOptions } from "../types.ts";
import { describeFlow, buildFlowView, getInitialStep, getStep, loadFlow, nextStep, outcomeFromDecision, renderMermaidFlow } from "../flow/load.ts";
import { evaluateStepGuards } from "../flow/guards/index.ts";
import { runProvider, providerKillGraceMs } from "../runtime/providers/registry.ts";
import { maybeFireDiagnoseWatchdog } from "../runtime/watchdog.ts";
import { runCalcSmoke } from "../extras/smoke-calc.ts";
import { archivePriorRunTag, commitStep, gateDecisionText, gateNoteHeadingsFor, gateTicketHeadingFor, stepCommitSummary, ticketClose, ticketCloseDryRun, ticketStart } from "../runtime/actions.ts";
import { renderStepPrompt, writeStepPrompt } from "../flow/prompts/step.ts";
import { writeReviewerPromptArtifact } from "../flow/prompts/reviewer.ts";
import { writeReviewRepairPromptArtifact } from "../flow/prompts/repair.ts";
import { captureNoteTicketPatchProposal, snapshotNoteTicketFiles } from "../extras/patch-proposals.ts";
import { defaultAcceptedJudgementStatus, defaultJudgementKind, loadJudgements, writeJudgement } from "../flow/guards/judgement-artifact.ts";
import { runFinalVerification } from "../flow/guards/final-verification.ts";
import { formatDoctor, runDoctor } from "../runtime/doctor.ts";
import { withRunLock } from "../runtime/locks.ts";
import { answerLatestInterruption, createInterruption, latestOpenInterruption, loadStepInterruptions, renderInterruptionMarkdown } from "../runtime/interruptions.ts";
import { writeFailureSummary } from "../runtime/failure-summary.ts";
import { appendStepHistoryEntry, loadCurrentNote, replaceNoteSection, saveCurrentNote } from "../repo/note.ts";
import {
  allowedAssistSignals,
  appendAssistSignal,
  appendTicketStartRequest,
  clearTicketStartRequest,
  loadLatestAssistSignal,
  markAssistSessionFinished,
  markAssistSessionStarted,
  prepareAssistSession,
  prepareTicketAssistSession,
  ticketAssistSessionPath,
  updateLatestAssistSignal
} from "../runtime/assist/runtime.ts";
import { resolveStepAgent } from "../runtime/providers/agent-resolution.ts";
import { writeNoteOverrides } from "../repo/note-overrides.ts";
import {
  activeReviewPlan,
  aggregateReviewerOutputs,
  expandReviewerInstances,
  loadReviewRepairOutput,
  loadReviewerOutput,
  loadReviewerOutputsForStepRound,
  recordAggregatorReviewArtifacts,
  reviewAccepted,
  reviewRoundDir,
  reviewRoundReviewerAttemptDir,
  reviewRoundReviewerOutputPath,
  reviewRepairOutputPath,
  writeLatestReviewerOutputMirror,
  writeReviewRepairResult,
  writeReviewRoundAggregate,
  writeReviewerAttemptResult
} from "../runtime/review.ts";
import { judgementFromUiOutput, loadStepUiOutput, uiOutputArtifactPath } from "../flow/prompts/ui-output.ts";
import { writeStepUiRuntime } from "../runtime/ui.ts";
import { clearStepCommitRecord, loadStepCommitRecord, writeStepCommitRecord } from "../runtime/step-commit.ts";
import {
  appendProgressEvent,
  cleanupRunArtifacts,
  finishTrackedProcess,
  defaultStateDir,
  ensureCanonicalFiles,
  hasCompletedProviderAttempt,
  latestAttemptResult,
  latestHumanGate,
  clearHumanGateProposal,
  latestProviderSession,
  loadPdhMeta,
  loadRuntime,
  nextStepAttempt,
  recoverRuntimeFromTags,
  savePdhMeta,
  openHumanGate,
  progressPath,
  readProgressEvents,
  registerTrackedProcess,
  finishRunSupervisor,
  resetStepArtifacts,
  resolveHumanGate,
  saveRun,
  startRunSupervisor,
  startRun,
  stepDir,
  updateRun,
  updateRunSupervisor,
  updateHumanGateProposal,
  writeAttemptResult
} from "../runtime/state.ts";

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

const currentCli = runtimeCliCommand();

const args = process.argv.slice(2);
const command = args.shift();
const providerCommand = command === "provider" && args[0] && !args[0].startsWith("--")
  ? args.shift()
  : null;

try {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "init") {
    cmdInit(args);
  } else if (command === "start" || command === "run") {
    await cmdRun(args);
  } else if (command === "status") {
    cmdStatus(args);
  } else if (command === "logs") {
    await cmdLogs(args);
  } else if (command === "show-gate") {
    cmdShowGate(args);
  } else if (command === "doctor") {
    cmdDoctor(args);
  } else if (command === "serve" || command === "web") {
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
  } else if (command === "provider") {
    if (providerCommand === "run") {
      await cmdRunProvider(args);
    } else {
      await runProviderCli(providerCommand ? [providerCommand, ...args] : args);
    }
  } else if (command === "run-provider") {
    await cmdRunProvider(args);
  } else if (command === "resume") {
    await cmdResume(args);
  } else if (command === "stop") {
    await cmdStop(args);
  } else if (command === "recover") {
    await cmdRecover(args);
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
  } else if (command === "ticket-assist-open") {
    await cmdTicketAssistOpen(args);
  } else if (command === "assist-signal") {
    await cmdAssistSignal(args);
  } else if (command === "diagnose") {
    await cmdDiagnose(args);
  } else if (command === "ticket-start-request") {
    await cmdTicketStartRequest(args);
  } else if (command === "apply-assist-signal") {
    await cmdApplyAssistSignal(args);
  } else if (command === "accept-proposal") {
    await cmdAcceptProposal(args);
  } else if (command === "decline-proposal") {
    await cmdDeclineProposal(args);
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
  } else if (command === "close-preflight") {
    cmdClosePreflight(args);
  } else if (command === "cleanup") {
    cmdCleanup(args);
  } else if (command === "smoke-calc") {
    await cmdSmokeCalc(args);
  } else if (command === "flow") {
    cmdFlow(args);
  } else if (command === "flow-graph") {
    cmdFlowGraph(args);
  } else if (command === "sub-agent-context") {
    cmdSubAgentContext(args);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`pdh-flow: ${error.message}`);
  process.exitCode = 1;
}

function printHelp() {
  console.log(`pdh-flow

Usage:
  pdh-flow init [--repo DIR]
  pdh-flow start --ticket ID [--repo DIR] [--variant full|light] [--start-step PD-C-5] [--force-reset] [--worktree true|false]
  pdh-flow run-next [--repo DIR] [--limit 20] [--manual-provider] [--stop-after-step] [--timeout-ms MS] [--idle-timeout-ms MS] [--auto-diagnose true|false] [--auto-diagnose-max N]
  pdh-flow provider run [--repo DIR] [--step PD-C-6] [--prompt-file FILE] [--timeout-ms MS] [--idle-timeout-ms MS] [--max-attempts N]
  pdh-flow provider ask [--repo DIR] (--message TEXT | --file FILE) [--step PD-C-6] [--kind clarification]
  pdh-flow resume [--repo DIR] [--step PD-C-6] [--force]
  pdh-flow stop [--repo DIR] [--reason TEXT]
  pdh-flow recover [--repo DIR] [--ticket ID] [--variant full|light]
  pdh-flow prompt [--repo DIR] [--step PD-C-6]
  pdh-flow metadata [--repo DIR]
  pdh-flow judgement [--repo DIR] [--step PD-C-4] [--kind plan_review] [--status "No Critical/Major"] [--summary TEXT]
  pdh-flow verify [--repo DIR] [--command "scripts/test-all.sh"]
  pdh-flow guards [--repo DIR] [--step PD-C-9]
  pdh-flow gate-summary [--repo DIR] [--step PD-C-5]
  pdh-flow approve [--repo DIR] [--step PD-C-5] [--reason TEXT]
  pdh-flow reject [--repo DIR] [--step PD-C-5] [--reason TEXT]
  pdh-flow request-changes [--repo DIR] [--step PD-C-5] [--reason TEXT]
  pdh-flow interrupt [--repo DIR] (--message TEXT | --file FILE) [--step PD-C-6]
  pdh-flow answer [--repo DIR] (--message TEXT | --file FILE) [--step PD-C-6]
  pdh-flow assist-open [--repo DIR] [--step PD-C-5] [--prepare-only] [--model MODEL] [--bare]
  pdh-flow ticket-assist-open [--repo DIR] --ticket TICKET [--prepare-only] [--model MODEL] [--bare] [--variant full|light]
  pdh-flow assist-signal [--repo DIR] [--step PD-C-5] --signal propose-approve|propose-request-changes|propose-reject|propose-rerun-from|answer|continue [--reason TEXT] [--target-step PD-C-4] [--message TEXT] [--file FILE] [--no-run-next]
  pdh-flow diagnose [--repo DIR] [--step PD-C-5] [--model MODEL] [--timeout-ms MS]
  pdh-flow ticket-start-request [--repo DIR] --ticket TICKET [--variant full|light] [--reason TEXT]
  pdh-flow apply-assist-signal [--repo DIR] [--step PD-C-4] [--no-run-next]
  pdh-flow accept-proposal [--repo DIR] [--step PD-C-5] [--no-run-next]
  pdh-flow decline-proposal [--repo DIR] [--step PD-C-5] [--reason TEXT]
  pdh-flow show-interrupts [--repo DIR] [--step PD-C-6] [--all] [--path]
  pdh-flow status [--repo DIR]
  pdh-flow logs [--repo DIR] [--follow] [--json]
  pdh-flow show-gate [--repo DIR] [--step PD-C-5] [--path]
  pdh-flow cleanup [--repo DIR] [--clear-run-id]
  pdh-flow close-preflight [--repo DIR] [--keep-worktree true|false]
  pdh-flow flow [--variant full|light]
  pdh-flow flow-graph [--variant full|light] [--format mermaid|json] [--repo DIR]
  pdh-flow sub-agent-context [--repo DIR] --step PD-C-N (--role LABEL --scope TEXT | --reviewer-id ID) [--files a,b] [--output-schema reviewer|repair|freeform] [--prior-step PD-C-N] [--stdout]
  pdh-flow doctor [--repo DIR] [--json]
  pdh-flow serve [--repo DIR] [--host 127.0.0.1] [--port 8765]
  pdh-flow smoke-calc [--workdir DIR]

Notes:
  - Compatibility aliases: \`run\` -> \`start\`, \`run-provider\` -> \`provider run\`, \`web\` -> \`serve\`.
  - .pdh-flow/runtime.json is the canonical runtime state (committed).
  - current-ticket.md and current-note.md stay repo-local and human-readable.
  - .pdh-flow/runs/ holds transient prompts, raw logs, interruptions, gate summaries, and other local artifacts (gitignored).
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
  const mainRepo = resolve(options.repo ?? process.cwd());
  const ticket = required(options, "ticket");
  const variant = options.variant ?? "full";
  const flowId = options.flow ?? "pdh-ticket-core";
  const flow = loadFlow(flowId);
  const startStep = options["start-step"] ?? getInitialStep(flow, variant);
  assertStepInVariant(flow, variant, startStep);

  // Worktree default: true. Skip with --worktree=false (or --no-ticket-start
  // which bypasses ticket.sh entirely). Tests pass --no-ticket-start.
  const worktreeRequested = options["no-ticket-start"] !== "true"
    && options.worktree !== "false";
  const ticketStartResult = options["no-ticket-start"] === "true"
    ? null
    : maybeStartTicket({
        repo: mainRepo,
        ticket,
        worktree: worktreeRequested,
        required: options["require-ticket-start"] === "true"
      });
  const repo = ticketStartResult?.worktreePath
    ? resolve(ticketStartResult.worktreePath)
    : mainRepo;

  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = loadRuntime(repo, { normalizeStaleRunning: true });
    if (runtime.run?.id && options["force-reset"] !== "true") {
      const activeTicket = runtime.run.ticket_id || "<unknown>";
      const activeStep = runtime.run.current_step_id || "<unknown>";
      const activeStatus = runtime.run.status || "<unknown>";
      throw new Error(
        `Active run already exists (ticket=${activeTicket}, step=${activeStep}, status=${activeStatus}). ` +
        `To continue: \`${resumeCommand(repo)}\`. ` +
        `To stop and discard: \`${stopCommand(repo)}\` then re-run. ` +
        `To overwrite anyway: pass --force-reset (this archives the current state under a git tag).`
      );
    }
    let archiveTag = null;
    if (runtime.run?.id && options["force-reset"] === "true") {
      archiveTag = archivePriorRunTag({ repoPath: repo, run: runtime.run });
      if (archiveTag) {
        console.log(`Archived prior run state under git tag ${archiveTag} (run ${runtime.run.id}).`);
      }
    }
    const started = startRun({ repoPath: repo, ticket, variant, flowId, startStep });
    if (ticketStartResult) {
      const wtNote = ticketStartResult.worktreePath ? ` (worktree=${ticketStartResult.worktreePath})` : "";
      appendProgressEvent({
        repoPath: repo,
        runId: started.run.id,
        stepId: started.run.current_step_id,
        type: ticketStartResult.status === "ok" ? "tool_finished" : "status",
        provider: "runtime",
        message: ticketStartResult.status === "ok" ? `ticket.sh start ${ticket}${wtNote}` : ticketStartResult.message,
        payload: ticketStartResult
      });
    }
    if (archiveTag) {
      appendProgressEvent({
        repoPath: repo,
        runId: started.run.id,
        stepId: started.run.current_step_id,
        type: "status",
        provider: "runtime",
        message: `prior run archived under ${archiveTag}`,
        payload: { archiveTag, priorRunId: runtime.run?.id ?? null, priorStepId: runtime.run?.current_step_id ?? null }
      });
    }
    syncStepUiRuntime({ repo });
    console.log(started.run.id);
    console.log(`Current step: ${formatStepName(getStep(started.flow, started.run.current_step_id))}`);
    if (ticketStartResult?.worktreePath) {
      console.log(`Worktree: ${ticketStartResult.worktreePath}`);
    }
    console.log(`Next: ${runNextCommand(repo)}`);
  } });
}


async function cmdGuards(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const runtime = loadRuntime(repo, { normalizeStaleRunning: true });
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

export async function cmdRunNext(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const limit = Number(options.limit ?? "20");
  const stopAfterStep = options["stop-after-step"] === "true";
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit must be a positive integer");
  }

  await withRuntimeLock({ repo, options, action: async () => {
    await withRunSupervisor({ repo, command: "run-next", action: async (supervisor) => {
      const trace = [];
      for (let count = 0; count < limit; count += 1) {
        const runtime = requireRuntime(repo);
        supervisor.sync(runtime);
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
        if (run.status === "blocked") {
          // The previous cmdRunNext invocation (or an explicit
          // assist signal) left the run in "blocked": the runtime
          // wants the human to add evidence / make a decision before
          // continuing. Surface that state and exit instead of
          // silently re-running the same step — the last attempt's
          // status is "blocked" not "completed", so the
          // hasCompletedProviderAttempt branch below would kick off
          // another LLM round and likely land us back here with no
          // new information.
          printBlocked({
            status: "blocked",
            stepId: step.id,
            reason: "run_blocked",
            provider: step.provider,
            nextCommands: blockedStopCommands(repo, step.id)
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

        // Resolve the actual provider (after note-frontmatter
        // agent_overrides) before checking whether we already have a
        // completed attempt. Otherwise an override that swaps PD-C-N
        // from claude → codex makes us look for a "claude" attempt
        // that never ran, conclude none exists, and re-spawn the
        // codex provider — which trips the per-step max-attempts cap
        // even though there's a perfectly good completed codex attempt
        // sitting in the run dir.
        const resolvedAgent = (step.provider !== "runtime"
          ? resolveStepAgent({ flow, runtimeRun: run, step })
          : null) as { kind?: string; provider?: string } | null;
        const checkProvider = resolvedAgent?.kind === "edit" && resolvedAgent.provider
          ? resolvedAgent.provider
          : step.provider;
        if (step.provider !== "runtime" && !hasCompletedProviderAttempt({ stateDir, runId: run.id, stepId: step.id, provider: checkProvider })) {
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
          supervisor.sync();
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
            supervisor.sync();
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
          const guardRepair = await maybeAutoRepairReviewGuards({
            repo,
            runtime,
            step,
            failedGuards: failed,
            options
          });
          supervisor.sync();
          if (guardRepair?.status === "repaired") {
            trace.push({
              status: "guard_repaired",
              stepId: step.id,
              repairedGuards: guardRepair.repairedGuards,
              rounds: guardRepair.rounds
            });
            continue;
          }
          if (step.assistEscalation) {
            const message = describeGuardFailureMessage(failed);
            const escalationGate = latestHumanGate({ stateDir, runId: run.id, stepId: step.id });
            const escalationContext = deriveHumanGateContext({ repo, runtime, step, existingGate: escalationGate });
            openHumanGate({
              stateDir,
              runId: run.id,
              stepId: step.id,
              baseline: escalationContext.baseline,
              rerunRequirement: escalationContext.rerun_requirement
            });
            updateRun(repo, { status: "needs_human", current_step_id: step.id });
            supervisor.sync();
            syncStepUiRuntime({ repo, stepId: step.id, guardResults, nextCommands: humanStopCommands(repo, step.id) });
            appendProgressEvent({
              repoPath: repo,
              runId: run.id,
              stepId: step.id,
              type: "assist_escalation_opened",
              provider: "runtime",
              message: `${step.id} assist escalation opened (${step.assistEscalation})`,
              payload: {
                escalation: step.assistEscalation,
                failedGuards: failed.map((guard) => guard.guardId ?? guard.id ?? null),
                message
              }
            });
            const escalation = {
              status: "needs_human",
              stepId: step.id,
              reason: "assist_escalation",
              escalation: step.assistEscalation,
              message,
              failedGuards: failed,
              nextCommands: humanStopCommands(repo, step.id)
            };
            trace.push(escalation);
            console.log(JSON.stringify({ ...escalation, trace }, null, 2));
            return;
          }
          updateRun(repo, { status: "blocked", current_step_id: step.id });
          supervisor.sync();
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
          supervisor.sync();
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
        supervisor.sync();
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
  } });

  maybeFireDiagnoseWatchdog({
    repo,
    options,
    log: (msg) => console.error(`[auto-diagnose] ${msg}`)
  });
}

async function cmdRunProvider(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  await withRuntimeLock({ repo, options, action: async () => {
    await withRunSupervisor({ repo, command: options["supervisor-command"] ?? "provider run", action: async (supervisor) => {
      const runtime = requireRuntime(repo);
      supervisor.sync(runtime);
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
      supervisor.sync();
      printProviderResult({ repo, runtime: requireRuntime(repo), step, result, options, trace: [] });
      if (result.status !== "completed") {
        process.exitCode = 1;
      }
    } });
  } });
}

async function cmdResume(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const runtime = loadRuntime(repo, { normalizeStaleRunning: true });
  const supervisor = runtime.supervisor;
  const run = runtime.run;
  const isStaleSupervisor = supervisor?.status === "stale";
  const isUserStopped = supervisor?.staleReason === "user_stopped";

  if (run?.id && isStaleSupervisor) {
    if (isUserStopped && options.force !== "true") {
      throw new Error(`Run was stopped by \`${currentCli} stop\`. Pass --force to override or call \`${currentCli} start\` to start fresh.`);
    }
    const stepId = run.current_step_id;
    if (!stepId) {
      throw new Error("Active run has no current_step_id; nothing to resume.");
    }
    resetStepArtifacts({ stateDir: runtime.stateDir, runId: run.id, stepId });
    updateRun(repo, { status: "running", current_step_id: stepId });
    if (runtime.supervisor) {
      finishRunSupervisor({ stateDir: runtime.stateDir, status: "exited", exitCode: 0 });
      updateRunSupervisor({ stateDir: runtime.stateDir, fields: { staleReason: null } });
    }
    appendProgressEvent({
      repoPath: repo,
      runId: run.id,
      stepId,
      type: "runtime_resumed",
      provider: "runtime",
      message: `${stepId} resumed after ${isUserStopped ? "user stop" : "process loss"}`,
      payload: {
        staleReason: supervisor?.staleReason ?? null,
        priorStatus: run.status,
        forced: options.force === "true"
      }
    });
    const passthrough = ["--repo", repo];
    if (options["timeout-ms"]) passthrough.push("--timeout-ms", options["timeout-ms"]);
    if (options["idle-timeout-ms"]) passthrough.push("--idle-timeout-ms", options["idle-timeout-ms"]);
    if (options["max-attempts"]) passthrough.push("--max-attempts", options["max-attempts"]);
    if (options["retry-backoff-ms"]) passthrough.push("--retry-backoff-ms", options["retry-backoff-ms"]);
    await cmdRunNext(passthrough);
    return;
  }

  await cmdRunProvider([...argv, "--resume", "latest", "--supervisor-command", "resume"]);
}

async function cmdRecover(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const result = recoverRuntimeFromTags(repo, {
    ticket: options.ticket,
    variant: options.variant,
    flow: options.flow
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "recovered") {
    process.exitCode = result.status === "skipped" ? 0 : 1;
  }
}

async function cmdStop(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const runtime = loadRuntime(repo);
  const supervisor = runtime.supervisor;
  const run = runtime.run;
  if (!run?.id) {
    console.log(JSON.stringify({ status: "no_active_run" }, null, 2));
    return;
  }
  if (supervisor?.status === "running") {
    finishRunSupervisor({ stateDir: runtime.stateDir, status: "stale", exitCode: null, signal: null });
  }
  updateRunSupervisor({ stateDir: runtime.stateDir, fields: { staleReason: "user_stopped" } });
  if (run.status === "running") {
    updateRun(repo, { status: "failed", current_step_id: run.current_step_id });
  }
  appendProgressEvent({
    repoPath: repo,
    runId: run.id,
    stepId: run.current_step_id,
    type: "runtime_stopped",
    provider: "runtime",
    message: `${run.current_step_id ?? "run"} marked stopped by user`,
    payload: {}
  });
  console.log(JSON.stringify({ status: "stopped", runId: run.id, stepId: run.current_step_id }, null, 2));
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
      source: options.source ?? "runtime"
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







async function cmdWeb(argv) {
  const { startWebServer } = await import("../web/index.ts");
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const host = options.host ?? "127.0.0.1";
  const port = nonNegativeInteger(options.port ?? "8765", "--port");
  const { server, url } = await startWebServer({ repoPath: repo, host, port }) as AnyRecord;
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
    rootDir: resolve(options.workdir ?? "/tmp/pdh-flow-calc-smoke"),
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

async function executeProviderStep({ repo, runtime, step: incomingStep, options }) {
  if (incomingStep.provider === "runtime") {
    throw new Error(`${incomingStep.id} is runtime-owned and does not have a provider prompt`);
  }
  // Apply note-frontmatter agent overrides on top of the flow yaml. The
  // resolved agent struct shadows incomingStep.provider so the rest of
  // this function (and downstream review dispatch) can keep reading
  // `step.provider` without knowing about the override layer.
  const agent = resolveStepAgent({ flow: runtime.flow, runtimeRun: runtime.run, step: incomingStep }) as AnyRecord;
  const step = agent?.kind === "edit" && agent.provider
    ? { ...incomingStep, provider: agent.provider }
    : incomingStep;
  // If the override specifies a model and the CLI options didn't, inject
  // it so runProvider picks it up.
  const effectiveOptions = (agent?.kind === "edit" && agent.model && options.model === undefined)
    ? { ...options, model: agent.model }
    : options;
  const reviewPlan = activeReviewPlan(runtime.flow, runtime.run.flow_variant, step.id);
  if (step.mode === "review" && reviewPlan?.reviewers?.length) {
    if (effectiveOptions["prompt-file"]) {
      throw new Error(`${step.id} uses runtime-owned parallel reviewer prompts; --prompt-file is not supported for this step.`);
    }
    return executeParallelReviewStep({ repo, runtime, step, reviewPlan, options: effectiveOptions, agent });
  }
  // Use effectiveOptions (with potentially overridden model) for the
  // remainder of the edit-mode dispatch.
  options = effectiveOptions;
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
    const trackedProcessId = providerProcessEntryId(stepId, attempt);
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

    const result = await runProvider({
      provider: step.provider,
      cwd: repo,
      prompt,
      rawLogPath,
      timeoutMs,
      idleTimeoutMs,
      options,
      resume,
      debugContext: (() => {
        const kind = defaultJudgementKind(stepId);
        const paths: { name: string; path: string }[] = [
          { name: "ui-output", path: uiOutputArtifactPath({ stateDir: runtime.stateDir, runId, stepId }) }
        ];
        if (kind) {
          paths.push({ name: `judgement-${kind}`, path: join(runtime.stateDir, "runs", runId, "steps", stepId, "judgements", `${kind}.json`) });
        }
        return { stateDir: runtime.stateDir, runId, stepId, roleId: step.role || step.provider, artifactPaths: paths };
      })(),
      onSpawn({ pid }) {
        attemptState = {
          ...attemptState,
          pid: pid ?? null
        };
        if (pid) {
          registerTrackedProcess({
            stateDir: runtime.stateDir,
            runId,
            entry: {
              id: trackedProcessId,
              kind: "provider",
              stepId,
              attempt,
              provider: step.provider,
              label: step.provider,
              pid,
              status: "running",
              startedAt: attemptState.startedAt
            }
          });
        }
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
    finishTrackedProcess({
      stateDir: runtime.stateDir,
      runId,
      entryId: trackedProcessId,
      status,
      pid: result.pid ?? attemptState.pid ?? null,
      exitCode: result.exitCode ?? null,
      finishedAt: new Date().toISOString()
    });
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
      recordRuntimeStepCommit({
        repo,
        runtime,
        runId,
        step,
        attempt,
        beforeCommit: headBeforeStep
      });
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
      syncFlowVariantFromNote({ repo, runtime, step });
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

async function executeParallelReviewStep({ repo, runtime, step, reviewPlan, options, agent = null }) {
  // Apply note-frontmatter overrides on top of the flow-yaml review
  // plan. agent.reviewers replaces the roster wholesale when set;
  // aggregator/repair overrides are merged at the field level. The
  // resolver is called once at executeProviderStep entry; we accept it
  // as a parameter so the resolution stays pure (no double-call).
  if (agent?.kind === "review") {
    reviewPlan = applyAgentOverrideToReviewPlan(reviewPlan, agent);
  }
  // Review steps don't reuse the provider-step retry mechanism: the
  // inner round loop IS the retry. forceRerun fires deterministically
  // once inPlaceRepairCount >= maxInPlaceRepairs, so the round loop
  // terminates within at most maxInPlaceRepairs+1 iterations. There is
  // no separate "retry the whole review batch" axis worth keeping —
  // a subprocess crash surfaces the failure to the operator and the
  // user explicitly resumes / re-runs at that point.
  loadDotEnv();
  const runId = runtime.run.id;
  const stepId = step.id;
  const timeoutMs = providerTimeoutMs({ options, flow: runtime.flow, step });
  const idleTimeoutMs = providerIdleTimeoutMs({ options, flow: runtime.flow, step });
  const attempt = options.attempt !== undefined
    ? positiveInteger(options.attempt, "--attempt")
    : nextStepAttempt({ stateDir: runtime.stateDir, runId, stepId });

  const reviewers = expandReviewerInstances(reviewPlan);
  if (reviewers.length === 0) {
    throw new Error(`${stepId} review plan did not resolve any reviewers`);
  }
  const repairProvider = reviewRepairProviderForStep(runtime.flow, step, reviewPlan);
  // After this many in-place repair rounds without convergence, the
  // runtime forces a rerun-from regardless of repair.commit_required.
  // Defaults to 2. Because forceRerun is the only round-loop exit that
  // doesn't already produce a terminal kind, this is also the de-facto
  // upper bound on how many rounds run.
  const maxInPlaceRepairs = Number.isInteger(reviewPlan?.maxInPlaceRepairs) && reviewPlan.maxInPlaceRepairs > 0
    ? reviewPlan.maxInPlaceRepairs
    : 2;
  const defaultRerunStep = reviewPlan?.defaultRerunStep || "PD-C-6";

  const headBeforeStep = currentHead(repo);
  clearStepCommitRecord({ stateDir: runtime.stateDir, runId, stepId });
  const before = snapshotNoteTicketFiles({ repoPath: repo });
  updateRun(repo, { status: "running", current_step_id: stepId });
  let rawLogPath = join(runtime.stateDir, "runs", runId, "steps", stepId, "reviewers");
  const attemptState = {
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
  writeAttemptResult({ stateDir: runtime.stateDir, runId, stepId, attempt, result: attemptState });
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
      repairProvider
    }
  });

  const roundHistory = [];
  let priorFindingsByReviewer = new Map();
  let inPlaceRepairCount = 0;
  let outcome;
  for (let round = 1; ; round += 1) {
    appendProgressEvent({
      repoPath: repo,
      runId,
      stepId,
      attempt,
      type: "review_round_started",
      provider: "runtime",
      message: `${stepId} review round ${round} started`,
      payload: { round, repairProvider }
    });
    outcome = await runReviewRound({
      repo, runtime, step, reviewPlan, reviewers,
      attempt, round,
      repairProvider, maxInPlaceRepairs, defaultRerunStep,
      inPlaceRepairCount, priorFindingsByReviewer, roundHistory,
      timeoutMs, idleTimeoutMs, options
    });
    if (outcome.kind !== "continue") break;
    inPlaceRepairCount = outcome.inPlaceRepairCount;
    priorFindingsByReviewer = outcome.priorFindingsByReviewer;
  }
  const kind = outcome.kind;
  const lastResult = outcome.lastResult;
  if (outcome.rawLogPath) rawLogPath = outcome.rawLogPath;
  // Map runReviewRound's terminal kind to the canonical
  // attempt.status / verdict pair. attempt.status is restricted to
  // {running, completed, failed, abandoned}; rerun_from is expressed
  // by attempt.status="completed" with verdict="rerun_from" so a
  // future re-entry into this step can still distinguish "passed"
  // from "decided to redirect upstream".
  const attemptStatus = kind === "rerun_from" ? "completed" : kind;
  const verdict = kind === "rerun_from" ? "rerun_from" : null;

  writeAttemptResult({
    stateDir: runtime.stateDir,
    runId,
    stepId,
    attempt,
    result: {
      provider: step.provider,
      status: attemptStatus,
      verdict,
      pid: lastResult?.pid ?? null,
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
    message: `${stepId} ${attemptStatus}`,
    payload: {
      verdict,
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

  if (kind === "completed") {
    // Review steps commit their aggregate verdict from inside
    // recordAggregatorReviewArtifacts; the runtime-side recorder is
    // unnecessary here (it would only emit a misleading
    // provider_commit_detected event for the runtime's own commit).
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

  // For rerun_from, rerunFromStep already wrote run.status=running
  // and moved current_step_id to the rerun target. Re-running
  // updateRun here would clobber that move.
  if (kind !== "rerun_from") {
    updateRun(repo, { status: kind === "completed" ? "running" : "failed", current_step_id: stepId });
  }

  const failureSummary = kind === "failed"
    ? createProviderFailureSummary({
        repo,
        runtime: requireRuntime(repo),
        step,
        attempt,
        maxAttempts: 1,
        rawLogPath,
        result: lastResult,
        reviewContext: summarizePartialReviewContext(loadReviewerOutputsForStepRound({
          stateDir: runtime.stateDir,
          runId: runtime.run.id,
          stepId,
          round: roundHistory.length > 0 ? roundHistory[roundHistory.length - 1].round : null
        }))
      })
    : null;

  syncStepUiRuntime({
    repo,
    stepId,
    nextCommands: kind === "failed"
      ? [statusCommand(repo), assistOpenCommand(repo, stepId), resumeCommand(repo)]
      : [runNextCommand(repo)]
  });

  return {
    status: attemptStatus,
    verdict,
    attempt,
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
  const trackedProcessId = reviewerProcessEntryId(step.id, round, reviewer.reviewerId, attempt);
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

  const result = await runProvider({
    provider,
    cwd: repo,
    prompt: promptArtifact.body,
    rawLogPath,
    timeoutMs,
    idleTimeoutMs,
    options,
    disableSlashCommands: provider === "claude",
    settingSources: provider === "claude" ? "user" : null,
    debugContext: {
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId: step.id,
      roleId: reviewer.reviewerId,
      artifactPaths: [{
        name: "review",
        path: reviewRoundReviewerOutputPath({
          stateDir: runtime.stateDir,
          runId: runtime.run.id,
          stepId: step.id,
          round,
          reviewerId: reviewer.reviewerId
        })
      }]
    },
    onSpawn({ pid }) {
      reviewerAttemptState = {
        ...reviewerAttemptState,
        pid: pid ?? null
      };
      if (pid) {
        registerTrackedProcess({
          stateDir: runtime.stateDir,
          runId: runtime.run.id,
          entry: {
            id: trackedProcessId,
            kind: "reviewer",
            stepId: step.id,
            attempt,
            round,
            reviewerId: reviewer.reviewerId,
            provider,
            label: `${reviewer.label || reviewer.reviewerId} (round ${round})`,
            pid,
            status: "running",
            startedAt: reviewerAttemptState.startedAt
          }
        });
      }
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
  finishTrackedProcess({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    entryId: trackedProcessId,
    status: result.exitCode === 0 ? "completed" : "failed",
    pid: result.pid ?? reviewerAttemptState.pid ?? null,
    exitCode: result.exitCode ?? null,
    finishedAt: new Date().toISOString()
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

async function executeAggregatorRun({ repo, runtime, step, reviewerRuns, attempt, round, timeoutMs, idleTimeoutMs, options }) {
  const provider = step.provider;
  const roundDir = reviewRoundDir({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    round
  });
  const aggregatorDir = join(roundDir, "aggregator");
  mkdirSync(aggregatorDir, { recursive: true });
  const promptPath = join(aggregatorDir, "prompt.md");
  const attemptDir = join(aggregatorDir, `attempt-${attempt}`);
  mkdirSync(attemptDir, { recursive: true });
  const rawLogPath = join(attemptDir, `${provider}.raw.jsonl`);

  const reviewerOutputs = reviewerRuns.map((reviewerRun) => ({
    reviewerId: reviewerRun.reviewerId,
    label: reviewerRun.label,
    provider: reviewerRun.provider,
    round: reviewerRun.round ?? round,
    artifactPath: reviewRoundReviewerOutputPath({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId: step.id,
      round,
      reviewerId: reviewerRun.reviewerId
    }),
    status: reviewerRun.output?.status || null,
    // The aggregator only needs status/summary/findings to dedupe and decide
    // consensus; the reviewer's `notes` field is their working transcript
    // (commands run, log excerpts) which is valuable for tuning but not for
    // consensus. Stripping it keeps the aggregator prompt lean — saves ~2-3 KB
    // per reviewer × N reviewers × rounds. Full review.json is still on disk.
    rawText: stripReviewerOutputForAggregator(reviewerRun.output) || reviewerRun.output?.rawText || ""
  }));

  const interruptions = loadStepInterruptions({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id
  });
  const prompt = renderStepPrompt({
    repoPath: repo,
    run: runtime.run,
    flow: runtime.flow,
    step,
    interruptions,
    reviewerOutputs
  });
  writeFileSync(promptPath, prompt);

  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    attempt,
    type: "artifact",
    provider: "runtime",
    message: `aggregator prompt ${promptPath}`,
    payload: { round, artifactPath: promptPath }
  });
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    attempt,
    type: "aggregator_started",
    provider,
    message: `${step.id} aggregator started`,
    payload: { round, provider }
  });

  const trackedProcessId = `${step.id}-aggregator-round-${round}-attempt-${attempt}`;
  const startedAt = new Date().toISOString();
  const result = await runProvider({
    provider,
    cwd: repo,
    prompt,
    rawLogPath,
    timeoutMs,
    idleTimeoutMs,
    options,
    disableSlashCommands: provider === "claude",
    settingSources: provider === "claude" ? "user" : null,
    debugContext: (() => {
      const kind = defaultJudgementKind(step.id);
      const paths: { name: string; path: string }[] = [
        { name: "ui-output", path: uiOutputArtifactPath({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }) }
      ];
      if (kind) {
        paths.push({ name: `judgement-${kind}`, path: join(runtime.stateDir, "runs", runtime.run.id, "steps", step.id, "judgements", `${kind}.json`) });
      }
      return { stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id, roleId: "aggregator", artifactPaths: paths };
    })(),
    onSpawn({ pid }) {
      if (pid) {
        registerTrackedProcess({
          stateDir: runtime.stateDir,
          runId: runtime.run.id,
          entry: {
            id: trackedProcessId,
            kind: "aggregator",
            stepId: step.id,
            attempt,
            round,
            provider,
            label: `${step.id} aggregator (round-${round})`,
            pid,
            status: "running",
            startedAt
          }
        });
      }
    },
    onEvent(event) {
      appendProgressEvent({
        repoPath: repo,
        runId: runtime.run.id,
        stepId: step.id,
        attempt,
        type: `aggregator_${event.type}`,
        provider,
        message: `aggregator: ${event.message}`,
        payload: {
          round,
          sessionId: event.sessionId ?? null,
          finalMessage: event.finalMessage ?? null,
          event: event.payload ?? {}
        }
      });
    }
  });
  finishTrackedProcess({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    entryId: trackedProcessId,
    status: result.exitCode === 0 ? "completed" : "failed",
    pid: result.pid ?? null,
    exitCode: result.exitCode ?? null,
    finishedAt: new Date().toISOString()
  });

  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    attempt,
    type: "aggregator_finished",
    provider,
    message: `${step.id} aggregator ${result.exitCode === 0 ? "completed" : "failed"}`,
    payload: { round, provider, exitCode: result.exitCode, rawLogPath }
  });

  return {
    result: { ...result, rawLogPath },
    rawLogPath,
    promptPath
  };
}

function judgementAcceptedForStep(stepId, judgement) {
  if (!judgement) {
    return false;
  }
  const kind = judgement.kind || defaultJudgementKind(stepId);
  if (!kind) {
    return false;
  }
  const acceptedStatus = defaultAcceptedJudgementStatus(kind);
  return Boolean(acceptedStatus) && judgement.status === acceptedStatus;
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
  const trackedProcessId = repairProcessEntryId(step.id, round);
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

  const result = await runProvider({
    provider,
    cwd: repo,
    prompt: promptArtifact.body,
    rawLogPath,
    timeoutMs,
    idleTimeoutMs,
    options,
    disableSlashCommands: provider === "claude",
    settingSources: provider === "claude" ? "user" : null,
    debugContext: {
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId: step.id,
      roleId: "repair",
      artifactPaths: [{
        name: "repair",
        path: reviewRepairOutputPath({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id, round })
      }]
    },
    onSpawn({ pid }) {
      repairAttemptState = {
        ...repairAttemptState,
        pid: pid ?? null
      };
      if (pid) {
        registerTrackedProcess({
          stateDir: runtime.stateDir,
          runId: runtime.run.id,
          entry: {
            id: trackedProcessId,
            kind: "repair",
            stepId: step.id,
            attempt,
            round,
            provider,
            label: `repair (round ${round})`,
            pid,
            status: "running",
            startedAt: repairAttemptState.startedAt
          }
        });
      }
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
  finishTrackedProcess({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    entryId: trackedProcessId,
    status: result.exitCode === 0 ? "completed" : "failed",
    pid: result.pid ?? repairAttemptState.pid ?? null,
    exitCode: result.exitCode ?? null,
    finishedAt: new Date().toISOString()
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

// The runtime is the single owner of commits in the PD-C flow. After a
// step completes, this records any pending durable changes (note/ticket/
// source) as a runtime commit so the next step's diff baseline and the
// step_commit_recorded guard both have a stable anchor. Provider self-
// commits are tolerated for now (HEAD changed -> warn, do nothing) but
// are deprecated; the prompt instructs providers to leave commits to
// the runtime.
function recordRuntimeStepCommit({ repo, runtime, runId, step, attempt, beforeCommit }) {
  const head = currentHead(repo);
  if (head && head !== beforeCommit) {
    appendProgressEvent({
      repoPath: repo,
      runId,
      stepId: step.id,
      attempt,
      type: "provider_commit_detected",
      provider: "runtime",
      message: `${step.id}: provider committed (${(head ?? "").slice(0, 7)}); runtime expects to own commits`,
      payload: { providerCommit: head, beforeCommit }
    });
    return;
  }
  let commitResult;
  try {
    commitResult = commitStep({
      repoPath: repo,
      stepId: step.id,
      message: stepCommitSummary(step.id),
      ticket: runtime.run?.ticket_id ?? null
    });
  } catch (error) {
    appendProgressEvent({
      repoPath: repo,
      runId,
      stepId: step.id,
      attempt,
      type: "auto_commit_failed",
      provider: "runtime",
      message: `${step.id}: runtime commit failed: ${error.message}`,
      payload: { error: error.message }
    });
    return;
  }
  if (commitResult.status === "committed") {
    appendProgressEvent({
      repoPath: repo,
      runId,
      stepId: step.id,
      attempt,
      type: "step_commit",
      provider: "runtime",
      message: `${step.id}: ${commitResult.commit ?? "committed"}`,
      payload: commitResult
    });
  }
}

function materializeJudgementFromUiOutput({ repo, runtime, step, providerResult }) {
  // Source of truth for the expected judgement kind: step yaml's
  // `judgement.kind`. The legacy DEFAULT_KIND_BY_STEP map in
  // src/runtime/judgements.ts is a fallback for steps that haven't
  // adopted the new shape yet (and therefore won't include PD-C-10's
  // close-gate, which previously made this materializer a no-op for
  // PD-C-10 — agents wrote ui-output.json.judgement but the artifact
  // never landed in judgements/, so the close-gate-accepted guard
  // always failed at gate time).
  const kindHint = step?.judgement?.kind || defaultJudgementKind(step.id);
  if (!kindHint || !runtime.run?.id) {
    return null;
  }
  const existing = loadJudgements({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id
  });
  if (existing.some((item) => item.kind === kindHint)) {
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

function maybeLockFlowVariant({ repo, runtime, step }) {
  if (runtime.run?.flow_variant_locked === true) return;
  try {
    writeNoteOverrides(repo, { flow_variant_locked: true });
  } catch (error) {
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId: step.id,
      type: "status",
      provider: "runtime",
      message: `failed to lock flow_variant in note frontmatter: ${error?.message || String(error)}`,
      payload: { source: "note:lock-write" }
    });
    return;
  }
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    type: "status",
    provider: "runtime",
    message: `flow_variant locked at ${step.id} (variant=${runtime.run.flow_variant})`,
    payload: { flow_variant: runtime.run.flow_variant, source: "note:lock", lockedAt: step.id }
  });
}

function syncFlowVariantFromNote({ repo, runtime, step }) {
  // current-note.md frontmatter is the canonical source for
  // flow_variant. loadRuntime already hydrates runtime.run.flow_variant
  // from it; here we persist that decision to .pdh-flow/runtime.json
  // (pdh-meta) so legacy readers (inspect/status, runtime.json
  // consumers) see the same value. Idempotent — only writes when the
  // persisted variant disagrees with the live note-derived one.
  if (!runtime.run?.id) return;
  const noteVariant = runtime.run.flow_variant;
  if (!noteVariant) return;
  if (!runtime.flow.variants?.[noteVariant]) return;
  if (runtime.pdh?.variant === noteVariant) return;
  updateRun(repo, { flow_variant: noteVariant });
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    type: "status",
    provider: "runtime",
    message: `flow variant synced to ${noteVariant} from note frontmatter`,
    payload: { flow_variant: noteVariant, source: "note:frontmatter" }
  });
}

export function advanceRun({ repo, runtime, step, outcome }) {
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
  // Lock the variant once planning (PD-C-3) commits successfully. From
  // here on, mid-run note edits to flow_variant are no-ops (loadRuntime
  // will keep using the persisted pdh-meta variant and emit a
  // lock-violation warning).
  if (step.id === "PD-C-3" && outcome === "success") {
    maybeLockFlowVariant({ repo, runtime, step });
  }

  if (target === "COMPLETE") {
    syncStepUiRuntime({ repo, stepId: step.id, nextCommands: [] });
    try {
      finalizeCompletedRun({ repo, runtime, step });
      return { status: "completed", from: step.id, to: target, outcome };
    } catch (error) {
      updateRun(repo, { status: "needs_human", current_step_id: step.id });
      appendProgressEvent({
        repoPath: repo,
        runId: runtime.run.id,
        stepId: step.id,
        type: "human_gate_finalize_failed",
        provider: "runtime",
        message: `${step.id} close finalization failed`,
        payload: {
          outcome,
          target,
          error: error?.message || String(error)
        }
      });
      syncStepUiRuntime({ repo, stepId: step.id, nextCommands: humanStopCommands(repo, step.id) });
      throw error;
    }
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

// Slim a normalized reviewer output for aggregator consumption. The
// aggregator only needs status/summary/findings to dedupe and decide
// consensus; `notes` is the reviewer's working transcript (commands,
// outputs) which inflates the aggregator prompt by ~2-3 KB per reviewer.
// Returns a JSON string in the same review.json shape, or null if there
// is nothing useful to embed.
function stripReviewerOutputForAggregator(output) {
  if (!output || typeof output !== "object") return null;
  const slim: AnyRecord = {};
  if (output.status) slim.status = output.status;
  if (output.summary) slim.summary = output.summary;
  if (Array.isArray(output.findings)) slim.findings = output.findings;
  if (Object.keys(slim).length === 0) return null;
  return JSON.stringify(slim, null, 2);
}

// Build the lastResult shape that executeParallelReviewStep persists
// into attempt-N/result.json, from a provider exec result. Replaces
// the per-break literal that copy-pasted six fields (exitCode,
// finalMessage, stderr, timedOut, timeoutKind, signal) at every
// failure exit of the round loop.
function reviewRoundResultFromExec(result, finalMessage) {
  return {
    exitCode: result?.exitCode ?? null,
    finalMessage,
    stderr: result?.stderr ?? "",
    timedOut: result?.timedOut === true,
    timeoutKind: result?.timeoutKind ?? null,
    signal: result?.signal ?? null
  };
}

// Build the same shape for runtime-side outcomes (no provider exec
// involved — the runtime decided the round resolved a particular way
// based on artifact contents).
function reviewRoundResult(exitCode, finalMessage, stderr = "") {
  return {
    exitCode,
    finalMessage,
    stderr,
    timedOut: false,
    timeoutKind: null,
    signal: null
  };
}

// Persist the aggregator verdict for a round (writes the note section
// + commits) and emit the artifact / commit progress events that
// follow it. The trailing review_round_finished event is emitted by
// the caller because its payload depends on whether the round is the
// accepting round or part of an in-place repair sequence.
function recordReviewRoundArtifacts({ repo, runtime, step, runId, stepId, attempt, aggregate, aggregatorJudgement, roundHistory }) {
  const recorded = recordAggregatorReviewArtifacts({
    repoPath: repo,
    runtime,
    step,
    aggregate,
    aggregatorJudgement,
    rounds: roundHistory,
    commit: true
  });
  appendProgressEvent({
    repoPath: repo,
    runId,
    stepId,
    attempt,
    type: "artifact",
    provider: "runtime",
    message: `review note updated ${recorded.noteSection}`,
    payload: { section: recorded.noteSection }
  });
  appendProgressEvent({
    repoPath: repo,
    runId,
    stepId,
    attempt,
    type: "commit",
    provider: "runtime",
    message: recorded.commit?.message ?? `${stepId} commit ${recorded.commit?.status}`,
    payload: recorded.commit ?? {}
  });
  return recorded;
}

// Run one round of the review loop and return what should happen next.
// Returns either:
//   { kind: "continue", inPlaceRepairCount, priorFindingsByReviewer }
//     — the round did an in-place repair, the outer loop should iterate
//       to the next round with the updated state.
//   { kind: <terminalKind>, lastResult, rawLogPath? }
//     — the round produced a terminal outcome for the attempt.
//       <terminalKind> is one of "completed" | "failed" | "rerun_from".
//       The caller maps kind → attempt.status:
//         completed → status=completed
//         failed    → status=failed
//         rerun_from → status=completed, verdict=rerun_from
//       and decides whether to call updateRun (skipped for rerun_from
//       because rerunFromStep has already moved current_step_id).
//
// All side effects (writing aggregate / judgement / repair artifacts,
// emitting progress events, calling rerunFromStep) live inside this
// function; the outer loop owns only the state machine glue.
async function runReviewRound({
  repo, runtime, step, reviewPlan, reviewers,
  attempt, round,
  repairProvider, maxInPlaceRepairs, defaultRerunStep,
  inPlaceRepairCount, priorFindingsByReviewer, roundHistory,
  timeoutMs, idleTimeoutMs, options
}) {
  const runId = runtime.run.id;
  const stepId = step.id;
  const stateDir = runtime.stateDir;

  // 1. Reviewers (parallel).
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
    : aggregateReviewerOutputs({ step, reviewPlan, reviewers: reviewerRuns });

  if (aggregate) {
    const aggregatePath = writeReviewRoundAggregate({ stateDir, runId, stepId, round, aggregate });
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
    return {
      kind: "failed",
      lastResult: reviewRoundResultFromExec(failedReviewer.result, `${failedReviewer.label} failed`),
      rawLogPath: failedReviewer.result.rawLogPath ?? null
    };
  }
  if (aggregate?.status === "invalid_reviewer_output" || aggregate?.status === "missing_reviewer_output") {
    return {
      kind: "failed",
      lastResult: reviewRoundResult(2, aggregate.summary, aggregate.summary)
    };
  }

  const nextPriorFindings = new Map(reviewerRuns.map((reviewerRun) => [
    reviewerRun.reviewerId,
    (reviewerRun.output?.findings ?? []).filter((finding) => ["critical", "major", "minor"].includes(finding.severity))
  ]));

  // 2. Aggregator.
  const aggregatorRun = await executeAggregatorRun({
    repo, runtime, step, reviewerRuns, attempt, round, timeoutMs, idleTimeoutMs, options
  });
  if (aggregatorRun.result.exitCode !== 0) {
    return {
      kind: "failed",
      lastResult: reviewRoundResultFromExec(aggregatorRun.result, `${stepId} aggregator failed in round ${round}`),
      rawLogPath: aggregatorRun.rawLogPath ?? null
    };
  }

  const aggregatorUi = loadStepUiOutput({ stateDir, runId, stepId });
  const aggregatorJudgement = aggregatorUi ? judgementFromUiOutput(stepId, aggregatorUi) : null;
  if (!aggregatorUi || aggregatorUi.parseErrors?.length || !aggregatorJudgement || !aggregatorJudgement.status) {
    return {
      kind: "failed",
      lastResult: reviewRoundResult(
        4,
        `${stepId} aggregator did not produce a usable ui-output.json judgement in round ${round}`,
        aggregatorUi?.parseErrors?.join("\n") || "ui-output.json missing or judgement field absent"
      ),
      rawLogPath: aggregatorRun.rawLogPath ?? null
    };
  }

  writeJudgement({
    stateDir,
    runId,
    stepId,
    kind: aggregatorJudgement.kind,
    status: aggregatorJudgement.status,
    summary: aggregatorJudgement.summary,
    source: "aggregator",
    details: {
      round,
      aggregatorPromptPath: aggregatorRun.promptPath,
      aggregatorRawLogPath: aggregatorRun.rawLogPath,
      reviewers: reviewerRuns.map((reviewerRun) => ({
        reviewerId: reviewerRun.reviewerId,
        label: reviewerRun.label,
        provider: reviewerRun.provider,
        status: reviewerRun.output?.status || null,
        summary: reviewerRun.output?.summary || null,
        artifactPath: reviewerRun.output?.artifactPath || null
      }))
    }
  });

  const roundRecord = {
    round,
    status: aggregatorJudgement.status,
    summary: aggregatorJudgement.summary,
    blockingFindings: aggregate.blockingFindings ?? aggregate.topFindings ?? [],
    repairSummary: null,
    verification: [],
    remainingRisks: []
  };
  roundHistory.push(roundRecord);

  // 3. Judgement accepted → success.
  if (judgementAcceptedForStep(stepId, aggregatorJudgement)) {
    recordReviewRoundArtifacts({ repo, runtime, step, runId, stepId, attempt, aggregate, aggregatorJudgement, roundHistory });
    appendProgressEvent({
      repoPath: repo,
      runId,
      stepId,
      attempt,
      type: "review_round_finished",
      provider: "runtime",
      message: `${stepId} review round ${round} passed`,
      payload: { round, status: aggregatorJudgement.status }
    });
    return {
      kind: "completed",
      lastResult: reviewRoundResult(0, aggregatorJudgement.summary || aggregatorJudgement.status)
    };
  }

  // (No explicit maxRounds branch: forceRerun (step 6) deterministically
  // fires once inPlaceRepairCount >= maxInPlaceRepairs, so the round
  // loop terminates there. If a flow ever wants a "give up after N
  // total rounds" cap distinct from in-place repairs, reintroduce it
  // here.)

  // 5. Repair.
  const repair = await executeReviewRepair({
    repo, runtime, step, reviewPlan, aggregate, attempt, round, provider: repairProvider, timeoutMs, idleTimeoutMs, options
  });
  roundRecord.repairSummary = repair.output?.summary || repair.result.finalMessage || "";
  roundRecord.verification = repair.output?.verification ?? [];
  roundRecord.remainingRisks = repair.output?.remainingRisks ?? [];

  if (repair.result.exitCode !== 0) {
    return {
      kind: "failed",
      lastResult: reviewRoundResultFromExec(repair.result, `${repairProvider} repair failed in round ${round}`),
      rawLogPath: repair.result.rawLogPath ?? null
    };
  }
  if (!repair.output || repair.output.parseErrors?.length) {
    return {
      kind: "failed",
      lastResult: reviewRoundResult(
        4,
        `repair output missing or invalid in round ${round}`,
        repair.output?.parseErrors?.join("\n") || "repair output missing"
      ),
      rawLogPath: repair.result.rawLogPath ?? null
    };
  }

  // 6. Repair → rerun-from (commit required, or forced after enough
  //    in-place rounds without convergence).
  const forceRerun = inPlaceRepairCount >= maxInPlaceRepairs;
  if (repair.output.commitRequired || forceRerun) {
    const targetStepId = repair.output.rerunTargetStep && getStep(runtime.flow, repair.output.rerunTargetStep)
      ? repair.output.rerunTargetStep
      : defaultRerunStep;
    const reviewBlockers = aggregate.blockingFindings ?? aggregate.topFindings ?? [];
    recordReviewBlockerEscalation({
      repo, runId, stepId, attempt, round, targetStepId,
      aggregate, repair: repair.output, blockers: reviewBlockers
    });
    rerunFromStep({
      repo, runtime, step, targetStepId,
      reason: repair.output.summary || `${stepId} repair signaled commit_required`
    });
    const rerunReason = repair.output.commitRequired
      ? "commit required"
      : `force-rerun after ${inPlaceRepairCount} in-place repair round(s)`;
    // The attempt itself finished cleanly (the reviewers ran and
    // reached a verdict, the repair ran and decided "restart from an
    // earlier step"). Caller writes attempt.status="completed" with
    // verdict="rerun_from" — that combination is what
    // hasCompletedProviderAttempt uses to keep this completed attempt
    // from triggering the on_success transition on a future re-entry
    // into the same step. run.current_step_id was already moved by
    // rerunFromStep above; the caller skips the post-loop updateRun
    // for this kind to preserve that move.
    return {
      kind: "rerun_from",
      lastResult: reviewRoundResult(0, `${stepId} rerun-from ${targetStepId} (${rerunReason})`)
    };
  }

  // 7. In-place repair → continue iterating.
  const nextInPlaceRepairCount = inPlaceRepairCount + 1;
  appendProgressEvent({
    repoPath: repo,
    runId,
    stepId,
    attempt,
    type: "review_round_finished",
    provider: "runtime",
    message: `${stepId} review round ${round} repaired; rerunning reviewers`,
    payload: { round, status: aggregate.status, verification: repair.output.verification ?? [], inPlaceRepairCount: nextInPlaceRepairCount, maxInPlaceRepairs }
  });
  return {
    kind: "continue",
    inPlaceRepairCount: nextInPlaceRepairCount,
    priorFindingsByReviewer: nextPriorFindings
  };
}

function recordReviewBlockerEscalation({ repo, runId, stepId, attempt, round, targetStepId, aggregate, repair, blockers }) {
  const now = new Date().toISOString();
  const findings = Array.isArray(blockers) ? blockers : [];
  const lines = [
    `Updated: ${now}`,
    `Round ${round} の repair が commit を要する blocker と判定したため、${targetStepId} へ差し戻します。`,
    "",
    "## Review aggregate",
    "",
    `- Status: ${aggregate?.status ?? "(unknown)"}`,
    `- Summary: ${aggregate?.summary ?? "(none)"}`
  ];
  if (findings.length > 0) {
    lines.push("", "## 残っている blocker", "");
    for (const finding of findings) {
      const severity = finding.severity ?? "review";
      const reviewer = finding.reviewerLabel ?? finding.reviewerId ?? "reviewer";
      lines.push(`- [${severity}] ${reviewer}: ${finding.title ?? "(untitled)"}`);
      if (finding.evidence) lines.push(`  - Evidence: ${finding.evidence}`);
      if (finding.recommendation) lines.push(`  - Recommendation: ${finding.recommendation}`);
    }
  }
  lines.push("", "## Repair report", "");
  lines.push(`- Summary: ${repair?.summary ?? "(none)"}`);
  if (Array.isArray(repair?.verification) && repair.verification.length > 0) {
    lines.push(`- Verification: ${repair.verification.join(" / ")}`);
  }
  if (Array.isArray(repair?.remainingRisks) && repair.remainingRisks.length > 0) {
    lines.push("- Remaining risks:");
    for (const risk of repair.remainingRisks) {
      lines.push(`  - ${risk}`);
    }
  }
  lines.push(
    "",
    "## ${targetStepId} 担当への申し送り".replace("${targetStepId}", targetStepId),
    "",
    "- 上記 blocker を解消する commit を作る (revert / 追加 commit / amend のどれかが必要)。",
    "- commit 後に runtime が再度 review を回します。",
    `- もとの ${stepId} round ${round} の repair artifact: \`.pdh-flow/runs/${runId}/steps/${stepId}/review-rounds/round-${round}/repair.json\``
  );
  const sectionHeading = `${stepId}. 修正依頼 (commit 必須)`;
  try {
    const note = loadCurrentNote(repo);
    const next = replaceNoteSection(note.body ?? "", sectionHeading, lines.join("\n"));
    saveCurrentNote(repo, { body: next });
  } catch (error) {
    process.stderr.write(`pdh-flow: warning: failed to record review blocker escalation note: ${error?.message || String(error)}\n`);
  }
  appendProgressEvent({
    repoPath: repo,
    runId,
    stepId,
    attempt,
    type: "review_rerun_requested",
    provider: "runtime",
    message: `${stepId} round ${round} commit_required → rerun-from ${targetStepId}`,
    payload: {
      round,
      targetStepId,
      blockerCount: findings.length,
      summary: repair?.summary ?? null
    }
  });
}

export function rerunFromStep({ repo, runtime, step, targetStepId, reason = null }) {
  resetTransitionArtifacts({
    runtime,
    currentStepId: step.id,
    targetStepId,
    preserveCurrentStep: true
  });
  updateRun(repo, { status: "running", current_step_id: targetStepId });
  appendStepHistoryEntry(repo, {
    stepId: step.id,
    status: "assist_rerun_from",
    commit: latestStepCommit(repo, step.id) ?? "-",
    summary: `Accepted assist proposal to rerun from ${targetStepId}${reason ? `: ${reason}` : ""}`
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

function resetTransitionArtifacts({ runtime, currentStepId, targetStepId, preserveCurrentStep = false }) {
  const sequence = runtime.flow.variants?.[runtime.run.flow_variant]?.sequence ?? [];
  const currentIndex = sequence.indexOf(currentStepId);
  const targetIndex = sequence.indexOf(targetStepId);
  if (currentIndex >= 0 && targetIndex >= 0 && targetIndex <= currentIndex) {
    const lastResetIndex = preserveCurrentStep ? currentIndex - 1 : currentIndex;
    for (let index = targetIndex; index <= lastResetIndex; index += 1) {
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
  const ticketId = runtime.run?.ticket_id ?? null;
  const closeCommit = commitStep({
    repoPath: repo,
    stepId: step.id,
    message: "Record final gate approval before ticket close",
    ticket: ticketId
  });
  // Pre-flight: ticket.sh close --dry-run validates that the real close
  // will succeed (no done/ collision, no main_repo dirty, no merge
  // conflict). On failure we abort BEFORE any mutation so the run lands
  // in needs_human cleanly rather than the partial-merge-no-commit state
  // that used to silently slip through.
  if (existsSync(join(repo, "ticket.sh"))) {
    const preflight = ticketCloseDryRun({ repoPath: repo, args: ["--keep-worktree"] });
    if (!preflight.ok) {
      appendProgressEvent({
        repoPath: repo,
        runId,
        stepId: step.id,
        type: "close_preflight_failed",
        provider: "runtime",
        message: `ticket.sh close --dry-run failed (exit ${preflight.exitCode ?? "n/a"})`,
        payload: {
          exitCode: preflight.exitCode,
          stdout: preflight.stdout,
          stderr: preflight.stderr,
          ticketId
        }
      });
      throw new Error(`ticket.sh close preflight failed: ${preflight.stderr || preflight.stdout || "unknown reason"}`);
    }
  }
  // ticket.sh close runs from the worktree cwd. --keep-worktree
  // preserves the directory so any open web server / agent shell that
  // is cwd-pinned here keeps working; the merge to default branch and
  // the feature-branch deletion still happen on the main repo.
  let closeResult: AnyRecord = { status: "skipped", reason: "ticket.sh not found" };
  if (existsSync(join(repo, "ticket.sh"))) {
    try {
      closeResult = ticketClose({ repoPath: repo, args: ["--keep-worktree"] });
    } catch (error) {
      closeResult = { status: "error", message: error?.message || String(error) };
    }
  }
  appendProgressEvent({
    repoPath: repo,
    runId,
    stepId: step.id,
    type: closeResult.status === "ok" ? "tool_finished" : closeResult.status === "error" ? "run_failed" : "status",
    provider: "runtime",
    message: closeResult.status === "ok"
      ? `ticket.sh close --keep-worktree (${ticketId ?? "ticket"})`
      : closeResult.status === "error"
        ? `ticket.sh close failed: ${closeResult.message ?? "unknown error"}`
        : `ticket.sh close skipped: ${closeResult.reason ?? "unknown"}`,
    payload: { ...closeResult, keepWorktree: true, ticketId }
  });
  // Real close failed despite preflight passing (TOCTOU). Don't claim
  // completed; surface as needs_human so the run isn't lost in a
  // partial-merge state.
  if (closeResult.status === "error") {
    if (closeCommit.status === "committed") {
      console.log(`close prep commit: ${closeCommit.commit}`);
    }
    console.log(`ticket.sh close: ERROR ${closeResult.message}`);
    throw new Error(`ticket.sh close failed after preflight passed: ${closeResult.message ?? "unknown"}`);
  }
  cleanupRunArtifacts({ repoPath: repo, runId });
  const pdh = loadPdhMeta(repo);
  savePdhMeta(repo, {
    ...pdh,
    status: "completed",
    current_step: null,
    completed_at: new Date().toISOString()
  });
  if (closeResult.status === "ok") {
    console.log(`ticket.sh close: ${firstLine(closeResult.stdout || closeResult.stderr || "ok")}`);
  }
  if (closeCommit.status === "committed") {
    console.log(`close prep commit: ${closeCommit.commit}`);
  }
}

export function ensureGateSummary({ repo, runtime, step }) {
  const existing = latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id });
  if (existing && existing.status === "needs_human") {
    return existing;
  }
  return refreshGateSummary({ repo, runtime, step });
}

export function refreshGateSummary({ repo, runtime, step }) {
  const existing = latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id });
  const gateContext = deriveHumanGateContext({ repo, runtime, step, existingGate: existing });
  openHumanGate({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    baseline: gateContext.baseline,
    rerunRequirement: gateContext.rerun_requirement
  });
  appendProgressEvent({
    repoPath: repo,
    runId: runtime.run.id,
    stepId: step.id,
    type: "gate_opened",
    provider: "runtime",
    message: `${step.id} human gate ready`,
    payload: {
      decision: gateDecisionText(step.id),
      baseline: gateContext.baseline ?? null,
      rerunRequirement: gateContext.rerun_requirement ?? null
    }
  });
  return latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id });
}

function collectGuardArtifacts(runtime, stepId) {
  const stepPath = stepDir(runtime.stateDir, runtime.run.id, stepId);
  return [
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
    return `The provider finished, but the guard-facing judgement could not be materialized because ui-output.json is malformed. Re-run \`run-next\`; if it repeats, inspect ui-output.json and the step prompt.`;
  }
  if (guard.type === "judgement_status" && /present in ui-output\.yaml/i.test(guard.evidence || "")) {
    return `The provider wrote a review judgement into ui-output.json, but the runtime judgement artifact is missing. Re-run \`run-next\`; if it repeats, inspect ui-output.json and judgements/.`;
  }
  if (guard.type === "judgement_status" && /provider step completed/i.test(guard.evidence || "")) {
    return `The provider step completed, but the review evidence needed by the guard is still missing. Inspect ui-output.json and judgements/ before retrying.`;
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

async function maybeAutoRepairReviewGuards({ repo, runtime, step, failedGuards, options }) {
  if (step.mode !== "review" || failedGuards.length === 0) {
    return null;
  }
  let reviewPlan = activeReviewPlan(runtime.flow, runtime.run.flow_variant, step.id);
  if (!reviewPlan) {
    return null;
  }
  // Also apply note overrides here so review-guard auto-repair picks
  // the same provider/roster as the main dispatch.
  const agent = resolveStepAgent({ flow: runtime.flow, runtimeRun: runtime.run, step });
  if (agent?.kind === "review") {
    reviewPlan = applyAgentOverrideToReviewPlan(reviewPlan, agent);
  }
  const repairProvider = reviewRepairProviderForStep(runtime.flow, step, reviewPlan);
  if (!repairProvider) {
    return null;
  }
  const latestAttempt = latestAttemptResult({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id,
    provider: step.provider
  });
  if (!latestAttempt || latestAttempt.status !== "completed") {
    return null;
  }

  const maxGuardRepairRounds = 2;
  let pendingGuards = failedGuards;
  let rounds = 0;
  while (rounds < maxGuardRepairRounds) {
    const repairFindings = guardRepairFindingsForStep(step, pendingGuards);
    if (!repairFindings) {
      return null;
    }
    rounds += 1;
    const round = nextReviewRoundNumber({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId: step.id
    });
    const beforeCommit = currentHead(repo);
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId: step.id,
      attempt: latestAttempt.attempt ?? null,
      type: "guard_repair_started",
      provider: "runtime",
      message: `${step.id} auto repair for guard failures started`,
      payload: {
        round,
        provider: repairProvider,
        failedGuards: pendingGuards.map((guard) => guard.guardId)
      }
    });
    const repair = await executeReviewRepair({
      repo,
      runtime,
      step,
      reviewPlan,
      aggregate: {
        status: "Guard Repair Required",
        acceptedStatus: null,
        summary: `Guard-facing evidence is still missing after ${step.id} review acceptance.`,
        reviewers: [],
        findings: repairFindings,
        blockingFindings: repairFindings,
        topFindings: repairFindings.filter((finding) => ["critical", "major"].includes(finding.severity)),
        readyWhen: Array.isArray(reviewPlan.passWhen) ? reviewPlan.passWhen : []
      },
      attempt: latestAttempt.attempt ?? nextStepAttempt({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId: step.id }),
      round,
      provider: repairProvider,
      timeoutMs: providerTimeoutMs({ options, flow: runtime.flow, step }),
      idleTimeoutMs: providerIdleTimeoutMs({ options, flow: runtime.flow, step }),
      options
    });
    if (repair.result.exitCode !== 0 || !repair.output || repair.output.parseErrors?.length) {
      appendProgressEvent({
        repoPath: repo,
        runId: runtime.run.id,
        stepId: step.id,
        attempt: latestAttempt.attempt ?? null,
        type: "guard_repair_failed",
        provider: "runtime",
        message: `${step.id} auto repair for guard failures failed`,
        payload: {
          round,
          provider: repairProvider,
          exitCode: repair.result.exitCode,
          parseErrors: repair.output?.parseErrors ?? []
        }
      });
      return null;
    }

    const commitResult = commitStep({
      repoPath: repo,
      stepId: step.id,
      message: repair.output.summary ? `Guard repair: ${repair.output.summary}` : "Guard repair",
      ticket: runtime.run?.ticket_id ?? null
    });
    let stepCommit = null;
    if (commitResult.status === "committed") {
      stepCommit = writeStepCommitRecord({
        repoPath: repo,
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId: step.id,
        beforeCommit
      });
      if (stepCommit) {
        appendProgressEvent({
          repoPath: repo,
          runId: runtime.run.id,
          stepId: step.id,
          attempt: latestAttempt.attempt ?? null,
          type: "artifact",
          provider: "runtime",
          message: `step commit ${stepCommit.short_commit}`,
          payload: { artifactPath: stepCommit.artifactPath, stepCommit }
        });
      }
    }

    const refreshedRuntime = requireRuntime(repo);
    hydrateStepArtifactsBeforeGuards({ repo, runtime: refreshedRuntime, step });
    const refreshedGuards = evaluateCurrentGuards({ repo, runtime: refreshedRuntime, step, gate: null });
    const stillFailed = refreshedGuards.filter((guard) => guard.status === "failed");
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId: step.id,
      attempt: latestAttempt.attempt ?? null,
      type: "guard_repair_finished",
      provider: "runtime",
      message: `${step.id} auto repair for guard failures ${stillFailed.length === 0 ? "resolved" : "left blockers"}`,
      payload: {
        round,
        provider: repairProvider,
        remainingGuards: stillFailed.map((guard) => guard.guardId),
        verification: repair.output.verification ?? []
      }
    });
    if (stillFailed.length === 0) {
      updateRun(repo, { status: "running", current_step_id: step.id });
      syncStepUiRuntime({ repo, stepId: step.id, guardResults: refreshedGuards, nextCommands: [runNextCommand(repo)] });
      return {
        status: "repaired",
        repairedGuards: failedGuards.map((guard) => guard.guardId),
        rounds
      };
    }
    pendingGuards = stillFailed;
  }
  return null;
}

function guardRepairFindingsForStep(step, failedGuards) {
  const findings = failedGuards.map((guard) => guardRepairFinding(step, guard));
  return findings.every(Boolean) ? findings : null;
}

function guardRepairFinding(step, guard) {
  if (guard.type === "note_section_updated") {
    return {
      severity: "major",
      reviewerId: "runtime-guard",
      reviewerLabel: "Runtime Guard",
      title: `Missing note evidence for ${guard.guardId}`,
      evidence: guard.evidence,
      recommendation: `Update \`current-note.md\` section \`${guard.section}\` so it exists, is non-empty, and reflects the accepted ${step.id} review outcome.`
    };
  }
  if (guard.type === "ticket_section_updated") {
    return {
      severity: "major",
      reviewerId: "runtime-guard",
      reviewerLabel: "Runtime Guard",
      title: `Missing ticket evidence for ${guard.guardId}`,
      evidence: guard.evidence,
      recommendation: `Update \`current-ticket.md\` section \`${guard.section}\` so it records the durable ticket intent or evidence required by ${step.id}.`
    };
  }
  if (guard.type === "ac_verification_table") {
    return {
      severity: "major",
      reviewerId: "runtime-guard",
      reviewerLabel: "Runtime Guard",
      title: `AC verification evidence missing for ${step.id}`,
      evidence: guard.evidence,
      recommendation: "Write or update `AC 裏取り結果` in `current-note.md` with one row per Product AC. Use the exact columns `item`, `classification`, `status`, `evidence`, and `deferral ticket`, and make the evidence concrete enough for deterministic guard checks."
    };
  }
  return null;
}

function nextReviewRoundNumber({ stateDir, runId, stepId }) {
  const dir = join(stateDir, "runs", runId, "steps", stepId, "review-rounds");
  if (!existsSync(dir)) {
    return 1;
  }
  const rounds = readdirSync(dir)
    .map((entry) => {
      const match = entry.match(/^round-(\d+)$/);
      return match ? Number(match[1]) : null;
    })
    .filter((value) => Number.isInteger(value));
  return rounds.length > 0 ? Math.max(...rounds) + 1 : 1;
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

function reviewRepairProviderForStep(flow, step, reviewPlan) {
  return reviewPlan?.repairProviderOverride
    || flow?.reviewers?.[step.id]?.repair
    || reviewPlan?.repairProvider
    || flow?.defaults?.reviewRepairProvider
    || null;
}

// Layer the resolved agent struct (from note frontmatter) on top of the
// flow yaml's review plan. Returns a new object; the original plan is
// not mutated. reviewers list is replaced wholesale when present;
// aggregator/repair are merged at the field level via the resolver's
// {provider, model} struct (model is for now informational — current
// review dispatch only uses provider strings).
function applyAgentOverrideToReviewPlan(reviewPlan, agent) {
  if (!reviewPlan) return reviewPlan;
  const overridden = { ...reviewPlan };
  if (agent.aggregator?.provider) {
    overridden.aggregatorProvider = agent.aggregator.provider;
    overridden.aggregatorModelOverride = agent.aggregator.model ?? null;
  }
  if (agent.repair?.provider) {
    overridden.repairProviderOverride = agent.repair.provider;
    overridden.repairModelOverride = agent.repair.model ?? null;
  }
  if (Array.isArray(agent.reviewers) && agent.reviewers.length) {
    overridden.reviewers = agent.reviewers;
  }
  if (Number.isInteger(agent.maxInPlaceRepairs) && agent.maxInPlaceRepairs > 0) {
    overridden.maxInPlaceRepairs = agent.maxInPlaceRepairs;
  }
  return overridden;
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

function printBlocked(result: AnyRecord, trace: AnyRecord[] = [], options: CliOptions = {}) {
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

function printStoppedAfterStep({
  completedStepId,
  nextStep,
  repo,
  trace = [],
  options = {}
}: {
  completedStepId: string;
  nextStep: AnyRecord;
  repo: string;
  trace?: AnyRecord[];
  options?: CliOptions;
}) {
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

function maybeStartTicket({ repo, ticket, worktree = false, required = false }: { repo: string; ticket: string | null; worktree?: boolean; required?: boolean }): AnyRecord | undefined {
  if (!ticket) {
    return;
  }
  if (!existsSync(join(repo, "ticket.sh"))) {
    if (required) {
      throw new Error("ticket.sh start required but ticket.sh was not found");
    }
    return {
      status: "skipped",
      message: "ticket.sh start skipped: ticket.sh not found",
      ticket
    };
  }
  return ticketStart({ repoPath: repo, ticket, worktree });
}

export function syncStepUiRuntime({ repo, stepId = null, guardResults = null, nextCommands = null }) {
  const runtime = loadRuntime(repo, { normalizeStaleRunning: true });
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

async function withRunSupervisor({ repo, command, action }) {
  const stateDir = defaultStateDir(repo);
  const runtime = loadRuntime(repo, { normalizeStaleRunning: true });
  startRunSupervisor({
    stateDir,
    repoPath: repo,
    runId: runtime.run?.id ?? null,
    stepId: runtime.run?.current_step_id ?? null,
    command,
    pid: process.pid
  });
  const supervisor = {
    sync(snapshot = null) {
      const current = snapshot ?? loadRuntime(repo, { normalizeStaleRunning: false });
      updateRunSupervisor({
        stateDir,
        fields: {
          runId: current.run?.id ?? null,
          stepId: current.run?.current_step_id ?? null
        }
      });
    }
  };
  try {
    return await action(supervisor);
  } finally {
    finishRunSupervisor({
      stateDir,
      status: "exited",
      exitCode: Number.isInteger(process.exitCode) ? process.exitCode : 0
    });
  }
}

export async function withRuntimeLock({ repo, options = {}, action }) {
  const runtime = loadRuntime(repo, { normalizeStaleRunning: true });
  const runId = runtime.run?.id ?? "active";
  return await withRunLock({
    stateDir: defaultStateDir(repo),
    runId,
    waitMs: nonNegativeInteger(options["lock-wait-ms"] ?? process.env.PDH_FLOWCHART_LOCK_WAIT_MS ?? "0", "--lock-wait-ms"),
    staleMs: nonNegativeInteger(options["lock-stale-ms"] ?? process.env.PDH_FLOWCHART_LOCK_STALE_MS ?? String(12 * 60 * 60 * 1000), "--lock-stale-ms")
  }, action);
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

function resolveTimeoutMs({ options, flow, step, optionKey, stepKey, defaultsKey, fieldName }) {
  if (options[optionKey] !== undefined) {
    return nonNegativeInteger(options[optionKey], `--${optionKey}`);
  }
  const minutes = step[stepKey] ?? flow.defaults?.[defaultsKey] ?? null;
  if (minutes === null || minutes === undefined) {
    return null;
  }
  const number = Number(minutes);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`provider ${fieldName} must be a non-negative number`);
  }
  return Math.round(number * 60 * 1000);
}

function providerTimeoutMs({ options, flow, step }) {
  return resolveTimeoutMs({
    options, flow, step,
    optionKey: "timeout-ms",
    stepKey: "timeoutMinutes",
    defaultsKey: "timeoutMinutes",
    fieldName: "timeoutMinutes"
  });
}

function providerIdleTimeoutMs({ options, flow, step }) {
  return resolveTimeoutMs({
    options, flow, step,
    optionKey: "idle-timeout-ms",
    stepKey: "idleTimeoutMinutes",
    defaultsKey: "idleTimeoutMinutes",
    fieldName: "idleTimeoutMinutes"
  });
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

export function readMessageOption(options, commandName) {
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
  const rawChangedFiles = normalizeGateChangedFiles(repo, splitLines(runGit(repo, ["diff", "--name-only", baseline.commit, "--"]).stdout));
  const changedFiles = rawChangedFiles.filter((path) => !path.startsWith(".pdh-flow/"));
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
    if (ticket.some((section) => ["Why", "What", "Product AC", "Acceptance Criteria", "Implementation Notes"].includes(section))
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
    if (ticket.some((section) => ["Why", "What", "Product AC", "Acceptance Criteria", "Implementation Notes"].includes(section))
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
  const matches = [...body.matchAll(/^#{2,3}\s+(.+)$/gm)];
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

function gitShowFile(repo, commit, relativePath, depth = 0) {
  const result = runGit(repo, ["show", `${commit}:${relativePath}`])?.stdout ?? "";
  if (depth > 4) return result;
  const lsTree = runGit(repo, ["ls-tree", commit, relativePath])?.stdout ?? "";
  const mode = lsTree.trim().split(/\s+/)[0];
  if (mode === "120000") {
    const target = result.trim();
    if (target && !target.startsWith("/")) {
      const baseDir = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/") + 1) : "";
      const resolved = baseDir + target;
      return gitShowFile(repo, commit, resolved, depth + 1);
    }
  }
  return result;
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

function providerProcessEntryId(stepId, attempt) {
  return `provider:${stepId}:attempt-${attempt}`;
}

function reviewerProcessEntryId(stepId, round, reviewerId, attempt) {
  return `reviewer:${stepId}:round-${round}:${reviewerId}:attempt-${attempt}`;
}

function repairProcessEntryId(stepId, round) {
  return `repair:${stepId}:round-${round}`;
}

function runGit(repo, args) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
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
