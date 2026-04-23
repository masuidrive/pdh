#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadDotEnv } from "./env.mjs";
import { loadFlow, getInitialStep, getStep, describeFlow, nextStep, outcomeFromDecision } from "./flow.mjs";
import { runCodex } from "./codex-adapter.mjs";
import { runClaude } from "./claude-adapter.mjs";
import { runCalcSmoke } from "./smoke-calc.mjs";
import { createGateSummary, commitStep, ticketStart, ticketClose } from "./actions.mjs";

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
  } else if (command === "run") {
    await cmdRun(args);
  } else if (command === "run-codex") {
    await cmdRunCodex(args);
  } else if (command === "run-claude") {
    await cmdRunClaude(args);
  } else if (command === "guards") {
    await cmdGuards(args);
  } else if (command === "advance") {
    await cmdAdvance(args);
  } else if (command === "run-next") {
    await cmdRunNext(args);
  } else if (command === "gate-summary") {
    await cmdGateSummary(args);
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
  pdh-flowchart run --ticket ID [--repo DIR] [--variant full|light] [--start-step PD-C-5]
  pdh-flowchart run-codex [RUN_ID] --prompt-file FILE [--repo DIR] [--step PD-C-6]
  pdh-flowchart run-claude [RUN_ID] --prompt-file FILE [--repo DIR] [--step PD-C-4]
  pdh-flowchart guards --repo DIR --step PD-C-9
  pdh-flowchart advance RUN_ID [--repo DIR] [--step PD-C-5]
  pdh-flowchart run-next RUN_ID [--repo DIR] [--limit 20]
  pdh-flowchart gate-summary RUN_ID --step PD-C-5 [--repo DIR]
  pdh-flowchart approve RUN_ID --step PD-C-5 [--reason TEXT]
  pdh-flowchart reject RUN_ID --step PD-C-5 [--reason TEXT]
  pdh-flowchart request-changes RUN_ID --step PD-C-10 [--reason TEXT]
  pdh-flowchart cancel RUN_ID --step PD-C-10 [--reason TEXT]
  pdh-flowchart commit-step --step PD-C-6 --message Implementation [--repo DIR]
  pdh-flowchart ticket-start --ticket ID [--repo DIR]
  pdh-flowchart ticket-close [--repo DIR]
  pdh-flowchart status RUN_ID [--repo DIR]
  pdh-flowchart smoke-calc [--workdir DIR]

Notes:
  - .env is loaded for provider commands only.
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
  const evaluation = await evaluateCurrentStep({ store, flow, runId, stepId, repo });
  const outcome = outcomeForStep(step, evaluation.humanGate);
  const failed = blockingGuardFailures(step, evaluation.guardResults, evaluation.humanGate);
  if (failed.length > 0) {
    store.updateRun(runId, { status: "blocked", current_step_id: stepId });
    console.log(JSON.stringify({ status: "blocked", stepId, guardResults: evaluation.guardResults }, null, 2));
    process.exitCode = 1;
    return;
  }
  if (!outcome) {
    throw new Error(`Human gate has no terminal decision for ${stepId}`);
  }
  console.log(JSON.stringify(advanceRun({ store, flow, run, stepId, outcome }), null, 2));
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

    const evaluation = await evaluateCurrentStep({ store, flow, runId, stepId, repo });
    const outcome = outcomeForStep(step, evaluation.humanGate);
    const failed = blockingGuardFailures(step, evaluation.guardResults, evaluation.humanGate);
    if (failed.length > 0) {
      const reason = step.provider === "runtime" ? "guard_failed" : "provider_step_requires_execution";
      const result = {
        status: "blocked",
        runId,
        stepId,
        reason,
        provider: step.provider,
        failedGuards: failed,
        nextCommand: nextProviderCommand(runId, step, repo)
      };
      store.updateRun(runId, { status: "blocked", current_step_id: stepId });
      store.addEvent({ runId, stepId, type: "blocked", provider: "runtime", message: `${stepId} ${reason}`, payload: result });
      trace.push(result);
      console.log(JSON.stringify({ ...result, trace }, null, 2));
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
      store.addEvent({ runId, stepId, type: "blocked", provider: "runtime", message: `${stepId} human_decision_required`, payload: result });
      trace.push(result);
      console.log(JSON.stringify({ ...result, trace }, null, 2));
      return;
    }

    const advanced = advanceRun({ store, flow, run, stepId, outcome });
    trace.push(advanced);
    if (advanced.status === "completed") {
      console.log(JSON.stringify({ ...advanced, trace }, null, 2));
      return;
    }
  }

  console.log(JSON.stringify({ status: "blocked", runId, reason: "limit_reached", limit, trace }, null, 2));
  process.exitCode = 1;
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
  console.log(runId);
  console.log(`Current step: ${initial}`);
  console.log("Run provider steps with run-codex while the Full flow engine is being expanded.");
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
  const run = store.getRun(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  assertCurrentStep(run, stepId, options);
  const summary = createGateSummary({ repoPath: repo, stateDir: store.stateDir, runId, stepId });
  store.openHumanGate({ runId, stepId, prompt: `${stepId} human gate`, summary: summary.artifactPath });
  console.log(summary.artifactPath);
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
  console.log(`${runId} ${stepId} ${decisionByCommand[command]}`);
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

async function cmdRunCodex(argv) {
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
  run ??= store.getRun(runId);
  const stepId = options.step ?? run.current_step_id ?? "PD-C-6";
  assertCurrentStep(run, stepId, options);
  const flow = loadFlow(options.flow ?? run.flow_id);
  const step = getStep(flow, stepId);
  if (step.provider !== "codex" && options.force !== "true") {
    throw new Error(`${stepId} uses provider ${step.provider}; refusing to run Codex without --force`);
  }
  const attempt = Number(options.attempt ?? "1");
  const rawLogPath = join(store.stateDir, "runs", runId, "steps", stepId, `attempt-${attempt}`, "codex.raw.jsonl");
  store.updateRun(runId, { status: "running", current_step_id: stepId });
  store.startStep({ runId, stepId, attempt, provider: "codex", mode: "edit" });
  const result = await runCodex({
    cwd: repo,
    prompt,
    rawLogPath,
    bypass: options.bypass !== "false",
    model: options.model ?? null,
    onEvent(event) {
      store.addEvent({ runId, stepId, attempt, type: event.type, provider: "codex", message: event.message, payload: event.payload ?? {} });
    }
  });
  store.saveProviderSession({ runId, stepId, attempt, provider: "codex", sessionId: result.sessionId, rawLogPath });
  const status = result.exitCode === 0 ? "completed" : "failed";
  store.finishStep({ runId, stepId, attempt, provider: "codex", status, exitCode: result.exitCode, summary: result.finalMessage, error: result.stderr || null });
  store.updateRun(runId, { status: result.exitCode === 0 ? "running" : "failed", current_step_id: stepId });
  console.log(`${runId} ${stepId} ${status}`);
  console.log(`Raw log: ${rawLogPath}`);
}

async function cmdRunClaude(argv) {
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
  run ??= store.getRun(runId);
  const stepId = options.step ?? run.current_step_id ?? "PD-C-4";
  assertCurrentStep(run, stepId, options);
  const flow = loadFlow(options.flow ?? run.flow_id);
  const step = getStep(flow, stepId);
  if (step.provider !== "claude" && options.force !== "true") {
    throw new Error(`${stepId} uses provider ${step.provider}; refusing to run Claude without --force`);
  }
  const attempt = Number(options.attempt ?? "1");
  const rawLogPath = join(store.stateDir, "runs", runId, "steps", stepId, `attempt-${attempt}`, "claude.raw.jsonl");
  const permissionMode = options["permission-mode"] ?? (options.bypass === "true" ? "bypassPermissions" : "acceptEdits");
  store.updateRun(runId, { status: "running", current_step_id: stepId });
  store.startStep({ runId, stepId, attempt, provider: "claude", mode: step.mode ?? "review" });
  const result = await runClaude({
    cwd: repo,
    prompt,
    rawLogPath,
    bare: options.bare === "true",
    includePartialMessages: options["include-partial-messages"] === "true",
    model: options.model ?? null,
    permissionMode,
    resume: options.resume ?? null,
    onEvent(event) {
      store.addEvent({ runId, stepId, attempt, type: event.type, provider: "claude", message: event.message, payload: event.payload ?? {} });
    }
  });
  store.saveProviderSession({ runId, stepId, attempt, provider: "claude", sessionId: result.sessionId, rawLogPath });
  const status = result.exitCode === 0 ? "completed" : "failed";
  store.finishStep({ runId, stepId, attempt, provider: "claude", status, exitCode: result.exitCode, summary: result.finalMessage, error: result.stderr || null });
  store.updateRun(runId, { status: result.exitCode === 0 ? "running" : "failed", current_step_id: stepId });
  console.log(`${runId} ${stepId} ${status}`);
  console.log(`Raw log: ${rawLogPath}`);
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
  }
  console.log("Recent Events:");
  for (const event of store.recentEvents(runId, Number(options.limit ?? "20"))) {
    console.log(`- ${event.ts} ${event.step_id ?? "-"} ${event.type} ${event.message ?? ""}`);
  }
}

