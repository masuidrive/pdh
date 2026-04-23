#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadDotEnv } from "./env.mjs";
import { loadFlow, getInitialStep, getStep, describeFlow, nextStep, outcomeFromDecision } from "./flow.mjs";
import { runCodex } from "./codex-adapter.mjs";
import { runClaude } from "./claude-adapter.mjs";
import { runCalcSmoke } from "./smoke-calc.mjs";
import { createGateSummary, commitStep, ticketStart, ticketClose } from "./actions.mjs";
import { writeStepPrompt } from "./prompt-templates.mjs";
import { writeRuntimeMetadata } from "./metadata.mjs";
import { captureNoteTicketPatchProposal, snapshotNoteTicketFiles } from "./patch-proposals.mjs";
import { defaultJudgementKind, loadJudgements, writeJudgement } from "./judgements.mjs";
import { runFinalVerification } from "./final-verification.mjs";
import { formatDoctor, runDoctor } from "./doctor.mjs";
import { withRunLock } from "./locks.mjs";
import { answerLatestInterruption, createInterruption, latestOpenInterruption, loadStepInterruptions, renderInterruptionMarkdown } from "./interruptions.mjs";
import { writeFailureSummary } from "./failure-summary.mjs";

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
    await cmdInit(args);
  } else if (command === "status") {
    await cmdStatus(args);
  } else if (command === "logs") {
    await cmdLogs(args);
  } else if (command === "show-gate") {
    await cmdShowGate(args);
  } else if (command === "doctor") {
    cmdDoctor(args);
  } else if (command === "web") {
    await cmdWeb(args);
  } else if (command === "run") {
    await cmdRun(args);
  } else if (command === "run-codex") {
    await cmdRunCodex(args);
  } else if (command === "run-claude") {
    await cmdRunClaude(args);
  } else if (command === "run-provider") {
    await cmdRunProvider(args);
  } else if (command === "resume") {
    await cmdResume(args);
  } else if (command === "prompt") {
    await cmdPrompt(args);
  } else if (command === "metadata") {
    await cmdMetadata(args);
  } else if (command === "judgement") {
    await cmdJudgement(args);
  } else if (command === "verify") {
    await cmdVerify(args);
  } else if (command === "guards") {
    await cmdGuards(args);
  } else if (command === "advance") {
    await cmdAdvance(args);
  } else if (command === "run-next") {
    await cmdRunNext(args);
  } else if (command === "gate-summary") {
    await cmdGateSummary(args);
  } else if (command === "interrupt") {
    await cmdInterrupt(args);
  } else if (command === "answer") {
    await cmdAnswer(args);
  } else if (command === "show-interrupts") {
    await cmdShowInterrupts(args);
  } else if (["approve", "reject", "request-changes", "cancel"].includes(command)) {
    await cmdHumanDecision(command, args);
  } else if (command === "commit-step") {
    cmdCommitStep(args);
  } else if (command === "ticket-start") {
    cmdTicketStart(args);
  } else if (command === "ticket-close") {
    cmdTicketClose(args);
  } else if (command === "smoke-calc") {
    await cmdSmokeCalc(args);
  } else if (command === "flow") {
    cmdFlow(args);
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
  pdh-flowchart flow [--variant full|light]
  pdh-flowchart run --ticket ID [--repo DIR] [--variant full|light] [--start-step PD-C-5] [--require-ticket-start]
  pdh-flowchart prompt RUN_ID [--repo DIR] [--step PD-C-6]
  pdh-flowchart metadata RUN_ID [--repo DIR]
  pdh-flowchart judgement RUN_ID [--repo DIR] [--step PD-C-4] [--kind plan_review] [--status "No Critical/Major"] [--summary TEXT]
  pdh-flowchart verify RUN_ID [--repo DIR] [--command "scripts/test-all.sh"]
  pdh-flowchart run-provider RUN_ID [--prompt-file FILE] [--repo DIR] [--timeout-ms MS] [--max-attempts N] [--retry-backoff-ms MS]
  pdh-flowchart resume RUN_ID [--prompt-file FILE] [--repo DIR]
  pdh-flowchart run-codex [RUN_ID] --prompt-file FILE [--repo DIR] [--step PD-C-6] [--timeout-ms MS] [--max-attempts N]
  pdh-flowchart run-claude [RUN_ID] --prompt-file FILE [--repo DIR] [--step PD-C-4] [--timeout-ms MS] [--max-attempts N]
  pdh-flowchart guards --repo DIR --step PD-C-9
  pdh-flowchart advance RUN_ID [--repo DIR] [--step PD-C-5]
  pdh-flowchart run-next RUN_ID [--repo DIR] [--limit 20]
  pdh-flowchart gate-summary RUN_ID --step PD-C-5 [--repo DIR]
  pdh-flowchart interrupt RUN_ID (--message TEXT | --file FILE) [--repo DIR] [--step PD-C-6]
  pdh-flowchart answer RUN_ID (--message TEXT | --file FILE) [--repo DIR] [--step PD-C-6]
  pdh-flowchart show-interrupts RUN_ID [--repo DIR] [--step PD-C-6] [--all] [--path]
  pdh-flowchart approve RUN_ID --step PD-C-5 [--reason TEXT]
  pdh-flowchart reject RUN_ID --step PD-C-5 [--reason TEXT]
  pdh-flowchart request-changes RUN_ID --step PD-C-10 [--reason TEXT]
  pdh-flowchart cancel RUN_ID --step PD-C-10 [--reason TEXT]
  pdh-flowchart commit-step --step PD-C-6 --message Implementation [--repo DIR]
  pdh-flowchart ticket-start --ticket ID [--repo DIR]
  pdh-flowchart ticket-close [--repo DIR]
  pdh-flowchart status RUN_ID [--repo DIR]
  pdh-flowchart logs RUN_ID [--repo DIR] [--follow] [--json]
  pdh-flowchart show-gate RUN_ID [--repo DIR] [--step PD-C-5] [--path]
  pdh-flowchart doctor [--repo DIR] [--json]
  pdh-flowchart web [--repo DIR] [--host 127.0.0.1] [--port 8765]
  pdh-flowchart smoke-calc [--workdir DIR]

Notes:
  - .env is loaded for provider commands only.
  - Provider commands use flow timeoutMinutes unless --timeout-ms is set.
  - Provider retries use flow maxAttempts unless --max-attempts is set.
  - Unit-style commands do not call external providers.
`);
}

async function cmdInit(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const store = openStore(defaultStateDir(repo));
  mkdirSync(join(store.stateDir, "artifacts"), { recursive: true });
  console.log(`Initialized ${store.stateDir}`);
}

function cmdFlow(argv) {
  const options = parseOptions(argv);
  const variant = options.variant ?? "full";
  const flow = loadFlow(options.flow ?? "pdh-ticket-core");
  console.log(describeFlow(flow, variant));
}

async function cmdGuards(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const stepId = required(options, "step");
  const flow = loadFlow(options.flow ?? "pdh-ticket-core");
  const { evaluateStepGuards } = await import("./guards.mjs");
  const results = evaluateStepGuards(flow, stepId, { repoPath: repo });
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => result.status === "failed")) {
    process.exitCode = 1;
  }
}

async function cmdAdvance(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error("advance requires RUN_ID");
  }
  const options = parseOptions(argv.filter((value) => value !== runId));
  const repo = resolve(options.repo ?? process.cwd());
  const store = openStore(defaultStateDir(repo));
  await withCommandRunLock({ store, runId, options, action: async () => {
    const run = store.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    const flow = loadFlow(options.flow ?? run.flow_id);
    const stepId = options.step ?? run.current_step_id;
    if (!stepId) {
      throw new Error(`Run has no current step: ${runId}`);
    }
    assertCurrentStep(run, stepId, options);
    const step = getStep(flow, stepId);
    const { evaluation, failed, actionBlock } = await evaluateStepWithRuntimeActions({ store, flow, runId, stepId, repo, step });
    const outcome = outcomeForStep(step, evaluation.humanGate);
    if (actionBlock) {
      const summary = createFailureSummaryForBlock({ store, repo, runId, stepId, step, block: actionBlock });
      actionBlock.failureSummary = summary.artifactPath;
      store.updateRun(runId, { status: "blocked", current_step_id: stepId });
      syncRunMetadata({ store, repo, runId });
      printBlocked(actionBlock, [], options);
      process.exitCode = 1;
      return;
    }
    if (failed.length > 0) {
      const summary = createFailureSummaryForBlock({
        store,
        repo,
        runId,
        stepId,
        step,
        block: { reason: "guard_failed", provider: step.provider, failedGuards: failed }
      });
      store.updateRun(runId, { status: "blocked", current_step_id: stepId });
      syncRunMetadata({ store, repo, runId });
      printBlocked({ status: "blocked", runId, stepId, reason: "guard_failed", provider: step.provider, failedGuards: failed, guardResults: evaluation.guardResults, failureSummary: summary.artifactPath }, [], options);
      process.exitCode = 1;
      return;
    }
    if (!outcome) {
      throw new Error(`Human gate has no terminal decision for ${stepId}`);
    }
    console.log(JSON.stringify(advanceRun({ store, flow, run, stepId, outcome, repoPath: repo }), null, 2));
  } });
}

async function cmdRunNext(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error("run-next requires RUN_ID");
  }
  const options = parseOptions(argv.filter((value) => value !== runId));
  const repo = resolve(options.repo ?? process.cwd());
  const store = openStore(defaultStateDir(repo));
  const limit = Number(options.limit ?? "20");
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit must be a positive integer");
  }

  await withCommandRunLock({ store, runId, options, action: async () => {
    const trace = [];
    for (let count = 0; count < limit; count += 1) {
      const run = store.getRun(runId);
      if (!run) {
        throw new Error(`Run not found: ${runId}`);
      }
      if (run.status === "completed") {
        console.log(JSON.stringify({ status: "completed", runId, trace }, null, 2));
        return;
      }
      const stepId = run.current_step_id;
      if (!stepId) {
        throw new Error(`Run has no current step: ${runId}`);
      }
      const flow = loadFlow(options.flow ?? run.flow_id);
      const step = getStep(flow, stepId);
      if (blockIfOpenInterruption({ store, runId, stepId, options, repo, step })) {
        return;
      }

      if (isHumanGateStep(step)) {
        const humanGate = store.latestHumanGate(runId, stepId);
        if (!humanGate) {
          const summary = createGateSummary({ repoPath: repo, stateDir: store.stateDir, runId, stepId });
          store.openHumanGate({
            runId,
            stepId,
            prompt: step.human_gate?.prompt ?? `${stepId} human gate`,
            summary: summary.artifactPath
          });
          syncRunMetadata({ store, repo, runId });
          const result = {
            status: "needs_human",
            runId,
            stepId,
            summary: summary.artifactPath,
            nextCommands: humanDecisionCommands(runId, stepId, repo)
          };
          trace.push(result);
          console.log(JSON.stringify({ ...result, trace }, null, 2));
          return;
        }
        if (humanGate.status === "needs_human") {
          const result = {
            status: "needs_human",
            runId,
            stepId,
            summary: humanGate.summary,
            nextCommands: humanDecisionCommands(runId, stepId, repo)
          };
          trace.push(result);
          console.log(JSON.stringify({ ...result, trace }, null, 2));
          return;
        }
      }

      const { evaluation, failed, actionBlock } = await evaluateStepWithRuntimeActions({ store, flow, runId, stepId, repo, step });
      const outcome = outcomeForStep(step, evaluation.humanGate);
      if (actionBlock) {
        const result = actionBlock;
        const summary = createFailureSummaryForBlock({ store, repo, runId, stepId, step, block: result });
        result.failureSummary = summary.artifactPath;
        store.updateRun(runId, { status: "blocked", current_step_id: stepId });
        syncRunMetadata({ store, repo, runId });
        store.addEvent({ runId, stepId, type: "blocked", provider: "runtime", message: `${stepId} ${result.reason}`, payload: result });
        trace.push(result);
        printBlocked(result, trace, options);
        return;
      }
      if (failed.length > 0) {
        const providerAttempted = step.provider !== "runtime"
          && store.nextStepAttempt({ runId, stepId, provider: step.provider }) > 1;
        const reason = step.provider === "runtime" || providerAttempted ? "guard_failed" : "provider_step_requires_execution";
        const result = {
          status: "blocked",
          runId,
          stepId,
          reason,
          provider: step.provider,
          failedGuards: failed,
          nextCommand: nextProviderCommand(runId, step, repo)
        };
        if (reason === "guard_failed") {
          const summary = createFailureSummaryForBlock({ store, repo, runId, stepId, step, block: result });
          result.failureSummary = summary.artifactPath;
        }
        store.updateRun(runId, { status: "blocked", current_step_id: stepId });
        syncRunMetadata({ store, repo, runId });
        store.addEvent({ runId, stepId, type: "blocked", provider: "runtime", message: `${stepId} ${reason}`, payload: result });
        trace.push(result);
        printBlocked(result, trace, options);
        return;
      }
      if (!outcome) {
        const result = {
          status: "blocked",
          runId,
          stepId,
          reason: "human_decision_required",
          provider: step.provider,
          nextCommands: humanDecisionCommands(runId, stepId, repo)
        };
        store.updateRun(runId, { status: "blocked", current_step_id: stepId });
        syncRunMetadata({ store, repo, runId });
        store.addEvent({ runId, stepId, type: "blocked", provider: "runtime", message: `${stepId} human_decision_required`, payload: result });
        trace.push(result);
        printBlocked(result, trace, options);
        return;
      }

      const advanced = advanceRun({ store, flow, run, stepId, outcome, repoPath: repo });
      trace.push(advanced);
      if (advanced.status === "completed") {
        console.log(JSON.stringify({ ...advanced, trace }, null, 2));
        return;
      }
    }

    printBlocked({ status: "blocked", runId, reason: "limit_reached", limit }, trace, options);
    process.exitCode = 1;
  } });
}

async function cmdRun(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const variant = options.variant ?? "full";
  const flow = loadFlow(options.flow ?? "pdh-ticket-core");
  const initial = options["start-step"] ?? getInitialStep(flow, variant);
  assertStepInVariant(flow, variant, initial);
  const store = openStore(defaultStateDir(repo));
  const runId = store.createRun({
    flowId: flow.flow,
    flowVariant: variant,
    ticketId: options.ticket ?? null,
    repoPath: repo,
    currentStepId: initial
  });
  store.addEvent({ runId, stepId: initial, type: "status", message: `Created ${describeFlow(flow, variant)}` });
  maybeStartTicket({ store, runId, repo, ticket: options.ticket ?? null, required: options["require-ticket-start"] === "true" });
  syncRunMetadata({ store, repo, runId });
  console.log(runId);
  console.log(`Current step: ${initial}`);
  console.log(`Next: ${runNextCommand(runId, repo)}`);
}

async function cmdGateSummary(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error("gate-summary requires RUN_ID");
  }
  const options = parseOptions(argv.filter((value) => value !== runId));
  const repo = resolve(options.repo ?? process.cwd());
  const stepId = required(options, "step");
  const store = openStore(defaultStateDir(repo));
  await withCommandRunLock({ store, runId, options, action: async () => {
    const run = store.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    assertCurrentStep(run, stepId, options);
    const summary = createGateSummary({ repoPath: repo, stateDir: store.stateDir, runId, stepId });
    store.openHumanGate({ runId, stepId, prompt: `${stepId} human gate`, summary: summary.artifactPath });
    syncRunMetadata({ store, repo, runId });
    console.log(summary.artifactPath);
    console.log(`Next: ${showGateCommand(runId, stepId, repo)}`);
  } });
}

async function cmdHumanDecision(command, argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error(`${command} requires RUN_ID`);
  }
  const options = parseOptions(argv.filter((value) => value !== runId));
  const repo = resolve(options.repo ?? process.cwd());
  const stepId = required(options, "step");
  const decisionByCommand = {
    approve: "approved",
    reject: "rejected",
    "request-changes": "changes_requested",
    cancel: "cancelled"
  };
  const store = openStore(defaultStateDir(repo));
  await withCommandRunLock({ store, runId, options, action: async () => {
    const run = store.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    assertCurrentStep(run, stepId, options);
    const latestGate = store.latestHumanGate(runId, stepId);
    if (!latestGate && options.force !== "true") {
      throw new Error(`No open human gate for ${stepId}; run gate-summary first or pass --force`);
    }
    if (latestGate && latestGate.status !== "needs_human" && options.force !== "true") {
      throw new Error(`Human gate for ${stepId} is already ${latestGate.status}; pass --force to override`);
    }
    store.resolveHumanGate({ runId, stepId, decision: decisionByCommand[command], reason: options.reason ?? null });
    syncRunMetadata({ store, repo, runId });
    console.log(`${runId} ${stepId} ${decisionByCommand[command]}`);
    console.log(`Next: ${runNextCommand(runId, repo)}`);
  } });
}

async function cmdInterrupt(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error("interrupt requires RUN_ID");
  }
  const options = parseOptions(argv.filter((value) => value !== runId));
  const repo = resolve(options.repo ?? process.cwd());
  const store = openStore(defaultStateDir(repo));
  await withCommandRunLock({ store, runId, options, action: async () => {
    const run = store.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    const stepId = options.step ?? run.current_step_id;
    if (!stepId) {
      throw new Error(`Run has no current step: ${runId}`);
    }
    assertCurrentStep(run, stepId, options);
    const message = readMessageOption(options, "interrupt");
    const interruption = createInterruption({
      stateDir: store.stateDir,
      runId,
      stepId,
      message,
      source: options.source ?? "user",
      kind: options.kind ?? "clarification"
    });
    store.updateRun(runId, { status: "interrupted", current_step_id: stepId });
    syncRunMetadata({ store, repo, runId });
    store.addEvent({ runId, stepId, type: "interrupted", provider: "runtime", message: `${stepId} interrupted`, payload: interruption });
    console.log(`${runId} ${stepId} interrupted`);
    console.log(`Interrupt: ${interruption.artifactPath}`);
    console.log("Next:");
    for (const command of interruptAnswerCommands(runId, stepId, repo)) {
      console.log(`- ${command}`);
    }
  } });
}

async function cmdAnswer(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error("answer requires RUN_ID");
  }
  const options = parseOptions(argv.filter((value) => value !== runId));
  const repo = resolve(options.repo ?? process.cwd());
  const store = openStore(defaultStateDir(repo));
  await withCommandRunLock({ store, runId, options, action: async () => {
    const run = store.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    const stepId = options.step ?? run.current_step_id;
    if (!stepId) {
      throw new Error(`Run has no current step: ${runId}`);
    }
    assertCurrentStep(run, stepId, options);
    const message = readMessageOption(options, "answer");
    const interruption = answerLatestInterruption({
      stateDir: store.stateDir,
      runId,
      stepId,
      message,
      source: options.source ?? "user"
    });
    store.updateRun(runId, { status: "running", current_step_id: stepId });
    syncRunMetadata({ store, repo, runId });
    store.addEvent({ runId, stepId, type: "interrupt_answered", provider: "runtime", message: `${stepId} interrupt answered`, payload: interruption });
    const flow = loadFlow(options.flow ?? run.flow_id);
    const step = getStep(flow, stepId);
    console.log(`${runId} ${stepId} answered`);
    console.log(`Answer: ${interruption.answerPath}`);
    if (step.provider !== "runtime") {
      console.log(`Next: ${resumeOrProviderCommand({ store, runId, stepId, step, repo })}`);
    }
  } });
}

async function cmdShowInterrupts(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error("show-interrupts requires RUN_ID");
  }
  const options = parseOptions(argv.filter((value) => value !== runId));
  const repo = resolve(options.repo ?? process.cwd());
  const store = openStore(defaultStateDir(repo));
  const run = store.getRun(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  const stepId = options.step ?? run.current_step_id;
  if (!stepId) {
    throw new Error(`Run has no current step: ${runId}`);
  }
  assertCurrentStep(run, stepId, options);
  const interruptions = loadStepInterruptions({ stateDir: store.stateDir, runId, stepId });
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

function maybeStartTicket({ store, runId, repo, ticket, required = false }) {
  if (!ticket) {
    return;
  }
  if (!existsSync(join(repo, "ticket.sh"))) {
    const message = "ticket.sh start skipped: ticket.sh not found";
    if (required) {
      throw new Error(message);
    }
    store.addEvent({ runId, type: "status", provider: "runtime", message, payload: { ticket } });
    return;
  }
  const result = ticketStart({ repoPath: repo, ticket });
  store.addEvent({ runId, type: "tool_finished", provider: "runtime", message: `ticket.sh start ${ticket}`, payload: result });
}

async function cmdRunCodex(argv, context = {}) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const positionalRunId = argv.find((value) => !value.startsWith("--"));
  const optionArgs = positionalRunId ? argv.filter((value) => value !== positionalRunId) : argv;
  const options = parseOptions(optionArgs);
  const repo = resolve(options.repo ?? process.cwd());
  const promptPath = resolve(required(options, "prompt-file"));
  const prompt = readFileSync(promptPath, "utf8");
  loadDotEnv();

  const store = openStore(defaultStateDir(repo));
  let run = positionalRunId ? store.getRun(positionalRunId) : null;
  if (positionalRunId && !run) {
    throw new Error(`Run not found: ${positionalRunId}`);
  }
  const runId = positionalRunId ?? options.run ?? store.createRun({
    flowId: "pdh-ticket-core",
    flowVariant: options.variant ?? "full",
    ticketId: options.ticket ?? null,
    repoPath: repo,
    currentStepId: options.step ?? "PD-C-6"
  });
  await withCommandRunLock({ store, runId, options, context, action: async () => {
    run = store.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    const stepId = options.step ?? run.current_step_id ?? "PD-C-6";
    assertCurrentStep(run, stepId, options);
    const flow = loadFlow(options.flow ?? run.flow_id);
    const step = getStep(flow, stepId);
    if (step.provider !== "codex" && options.force !== "true") {
      throw new Error(`${stepId} uses provider ${step.provider}; refusing to run Codex without --force`);
    }
    if (blockIfOpenInterruption({ store, runId, stepId, options, repo, step })) {
      return;
    }
    const timeoutMs = providerTimeoutMs({ options, flow, step });
    let attempt = providerStartAttempt({ store, runId, stepId, provider: "codex", options });
    let maxAttempts = providerMaxAttempts({ options, flow, step, startAttempt: attempt });
    if (attempt > maxAttempts) {
      if (options.force !== "true") {
        throw new Error(`${stepId} exhausted max attempts (${maxAttempts}); pass --force, --attempt, or --max-attempts to override.`);
      }
      maxAttempts = attempt;
    }
    let status = "failed";
    let rawLogPath = null;
    let lastResult = null;
    while (attempt <= maxAttempts) {
      rawLogPath = join(store.stateDir, "runs", runId, "steps", stepId, `attempt-${attempt}`, "codex.raw.jsonl");
      const resumeSession = resolveProviderResume({ store, runId, stepId, provider: "codex", option: options.resume ?? null });
      store.updateRun(runId, { status: "running", current_step_id: stepId });
      syncRunMetadata({ store, repo, runId });
      const noteTicketBefore = snapshotNoteTicketFiles({ repoPath: repo });
      store.startStep({ runId, stepId, attempt, provider: "codex", mode: "edit" });
      const result = await runCodex({
        cwd: repo,
        prompt,
        rawLogPath,
        bypass: options.bypass !== "false",
        model: options.model ?? null,
        resume: resumeSession,
        timeoutMs,
        killGraceMs: providerKillGraceMs(options),
        onEvent(event) {
          store.addEvent({ runId, stepId, attempt, type: event.type, provider: "codex", message: event.message, payload: event.payload ?? {} });
        }
      });
      lastResult = result;
      store.saveProviderSession({ runId, stepId, attempt, provider: "codex", sessionId: result.sessionId, rawLogPath });
      status = result.exitCode === 0 ? "completed" : "failed";
      store.finishStep({ runId, stepId, attempt, provider: "codex", status, exitCode: result.exitCode, summary: result.finalMessage, error: result.stderr || null });
      const patchProposal = captureNoteTicketPatchProposal({ repoPath: repo, stateDir: store.stateDir, runId, stepId, attempt, before: noteTicketBefore });
      if (patchProposal.status === "written") {
        store.addEvent({ runId, stepId, attempt, type: "artifact", provider: "runtime", message: `note/ticket patch proposal ${patchProposal.artifactPath}`, payload: patchProposal });
      }
      if (status === "completed" || attempt >= maxAttempts) {
        break;
      }
      const delayMs = retryDelayMs(options, attempt);
      store.addEvent({ runId, stepId, attempt, type: "retry", provider: "runtime", message: `retrying codex attempt ${attempt + 1} after ${delayMs}ms`, payload: { nextAttempt: attempt + 1, maxAttempts, delayMs, exitCode: result.exitCode, timedOut: result.timedOut === true } });
      await sleep(delayMs);
      attempt += 1;
    }
    store.updateRun(runId, { status: status === "completed" ? "running" : "failed", current_step_id: stepId });
    syncRunMetadata({ store, repo, runId });
    console.log(`${runId} ${stepId} ${status}`);
    console.log(`Attempt: ${attempt}/${maxAttempts}`);
    console.log(`Raw log: ${rawLogPath}`);
    if (status === "completed") {
      console.log(`Next: ${runNextCommand(runId, repo)}`);
    } else {
      const summary = createProviderFailureSummary({
        store,
        repo,
        runId,
        stepId,
        step,
        attempt,
        maxAttempts,
        rawLogPath,
        result: lastResult
      });
      console.log(`Failure Summary: ${summary.artifactPath}`);
      console.log(`Next: ${statusCommand(runId, repo)}`);
      console.log(`Retry: ${resumeCommand(runId, repo)}`);
    }
  } });
}

async function cmdResume(argv) {
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error("resume requires RUN_ID");
  }
  await cmdRunProvider([...argv, "--resume", "latest"]);
}

async function cmdRunProvider(argv, context = {}) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error("run-provider requires RUN_ID");
  }
  const options = parseOptions(argv.filter((value) => value !== runId));
  const repo = resolve(options.repo ?? process.cwd());
  const store = openStore(defaultStateDir(repo));
  await withCommandRunLock({ store, runId, options, context, action: async () => {
    const run = store.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    const stepId = options.step ?? run.current_step_id;
    if (!stepId) {
      throw new Error(`Run has no current step: ${runId}`);
    }
    assertCurrentStep(run, stepId, options);
    const flow = loadFlow(options.flow ?? run.flow_id);
    const step = getStep(flow, stepId);
    if (blockIfOpenInterruption({ store, runId, stepId, options, repo, step })) {
      return;
    }
    let providerArgv = argv;
    if (!options["prompt-file"] && step.provider !== "runtime") {
      const prompt = writeStepPrompt({ repoPath: repo, stateDir: store.stateDir, run, flow, stepId });
      store.addEvent({ runId, stepId, type: "artifact", provider: "runtime", message: `prompt generated ${prompt.artifactPath}`, payload: { path: prompt.artifactPath } });
      providerArgv = [...argv, "--prompt-file", prompt.artifactPath];
    }
    if (step.provider === "codex") {
      await cmdRunCodex(providerArgv, { lockHeld: true });
      return;
    }
    if (step.provider === "claude") {
      await cmdRunClaude(providerArgv, { lockHeld: true });
      return;
    }
    throw new Error(`${stepId} uses provider ${step.provider}; run-provider only supports codex and claude steps`);
  } });
}

async function cmdPrompt(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error("prompt requires RUN_ID");
  }
  const options = parseOptions(argv.filter((value) => value !== runId));
  const repo = resolve(options.repo ?? process.cwd());
  const store = openStore(defaultStateDir(repo));
  await withCommandRunLock({ store, runId, options, action: async () => {
    const run = store.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    const flow = loadFlow(options.flow ?? run.flow_id);
    const stepId = options.step ?? run.current_step_id;
    if (!stepId) {
      throw new Error(`Run has no current step: ${runId}`);
    }
    assertCurrentStep(run, stepId, options);
    const prompt = writeStepPrompt({ repoPath: repo, stateDir: store.stateDir, run, flow, stepId });
    store.addEvent({ runId, stepId, type: "artifact", provider: "runtime", message: `prompt generated ${prompt.artifactPath}`, payload: { path: prompt.artifactPath } });
    console.log(prompt.artifactPath);
  } });
}

async function cmdMetadata(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error("metadata requires RUN_ID");
  }
  const options = parseOptions(argv.filter((value) => value !== runId));
  const repo = resolve(options.repo ?? process.cwd());
  const store = openStore(defaultStateDir(repo));
  await withCommandRunLock({ store, runId, options, action: async () => {
    const metadata = syncRunMetadata({ store, repo, runId });
    console.log(JSON.stringify(metadata, null, 2));
  } });
}

async function cmdJudgement(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error("judgement requires RUN_ID");
  }
  const options = parseOptions(argv.filter((value) => value !== runId));
  const repo = resolve(options.repo ?? process.cwd());
  const store = openStore(defaultStateDir(repo));
  await withCommandRunLock({ store, runId, options, action: async () => {
    const run = store.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    const stepId = options.step ?? run.current_step_id;
    if (!stepId) {
      throw new Error(`Run has no current step: ${runId}`);
    }
    assertCurrentStep(run, stepId, options);
    const kind = options.kind ?? defaultJudgementKind(stepId);
    const result = writeJudgement({
      stateDir: store.stateDir,
      runId,
      stepId,
      kind,
      status: options.status ?? null,
      summary: options.summary ?? null,
      source: options.source ?? "runtime",
      details: { reason: options.reason ?? null }
    });
    store.addEvent({ runId, stepId, type: "artifact", provider: "runtime", message: `judgement ${result.judgement.kind}: ${result.judgement.status}`, payload: { artifactPath: result.artifactPath, judgement: result.judgement } });
    console.log(JSON.stringify(result, null, 2));
  } });
}

async function cmdVerify(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error("verify requires RUN_ID");
  }
  const options = parseOptions(argv.filter((value) => value !== runId));
  const repo = resolve(options.repo ?? process.cwd());
  const store = openStore(defaultStateDir(repo));
  await withCommandRunLock({ store, runId, options, action: async () => {
    const run = store.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    const stepId = options.step ?? run.current_step_id;
    if (!stepId) {
      throw new Error(`Run has no current step: ${runId}`);
    }
    assertCurrentStep(run, stepId, options);
    if (stepId !== "PD-C-9" && options.force !== "true") {
      throw new Error(`verify is for PD-C-9; current step is ${stepId}. Pass --force to override.`);
    }
    const result = runFinalVerification({
      repoPath: repo,
      stateDir: store.stateDir,
      runId,
      stepId,
      command: options.command ?? null
    });
    store.addEvent({ runId, stepId, type: "artifact", provider: "runtime", message: `final verification ${result.result.status}`, payload: result });
    syncRunMetadata({ store, repo, runId });
    console.log(JSON.stringify(result, null, 2));
    if (result.result.status !== "passed") {
      process.exitCode = 1;
    }
  } });
}

async function cmdRunClaude(argv, context = {}) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const positionalRunId = argv.find((value) => !value.startsWith("--"));
  const optionArgs = positionalRunId ? argv.filter((value) => value !== positionalRunId) : argv;
  const options = parseOptions(optionArgs);
  const repo = resolve(options.repo ?? process.cwd());
  const promptPath = resolve(required(options, "prompt-file"));
  const prompt = readFileSync(promptPath, "utf8");
  loadDotEnv();

  const store = openStore(defaultStateDir(repo));
  let run = positionalRunId ? store.getRun(positionalRunId) : null;
  if (positionalRunId && !run) {
    throw new Error(`Run not found: ${positionalRunId}`);
  }
  const runId = positionalRunId ?? options.run ?? store.createRun({
    flowId: "pdh-ticket-core",
    flowVariant: options.variant ?? "full",
    ticketId: options.ticket ?? null,
    repoPath: repo,
    currentStepId: options.step ?? "PD-C-4"
  });
  await withCommandRunLock({ store, runId, options, context, action: async () => {
    run = store.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    const stepId = options.step ?? run.current_step_id ?? "PD-C-4";
    assertCurrentStep(run, stepId, options);
    const flow = loadFlow(options.flow ?? run.flow_id);
    const step = getStep(flow, stepId);
    if (step.provider !== "claude" && options.force !== "true") {
      throw new Error(`${stepId} uses provider ${step.provider}; refusing to run Claude without --force`);
    }
    if (blockIfOpenInterruption({ store, runId, stepId, options, repo, step })) {
      return;
    }
    const timeoutMs = providerTimeoutMs({ options, flow, step });
    const permissionMode = options["permission-mode"] ?? (options.bypass === "true" ? "bypassPermissions" : "acceptEdits");
    let attempt = providerStartAttempt({ store, runId, stepId, provider: "claude", options });
    let maxAttempts = providerMaxAttempts({ options, flow, step, startAttempt: attempt });
    if (attempt > maxAttempts) {
      if (options.force !== "true") {
        throw new Error(`${stepId} exhausted max attempts (${maxAttempts}); pass --force, --attempt, or --max-attempts to override.`);
      }
      maxAttempts = attempt;
    }
    let status = "failed";
    let rawLogPath = null;
    let lastResult = null;
    while (attempt <= maxAttempts) {
      rawLogPath = join(store.stateDir, "runs", runId, "steps", stepId, `attempt-${attempt}`, "claude.raw.jsonl");
      const resumeSession = resolveProviderResume({ store, runId, stepId, provider: "claude", option: options.resume ?? null });
      store.updateRun(runId, { status: "running", current_step_id: stepId });
      syncRunMetadata({ store, repo, runId });
      const noteTicketBefore = snapshotNoteTicketFiles({ repoPath: repo });
      store.startStep({ runId, stepId, attempt, provider: "claude", mode: step.mode ?? "review" });
      const result = await runClaude({
        cwd: repo,
        prompt,
        rawLogPath,
        bare: options.bare === "true",
        includePartialMessages: options["include-partial-messages"] === "true",
        model: options.model ?? null,
        permissionMode,
        resume: resumeSession,
        timeoutMs,
        killGraceMs: providerKillGraceMs(options),
        onEvent(event) {
          store.addEvent({ runId, stepId, attempt, type: event.type, provider: "claude", message: event.message, payload: event.payload ?? {} });
        }
      });
      lastResult = result;
      store.saveProviderSession({ runId, stepId, attempt, provider: "claude", sessionId: result.sessionId, rawLogPath });
      status = result.exitCode === 0 ? "completed" : "failed";
      store.finishStep({ runId, stepId, attempt, provider: "claude", status, exitCode: result.exitCode, summary: result.finalMessage, error: result.stderr || null });
      const patchProposal = captureNoteTicketPatchProposal({ repoPath: repo, stateDir: store.stateDir, runId, stepId, attempt, before: noteTicketBefore });
      if (patchProposal.status === "written") {
        store.addEvent({ runId, stepId, attempt, type: "artifact", provider: "runtime", message: `note/ticket patch proposal ${patchProposal.artifactPath}`, payload: patchProposal });
      }
      if (status === "completed" || attempt >= maxAttempts) {
        break;
      }
      const delayMs = retryDelayMs(options, attempt);
      store.addEvent({ runId, stepId, attempt, type: "retry", provider: "runtime", message: `retrying claude attempt ${attempt + 1} after ${delayMs}ms`, payload: { nextAttempt: attempt + 1, maxAttempts, delayMs, exitCode: result.exitCode, timedOut: result.timedOut === true } });
      await sleep(delayMs);
      attempt += 1;
    }
    store.updateRun(runId, { status: status === "completed" ? "running" : "failed", current_step_id: stepId });
    syncRunMetadata({ store, repo, runId });
    console.log(`${runId} ${stepId} ${status}`);
    console.log(`Attempt: ${attempt}/${maxAttempts}`);
    console.log(`Raw log: ${rawLogPath}`);
    if (status === "completed") {
      console.log(`Next: ${runNextCommand(runId, repo)}`);
    } else {
      const summary = createProviderFailureSummary({
        store,
        repo,
        runId,
        stepId,
        step,
        attempt,
        maxAttempts,
        rawLogPath,
        result: lastResult
      });
      console.log(`Failure Summary: ${summary.artifactPath}`);
      console.log(`Next: ${statusCommand(runId, repo)}`);
      console.log(`Retry: ${resumeCommand(runId, repo)}`);
    }
  } });
}

async function cmdStatus(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error("status requires RUN_ID");
  }
  const options = parseOptions(argv.filter((value) => value !== runId));
  const repo = resolve(options.repo ?? process.cwd());
  const store = openStore(defaultStateDir(repo));
  const run = store.getRun(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  console.log(`Run: ${run.id}`);
  console.log(`Status: ${run.status}`);
  console.log(`Current Step: ${run.current_step_id ?? "-"}`);
  if (run.current_step_id) {
    const flow = loadFlow(run.flow_id);
    const step = getStep(flow, run.current_step_id);
    console.log(`Provider: ${step.provider}`);
    console.log(`Mode: ${step.mode}`);
    if (step.guards?.length) {
      console.log(`Guards: ${step.guards.map((guard) => guard.id).join(", ")}`);
    }
    const gate = store.latestHumanGate(runId, run.current_step_id);
    if (gate) {
      console.log(`Human Gate: ${gate.status}${gate.decision ? ` (${gate.decision})` : ""}`);
      if (gate.summary) {
        console.log(`Gate Summary: ${gate.summary}`);
      }
    }
    const interruption = latestOpenInterruption({ stateDir: store.stateDir, runId, stepId: run.current_step_id });
    if (interruption) {
      console.log(`Interruption: open ${interruption.id}`);
      console.log(`Interruption File: ${interruption.artifactPath}`);
    }
  }
  console.log("Recent Events:");
  for (const event of store.recentEvents(runId, Number(options.limit ?? "20"))) {
    console.log(`- ${event.ts} ${event.step_id ?? "-"} ${event.type} ${event.message ?? ""}`);
  }
}

async function cmdLogs(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error("logs requires RUN_ID");
  }
  const options = parseOptions(argv.filter((value) => value !== runId));
  const repo = resolve(options.repo ?? process.cwd());
  const store = openStore(defaultStateDir(repo));
  const run = store.getRun(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  let cursor = 0;
  for (const event of store.recentEvents(runId, Number(options.limit ?? "50"))) {
    printEvent(event, options.json === "true");
    cursor = Math.max(cursor, event.id);
  }
  if (options.follow !== "true") {
    return;
  }
  const intervalMs = Number(options.interval ?? "1000");
  while (true) {
    await sleep(intervalMs);
    for (const event of store.eventsAfter(runId, cursor, 100)) {
      printEvent(event, options.json === "true");
      cursor = Math.max(cursor, event.id);
    }
  }
}

async function cmdShowGate(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const runId = argv.find((value) => !value.startsWith("--"));
  if (!runId) {
    throw new Error("show-gate requires RUN_ID");
  }
  const options = parseOptions(argv.filter((value) => value !== runId));
  const repo = resolve(options.repo ?? process.cwd());
  const store = openStore(defaultStateDir(repo));
  const run = store.getRun(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  const stepId = options.step ?? run.current_step_id;
  if (!stepId) {
    throw new Error(`Run has no current step: ${runId}`);
  }
  assertCurrentStep(run, stepId, options);
  const gate = store.latestHumanGate(runId, stepId);
  if (!gate) {
    throw new Error(`No human gate found for ${stepId}`);
  }
  if (!gate.summary) {
    throw new Error(`Human gate for ${stepId} has no summary`);
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
    const shutdown = () => {
      server.close(resolveServer);
    };
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
    if (result.verifyStderr) {
      console.log(result.verifyStderr);
    }
    process.exitCode = 1;
  }
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

async function withCommandRunLock({ store, runId, options = {}, context = {}, action }) {
  if (context.lockHeld) {
    return await action();
  }
  return await withRunLock({
    stateDir: store.stateDir,
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

function providerStartAttempt({ store, runId, stepId, provider, options }) {
  if (options.attempt !== undefined) {
    return positiveInteger(options.attempt, "--attempt");
  }
  return store.nextStepAttempt({ runId, stepId, provider });
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

function printEvent(event, json = false) {
  if (json) {
    console.log(JSON.stringify(normalizeEvent(event)));
    return;
  }
  const provider = event.provider ? ` ${event.provider}` : "";
  const message = event.message ? ` ${event.message}` : "";
  console.log(`#${event.id} ${event.ts} ${event.step_id ?? "-"} ${event.type}${provider}${message}`);
}

