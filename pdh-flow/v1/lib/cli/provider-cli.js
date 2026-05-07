import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getStep } from "../flow/load.js";
import { createInterruption } from "../runtime/interruptions.js";
import { withRunLock } from "../runtime/locks.js";
import { appendProgressEvent, defaultStateDir, updateRun } from "../runtime/state.js";
import { writeStepUiRuntime } from "../runtime/ui.js";
import { assertCurrentStep, interruptStopCommands, parseOptions, requireRuntime } from "./utils.js";
export async function runProviderCli(argv) {
    const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "help";
    const rest = command === "help" ? argv.filter((token, index) => !(index === 0 && token === "help")) : argv.slice(1);
    if (command === "help" || command === "--help" || command === "-h") {
        printUsage();
    }
    else if (command === "ask" || command === "interrupt") {
        await cmdAsk(rest);
    }
    else {
        throw new Error(`Unknown provider command: ${command}`);
    }
}
async function cmdAsk(argv) {
    const options = parseOptions(argv);
    const repo = resolve(options.repo ?? process.cwd());
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const message = readMessageOption(options, "ask");
    const stateDir = defaultStateDir(repo);
    await withRunLock({
        stateDir,
        runId: runtime.run.id,
        waitMs: nonNegativeInteger(options["lock-wait-ms"] ?? process.env.PDH_FLOWCHART_LOCK_WAIT_MS ?? "0", "--lock-wait-ms"),
        staleMs: nonNegativeInteger(options["lock-stale-ms"] ?? process.env.PDH_FLOWCHART_LOCK_STALE_MS ?? String(12 * 60 * 60 * 1000), "--lock-stale-ms")
    }, async () => {
        const current = requireRuntime(repo);
        const lockedStepId = options.step ?? current.run.current_step_id;
        assertCurrentStep(current.run, lockedStepId, options);
        const step = getStep(current.flow, lockedStepId);
        const interruption = createInterruption({
            stateDir: current.stateDir,
            runId: current.run.id,
            stepId: lockedStepId,
            message,
            source: options.source ?? "provider",
            kind: options.kind ?? "clarification"
        });
        updateRun(repo, { status: "interrupted", current_step_id: lockedStepId });
        appendProgressEvent({
            repoPath: repo,
            runId: current.run.id,
            stepId: lockedStepId,
            type: "interrupted",
            provider: step.provider,
            message: `${lockedStepId} interrupted by provider`,
            payload: interruption
        });
        const refreshed = requireRuntime(repo);
        writeStepUiRuntime({
            repoPath: repo,
            runtime: refreshed,
            step,
            nextCommands: interruptStopCommands(repo, lockedStepId)
        });
        console.log(`${lockedStepId} interrupted`);
        console.log(`Interrupt: ${interruption.artifactPath}`);
        console.log("Next:");
        for (const commandText of interruptStopCommands(repo, lockedStepId)) {
            console.log(`- ${commandText}`);
        }
    });
}
function printUsage() {
    console.log(`pdh-flow provider

Usage:
  pdh-flow provider ask [--repo DIR] (--message TEXT | --file FILE) [--step PD-C-6] [--kind clarification]
  pdh-flow provider help

Provider-safe commands only:
  ask         Open an interruption for the current step and stop for user input.

Notes:
  - This app is for provider-side runtime handoff only.
  - It does not run flow progression commands such as run-next or approve.
  - The current step is used by default; pass --step only when it still matches the active step.`);
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
function nonNegativeInteger(value, label) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
        throw new Error(`${label} must be a non-negative integer`);
    }
    return number;
}
