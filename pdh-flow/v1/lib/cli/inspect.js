// Read-only / status inspection commands.
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { buildFlowView, describeFlow, getStep, loadFlow, renderMermaidFlow } from "../flow/load.js";
import { latestOpenInterruption, loadStepInterruptions, renderInterruptionMarkdown } from "../runtime/interruptions.js";
import { latestAttemptResult, latestHumanGate, loadPdhMeta, loadRuntime, progressPath, readProgressEvents } from "../runtime/state.js";
import { formatDoctor, runDoctor } from "../runtime/doctor.js";
import { formatProposal } from "./assist.js";
import { assertCurrentStep, formatStepName, parseOptions, requireRuntime, sleep } from "./utils.js";
export function cmdFlow(argv) {
    const options = parseOptions(argv);
    const variant = options.variant ?? "full";
    const flow = loadFlow(options.flow ?? "pdh-ticket-core");
    console.log(describeFlow(flow, variant));
}
export function cmdFlowGraph(argv) {
    const options = parseOptions(argv);
    const variant = options.variant ?? "full";
    const flow = loadFlow(options.flow ?? "pdh-ticket-core");
    const repo = resolve(options.repo ?? process.cwd());
    const currentStepId = options.current ?? loadRuntime(repo, { normalizeStaleRunning: true }).run?.current_step_id ?? null;
    if (options.format === "json") {
        console.log(JSON.stringify(buildFlowView(flow, variant, currentStepId), null, 2));
        return;
    }
    console.log(renderMermaidFlow(flow, variant, currentStepId));
}
export function cmdMetadata(argv) {
    const options = parseOptions(argv);
    const repo = resolve(options.repo ?? process.cwd());
    const pdh = loadPdhMeta(repo);
    console.log(JSON.stringify(pdh, null, 2));
}
export function cmdShowInterrupts(argv) {
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
export function cmdStatus(argv) {
    const options = parseOptions(argv);
    const repo = resolve(options.repo ?? process.cwd());
    const runtime = loadRuntime(repo, { normalizeStaleRunning: true });
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
        if (gate.baseline?.commit) {
            console.log(`Gate Baseline: ${gate.baseline.commit.slice(0, 7)}${gate.baseline.step_id ? ` from ${gate.baseline.step_id}` : ""}`);
        }
        if (gate.rerun_requirement?.target_step_id) {
            console.log(`Gate Rerun: ${gate.rerun_requirement.target_step_id}`);
        }
        if (gate.proposal?.status === "pending") {
            console.log(`Proposal: ${formatProposal(gate.proposal)}`);
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
export async function cmdLogs(argv) {
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
            }
            catch {
                // Ignore partial lines.
            }
        }
    }
}
export function cmdDoctor(argv) {
    const options = parseOptions(argv);
    const repo = resolve(options.repo ?? process.cwd());
    const result = runDoctor({ repoPath: repo });
    if (options.json === "true") {
        console.log(JSON.stringify(result, null, 2));
    }
    else {
        console.log(formatDoctor(result));
    }
    if (result.status === "fail") {
        process.exitCode = 1;
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