function printBlocked(result, trace = [], options = {}) {
  if (options.json === "true") {
    console.log(JSON.stringify({ ...result, trace }, null, 2));
    return;
  }
  const step = result.stepId ? ` ${result.stepId}` : "";
  const reason = result.reason ? ` (${result.reason})` : "";
  console.log(`Blocked:${step}${reason}`);
  if (result.provider) {
    console.log(`Provider: ${result.provider}`);
  }
  const transitions = trace.filter((entry) => entry.status === "advanced");
  if (transitions.length > 0) {
    console.log(`Trace: ${transitions.map((entry) => `${entry.from} -> ${entry.to}`).join(", ")}`);
  }
  const failed = result.failedGuards ?? (result.guardResults ?? []).filter((guard) => guard.status === "failed");
  if (failed.length > 0) {
    console.log("Failed Guards:");
    for (const guard of failed) {
      console.log(`- ${guard.guardId}: ${guard.evidence}`);
    }
  }
  if (result.message) {
    console.log(`Message: ${result.message}`);
  }
  if (result.failureSummary) {
    console.log(`Failure Summary: ${result.failureSummary}`);
  }
  if (result.nextCommand) {
    console.log(`Next: ${result.nextCommand}`);
  }
  if (result.nextCommands?.length) {
    console.log("Next:");
    for (const command of result.nextCommands) {
      console.log(`- ${command}`);
    }
  }
  if (result.reason === "limit_reached") {
    console.log(`Limit: ${result.limit}`);
  }
  console.log("Use --json for full guard details.");
}

