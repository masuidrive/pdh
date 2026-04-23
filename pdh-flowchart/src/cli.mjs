#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadDotEnv } from "./env.mjs";
import { loadFlow, getInitialStep, describeFlow } from "./flow.mjs";
import { runCodex } from "./codex-adapter.mjs";
import { runCalcSmoke } from "./smoke-calc.mjs";

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
  } else if (command === "guards") {
    await cmdGuards(args);
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
  pdh-flowchart run --ticket ID [--repo DIR] [--variant full|light]
  pdh-flowchart run-codex --repo DIR --prompt-file FILE [--step PD-C-6]
  pdh-flowchart guards --repo DIR --step PD-C-9
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

async function cmdRun(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const variant = options.variant ?? "full";
  const flow = loadFlow(options.flow ?? "pdh-ticket-core");
  const initial = getInitialStep(flow, variant);
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

async function cmdRunCodex(argv) {
  const { openStore, defaultStateDir } = await import("./db.mjs");
  const options = parseOptions(argv);
  const repo = resolve(required(options, "repo"));
  const stepId = options.step ?? "PD-C-6";
  const promptPath = resolve(required(options, "prompt-file"));
  const prompt = readFileSync(promptPath, "utf8");
  loadDotEnv();

  const store = openStore(defaultStateDir(repo));
  const runId = options.run ?? store.createRun({
    flowId: "pdh-ticket-core",
    flowVariant: options.variant ?? "full",
    ticketId: options.ticket ?? null,
    repoPath: repo,
    currentStepId: stepId
  });
  const attempt = Number(options.attempt ?? "1");
  const rawLogPath = join(store.stateDir, "runs", runId, "steps", stepId, `attempt-${attempt}`, "codex.raw.jsonl");
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
  console.log(`${run.id} ${run.status} ${run.current_step_id ?? ""}`);
  for (const event of store.recentEvents(runId, Number(options.limit ?? "20"))) {
    console.log(`${event.ts} ${event.step_id ?? "-"} ${event.type} ${event.message ?? ""}`);
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
