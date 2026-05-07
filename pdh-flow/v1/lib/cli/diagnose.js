// pdh-flow diagnose
//
// Asks claude (or a stand-in CLAUDE_BIN script) to look at the stuck state
// at the current step and emit a single propose-* signal to unblock it.
// The signal lands in gate.proposal via the same pipe assist-signal uses,
// so the user's web UI shows the proposal in ProposalCard exactly as if a
// human ran assist-open and submitted a signal manually.
//
// Two-phase contract with claude:
// 1. We feed claude the same prompt assist-open would, plus a DIAGNOSE
//    MODE suffix telling it to emit one JSON object on its last line:
//      {"signal": "propose-...", "targetStep": "<id-or-null>", "reason": "..."}
// 2. We parse the LAST {...} block out of claude's stream-json stdout,
//    validate the shape, and pass it through cmdAssistSignal.
//
// On any failure (wrong status, no parseable JSON, signal not allowed for
// the current state) we exit non-zero so callers can fall back to
// "open the assist terminal manually". We never silently apply an
// unintended proposal.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { getStep } from "../flow/load.js";
import { loadDotEnv } from "../support/env.js";
import { latestHumanGate } from "../runtime/state.js";
import { prepareAssistSession } from "../runtime/assist/runtime.js";
import { cmdAssistSignal } from "./assist.js";
import { withRuntimeLock } from "./index.js";
import { assertCurrentStep, parseOptions, requireRuntime } from "./utils.js";
const DIAGNOSABLE_STATUSES = new Set(["blocked", "failed", "needs_human", "interrupted"]);
const DEFAULT_TIMEOUT_MS = 120000;
export async function cmdDiagnose(argv) {
    const options = parseOptions(argv);
    const repo = resolve(options.repo ?? process.cwd());
    loadDotEnv();
    let prepared = null;
    let stepId = null;
    let allowedSignals = [];
    let runtimeStatus = null;
    await withRuntimeLock({
        repo,
        options,
        action: async () => {
            const runtime = requireRuntime(repo);
            stepId = options.step ?? runtime.run.current_step_id;
            assertCurrentStep(runtime.run, stepId, options);
            runtimeStatus = runtime.run.status;
            if (!DIAGNOSABLE_STATUSES.has(runtimeStatus)) {
                throw new Error(`diagnose: run.status=${runtimeStatus} is not diagnosable (allowed: ${[...DIAGNOSABLE_STATUSES].join(", ")})`);
            }
            const step = getStep(runtime.flow, stepId);
            const _gate = latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId });
            void _gate; // unused; prepareAssistSession reloads it itself
            prepared = prepareAssistSession({
                repoPath: repo,
                runtime,
                step,
                bare: false,
                model: options.model ?? null
            });
            allowedSignals = prepared.allowedSignals ?? [];
        }
    });
    if (!allowedSignals.length) {
        throw new Error(`diagnose: no propose-* signal is allowed for ${stepId} at status=${runtimeStatus}`);
    }
    const promptBody = readFileSync(prepared.promptPath, "utf8");
    const systemPrompt = readFileSync(prepared.systemPromptPath, "utf8");
    const fullPrompt = `${promptBody}\n${diagnoseSuffix({ allowedSignals })}`;
    const claudeBin = process.env.CLAUDE_BIN || "claude";
    const claudeArgs = [
        "--append-system-prompt", systemPrompt,
        "--setting-sources", "user",
        "--permission-mode", "bypassPermissions",
        "--output-format", "stream-json",
        "--include-partial-messages",
        "--verbose",
        "-p", fullPrompt
    ];
    if (options.model)
        claudeArgs.push("--model", options.model);
    if (options.bare === "true")
        claudeArgs.push("--bare");
    const timeoutMs = Number(options["timeout-ms"] ?? DEFAULT_TIMEOUT_MS);
    const spawn = spawnSync(claudeBin, claudeArgs, {
        encoding: "utf8",
        timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024
    });
    if (spawn.error) {
        throw new Error(`diagnose: failed to spawn ${claudeBin}: ${spawn.error.message}`);
    }
    if (spawn.status !== 0) {
        const stderrTail = (spawn.stderr || "").trim().slice(-1000);
        throw new Error(`diagnose: claude exited ${spawn.status}\n${stderrTail}`);
    }
    const finalText = extractFinalAssistantText(spawn.stdout || "");
    const proposal = extractJsonProposal(finalText);
    if (!proposal) {
        process.stderr.write(`diagnose: claude did not emit a parseable proposal\n`);
        process.stderr.write(`--- final assistant text (last 2000 chars) ---\n`);
        process.stderr.write(finalText.slice(-2000) + "\n");
        throw new Error("diagnose: no proposal");
    }
    if (!allowedSignals.includes(proposal.signal)) {
        throw new Error(`diagnose: claude emitted signal=${proposal.signal} but only ${allowedSignals.join(", ")} are allowed at this state`);
    }
    const signalArgv = [
        "--repo", repo,
        "--step", stepId,
        "--signal", proposal.signal,
        "--reason", proposal.reason || "diagnose proposal",
        // Don't auto-run-next; the user reviews the proposal in the web UI first.
        "--no-run-next", "true"
    ];
    if (proposal.signal === "propose-rerun-from") {
        if (!proposal.targetStep) {
            throw new Error("diagnose: propose-rerun-from requires targetStep");
        }
        signalArgv.push("--target-step", proposal.targetStep);
    }
    await cmdAssistSignal(signalArgv);
    console.log(JSON.stringify({
        status: "ok",
        stepId,
        runtimeStatus,
        proposal,
        rawTextTail: finalText.slice(-400)
    }, null, 2));
}
function diagnoseSuffix({ allowedSignals }) {
    const signalsList = allowedSignals.join(", ");
    return [
        "",
        "=== DIAGNOSE MODE ===",
        "",
        "This is a NON-INTERACTIVE diagnostic invocation. You will not get a follow-up turn.",
        "Read the failure context above and decide on the single best proposal to unblock the gate.",
        "",
        `Allowed signals at this state: ${signalsList}`,
        "",
        "Output requirement (strict):",
        "- Emit exactly one JSON object on the LAST line of your reply.",
        "- The JSON shape MUST be: {\"signal\": \"<one of the allowed signals>\", \"targetStep\": \"<step id>\" or null, \"reason\": \"<short rationale>\"}",
        "- targetStep is required when signal == \"propose-rerun-from\". For every other signal it must be null.",
        "- Keep reason under 240 chars and concrete (cite the failed guard / artifact / evidence).",
        "- No code fences, no extra prose after the JSON. Anything after the last `}` is ignored.",
        "",
        "Do not run any tools. Do not chat. Read, decide, emit JSON."
    ].join("\n");
}
function extractFinalAssistantText(streamJson) {
    // claude --output-format stream-json emits one JSON object per line.
    // Assistant blocks carry the model's prose; the trailing `result` event
    // is just a short summary and does NOT include the JSON proposal we want
    // to parse, so we ignore it unless no assistant text was ever emitted.
    const lines = String(streamJson || "").split(/\r?\n/).filter(Boolean);
    const assistantSegments = [];
    let resultText = null;
    for (const line of lines) {
        let event = null;
        try {
            event = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (!event || typeof event !== "object")
            continue;
        if (event.type === "assistant" && event.message?.content) {
            const blocks = Array.isArray(event.message.content) ? event.message.content : [event.message.content];
            for (const block of blocks) {
                if (block?.type === "text" && typeof block.text === "string") {
                    assistantSegments.push(block.text);
                }
                else if (typeof block === "string") {
                    assistantSegments.push(block);
                }
            }
        }
        else if (event.type === "result" && typeof event.result === "string") {
            resultText = event.result;
        }
    }
    if (assistantSegments.length > 0)
        return assistantSegments.join("\n");
    return resultText ?? "";
}
function extractJsonProposal(text) {
    // Walk from the end, looking for the last `{...}` block that parses as
    // JSON and contains a `signal` field.
    if (!text)
        return null;
    const haystack = String(text);
    for (let end = haystack.length; end > 0; end -= 1) {
        if (haystack[end - 1] !== "}")
            continue;
        let depth = 0;
        for (let start = end - 1; start >= 0; start -= 1) {
            const ch = haystack[start];
            if (ch === "}")
                depth += 1;
            else if (ch === "{") {
                depth -= 1;
                if (depth === 0) {
                    const candidate = haystack.slice(start, end);
                    let parsed = null;
                    try {
                        parsed = JSON.parse(candidate);
                    }
                    catch {
                        break; // try a shorter window
                    }
                    if (parsed && typeof parsed === "object" && typeof parsed.signal === "string") {
                        return {
                            signal: parsed.signal.trim(),
                            targetStep: typeof parsed.targetStep === "string" ? parsed.targetStep.trim() : null,
                            reason: typeof parsed.reason === "string" ? parsed.reason.trim() : ""
                        };
                    }
                    break;
                }
            }
        }
    }
    return null;
}