function blockIfOpenInterruption({ store, runId, stepId, options = {}, repo, step }) {
  if (options.force === "true") {
    return false;
  }
  const interruption = latestOpenInterruption({ stateDir: store.stateDir, runId, stepId });
  if (!interruption) {
    return false;
  }
  const result = {
    status: "interrupted",
    runId,
    stepId,
    reason: "needs_interrupt_answer",
    provider: step.provider,
    message: `Open interruption ${interruption.id} must be answered before ${stepId} continues.`,
    artifactPath: interruption.artifactPath,
    nextCommands: interruptAnswerCommands(runId, stepId, repo)
  };
  store.updateRun(runId, { status: "interrupted", current_step_id: stepId });
  syncRunMetadata({ store, repo, runId });
  store.addEvent({ runId, stepId, type: "interrupted", provider: "runtime", message: `${stepId} needs interrupt answer`, payload: result });
  printBlocked(result, [], options);
  process.exitCode = 1;
  return true;
}

function createFailureSummaryForBlock({ store, repo, runId, stepId, step, block }) {
  const nextCommands = [
    ...(block.nextCommand ? [block.nextCommand] : []),
    ...(block.nextCommands ?? [])
  ];
  const summary = writeFailureSummary({
    stateDir: store.stateDir,
    repoPath: repo,
    runId,
    stepId,
    reason: block.reason ?? "blocked",
    provider: block.provider ?? step.provider ?? "runtime",
    status: block.status ?? "blocked",
    failedGuards: block.failedGuards ?? [],
    nextCommands
  });
  store.addEvent({
    runId,
    stepId,
    type: "artifact",
    provider: "runtime",
    message: `failure summary ${summary.artifactPath}`,
    payload: { artifactPath: summary.artifactPath, reason: block.reason ?? "blocked" }
  });
  return summary;
}