async function cmdSmokeCalc(argv) {
  const options = parseOptions(argv);
  loadDotEnv();
  const result = await runCalcSmoke({
    rootDir: resolve(options.workdir ?? "/tmp/pdh-flowchart-calc-smoke"),
    bypass: options.bypass !== "false"
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

function required(options, key) {
  if (!options[key]) {
    throw new Error(`Missing --${key}`);
  }
  return options[key];
}

function collectStepArtifacts(stateDir, runId, stepId) {
  const stepDir = join(stateDir, "runs", runId, "steps", stepId);
  return [
    { kind: "human_gate_summary", path: join(stepDir, "human-gate-summary.md") }
  ];
}

async function evaluateCurrentStep({ store, flow, runId, stepId, repo }) {
  const { evaluateStepGuards } = await import("./guards.mjs");
  const humanGate = store.latestHumanGate(runId, stepId);
  const artifacts = collectStepArtifacts(store.stateDir, runId, stepId);
  const guardResults = evaluateStepGuards(flow, stepId, {
    repoPath: repo,
    artifacts,
    humanDecision: humanGate?.decision ?? null
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

function advanceRun({ store, flow, run, stepId, outcome }) {
  const target = nextStep(flow, run.flow_variant, stepId, outcome);
  if (!target) {
    throw new Error(`No transition from ${stepId} for ${outcome}`);
  }
  if (target === "COMPLETE") {
    store.updateRun(run.id, { status: "completed", current_step_id: stepId, completed_at: new Date().toISOString() });
  } else {
    store.updateRun(run.id, { status: "running", current_step_id: target });
  }
  store.addEvent({ runId: run.id, stepId, type: "status", provider: "runtime", message: `[${stepId}] -> [${target}]`, payload: { outcome, target } });
  return { status: target === "COMPLETE" ? "completed" : "advanced", from: stepId, to: target, outcome };
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

function nextProviderCommand(runId, step, repo = null) {
  const repoArg = repo ? ` --repo ${shellQuote(repo)}` : "";
  if (step.provider === "codex") {
    return `node src/cli.mjs run-codex ${runId}${repoArg} --prompt-file <prompt.md> --step ${step.id}`;
  }
  if (step.provider === "claude") {
    return `node src/cli.mjs run-claude ${runId}${repoArg} --prompt-file <prompt.md> --step ${step.id}`;
  }
  return null;
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