function createProviderFailureSummary({ store, repo, runId, stepId, step, attempt, maxAttempts, rawLogPath, result }) {
  const summary = writeFailureSummary({
    stateDir: store.stateDir,
    repoPath: repo,
    runId,
    stepId,
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
    nextCommands: [
      statusCommand(runId, repo),
      resumeCommand(runId, repo)
    ]
  });
  store.addEvent({
    runId,
    stepId,
    attempt,
    type: "artifact",
    provider: "runtime",
    message: `failure summary ${summary.artifactPath}`,
    payload: { artifactPath: summary.artifactPath, reason: result?.timedOut ? "provider_timeout" : "provider_failed" }
  });
  return summary;
}

function normalizeEvent(event) {
  return {
    id: event.id,
    runId: event.run_id,
    stepId: event.step_id,
    attempt: event.attempt,
    ts: event.ts,
    type: event.type,
    provider: event.provider,
    message: event.message,
    payload: event.payload_json ? JSON.parse(event.payload_json) : null
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function required(options, key) {
  if (!options[key]) {
    throw new Error(`Missing --${key}`);
  }
  return options[key];
}

function readMessageOption(options, command) {
  if (options.message !== undefined) {
    return options.message;
  }
  if (options.file) {
    return readFileSync(resolve(options.file), "utf8");
  }
  throw new Error(`${command} requires --message TEXT or --file FILE`);
}

function collectStepArtifacts(stateDir, runId, stepId) {
  const stepDir = join(stateDir, "runs", runId, "steps", stepId);
  return [
    { kind: "human_gate_summary", path: join(stepDir, "human-gate-summary.md") },
    ...loadJudgements({ stateDir, runId, stepId }).map((judgement) => ({
      kind: judgement.kind,
      path: judgement.artifactPath
    }))
  ];
}

async function evaluateCurrentStep({ store, flow, runId, stepId, repo }) {
  const { evaluateStepGuards } = await import("./guards.mjs");
  const humanGate = store.latestHumanGate(runId, stepId);
  const artifacts = collectStepArtifacts(store.stateDir, runId, stepId);
  const guardResults = evaluateStepGuards(flow, stepId, {
    repoPath: repo,
    artifacts,
    judgements: loadJudgements({ stateDir: store.stateDir, runId, stepId }),
    humanDecision: humanGate?.decision ?? null,
    ticketClosed: hasTicketClosedArtifact(store.stateDir, runId, stepId)
  });
  for (const result of guardResults) {
    store.addEvent({
      runId,
      stepId,
      type: result.status === "passed" || result.status === "skipped" ? "guard_finished" : "guard_failed",
      provider: "runtime",
      message: `${result.guardId}: ${result.status}`,
      payload: result
    });
  }
  return { humanGate, artifacts, guardResults };
}

async function evaluateStepWithRuntimeActions({ store, flow, runId, stepId, repo, step }) {
  let evaluation = await evaluateCurrentStep({ store, flow, runId, stepId, repo });
  let failed = blockingGuardFailures(step, evaluation.guardResults, evaluation.humanGate);
  if (shouldCloseTicket(step, evaluation.humanGate, failed)) {
    const closeResult = closeTicketAfterApproval({ store, repo, runId, stepId });
    if (closeResult.status === "missing") {
      return {
        evaluation,
        failed,
        actionBlock: {
          status: "blocked",
          runId,
          stepId,
          reason: "ticket_close_unavailable",
          provider: "runtime",
          failedGuards: failed,
          message: "ticket.sh is required to close PD-C-10 but was not found"
        }
      };
    }
    evaluation = await evaluateCurrentStep({ store, flow, runId, stepId, repo });
    failed = blockingGuardFailures(step, evaluation.guardResults, evaluation.humanGate);
  }
  return { evaluation, failed, actionBlock: null };
}

function shouldCloseTicket(step, humanGate, failed) {
  return step.id === "PD-C-10"
    && humanGate?.decision === "approved"
    && failed.length === 1
    && failed[0].type === "ticket_closed";
}

function closeTicketAfterApproval({ store, repo, runId, stepId }) {
  const artifactDir = join(store.stateDir, "runs", runId, "steps", stepId);
  const artifactPath = join(artifactDir, "ticket-close.json");
  if (existsSync(artifactPath)) {
    return { status: "already_closed", artifactPath };
  }
  if (!existsSync(join(repo, "ticket.sh"))) {
    return { status: "missing" };
  }
  const result = ticketClose({ repoPath: repo });
  mkdirSync(artifactDir, { recursive: true });
  const body = { status: "closed", at: new Date().toISOString(), result };
  writeFileSync(artifactPath, JSON.stringify(body, null, 2));
  store.addEvent({ runId, stepId, type: "tool_finished", provider: "runtime", message: "ticket.sh close", payload: { ...body, artifactPath } });
  return { status: "closed", artifactPath };
}

function hasTicketClosedArtifact(stateDir, runId, stepId) {
  return existsSync(join(stateDir, "runs", runId, "steps", stepId, "ticket-close.json"));
}

function blockingGuardFailures(step, guardResults, humanGate) {
  if (isHumanGateStep(step) && humanGate?.decision && humanGate.decision !== "approved") {
    return [];
  }
  return guardResults.filter((result) => result.status === "failed");
}

function outcomeForStep(step, humanGate) {
  if (isHumanGateStep(step)) {
    return humanGate?.decision ? outcomeFromDecision(humanGate.decision) : null;
  }
  return "success";
}

function advanceRun({ store, flow, run, stepId, outcome, repoPath = null }) {
  const target = nextStep(flow, run.flow_variant, stepId, outcome);
  if (!target) {
    throw new Error(`No transition from ${stepId} for ${outcome}`);
  }
  const status = target === "COMPLETE" ? "completed" : "running";
  const currentStepId = target === "COMPLETE" ? stepId : target;
  if (target === "COMPLETE") {
    store.updateRun(run.id, { status, current_step_id: currentStepId, completed_at: new Date().toISOString() });
  } else {
    store.updateRun(run.id, { status, current_step_id: currentStepId });
  }
  if (repoPath) {
    syncRunMetadata({ store, repo: repoPath, runId: run.id });
  }
  store.addEvent({ runId: run.id, stepId, type: "status", provider: "runtime", message: `[${stepId}] -> [${target}]`, payload: { outcome, target } });
  return { status: target === "COMPLETE" ? "completed" : "advanced", from: stepId, to: target, outcome };
}

function syncRunMetadata({ store, repo, runId }) {
  const current = store.getRun(runId);
  if (!current) {
    throw new Error(`Run not found: ${runId}`);
  }
  const metadata = writeRuntimeMetadata({ repoPath: repo, run: current });
  store.addEvent({ runId, stepId: current.current_step_id, type: "artifact", provider: "runtime", message: "metadata synced", payload: metadata });
  return metadata;
}

function isHumanGateStep(step) {
  return step.provider === "runtime" && step.mode === "human" && Boolean(step.human_gate);
}

function humanDecisionCommands(runId, stepId, repo = null) {
  const repoArg = repo ? ` --repo ${shellQuote(repo)}` : "";
  return [
    `node src/cli.mjs approve ${runId}${repoArg} --step ${stepId} --reason ok`,
    `node src/cli.mjs request-changes ${runId}${repoArg} --step ${stepId} --reason "<reason>"`,
    `node src/cli.mjs reject ${runId}${repoArg} --step ${stepId} --reason "<reason>"`
  ];
}

function runNextCommand(runId, repo = null) {
  const repoArg = repo ? ` --repo ${shellQuote(repo)}` : "";
  return `node src/cli.mjs run-next ${runId}${repoArg}`;
}

function statusCommand(runId, repo = null) {
  const repoArg = repo ? ` --repo ${shellQuote(repo)}` : "";
  return `node src/cli.mjs status ${runId}${repoArg}`;
}

function resumeCommand(runId, repo = null) {
  const repoArg = repo ? ` --repo ${shellQuote(repo)}` : "";
  return `node src/cli.mjs resume ${runId}${repoArg}`;
}

function showGateCommand(runId, stepId, repo = null) {
  const repoArg = repo ? ` --repo ${shellQuote(repo)}` : "";
  return `node src/cli.mjs show-gate ${runId}${repoArg} --step ${stepId}`;
}

function interruptAnswerCommands(runId, stepId, repo = null) {
  const repoArg = repo ? ` --repo ${shellQuote(repo)}` : "";
  return [
    `node src/cli.mjs show-interrupts ${runId}${repoArg} --step ${stepId}`,
    `node src/cli.mjs answer ${runId}${repoArg} --step ${stepId} --message "<answer>"`
  ];
}

function resumeOrProviderCommand({ store, runId, stepId, step, repo = null }) {
  const repoArg = repo ? ` --repo ${shellQuote(repo)}` : "";
  const session = store.latestProviderSession(runId, stepId, step.provider);
  if (session?.session_id || session?.resume_token) {
    return `node src/cli.mjs resume ${runId}${repoArg}`;
  }
  return nextProviderCommand(runId, step, repo);
}

function nextProviderCommand(runId, step, repo = null) {
  const repoArg = repo ? ` --repo ${shellQuote(repo)}` : "";
  if (step.provider === "codex") {
    return `node src/cli.mjs run-provider ${runId}${repoArg}`;
  }
  if (step.provider === "claude") {
    return `node src/cli.mjs run-provider ${runId}${repoArg}`;
  }
  return null;
}

function resolveProviderResume({ store, runId, stepId, provider, option }) {
  if (!option) {
    return null;
  }
  if (!["true", "latest", "last"].includes(option)) {
    return option;
  }
  const session = store.latestProviderSession(runId, stepId, provider);
  const token = session?.resume_token ?? session?.session_id ?? null;
  if (!token) {
    throw new Error(`No saved ${provider} session for ${stepId}; cannot resume`);
  }
  return token;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
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
