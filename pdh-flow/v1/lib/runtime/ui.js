import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { defaultJudgementKind, loadJudgements } from "../flow/guards/judgement-artifact.js";
import { loadStepInterruptions } from "./interruptions.js";
import { getStep, loadFlow } from "../flow/load.js";
import { extractSection } from "../repo/note.js";
import { collectStepArtifacts, latestAttemptResult } from "./state.js";
import { asRecordList, asString, asStringList, loadJsonArtifact, loadStepUiOutput } from "../flow/prompts/ui-output.js";
const STEP_HIGHLIGHT_FALLBACKS = {
    summary: {
        "PD-C-4": [{ anyOf: ["step:PD-C-3"], limit: 4 }],
        "PD-C-5": [
            { anyOf: ["step:PD-C-3"], limit: 3 },
            { anyOf: ["step:PD-C-4", "judgement:PD-C-4"], limit: 1 },
        ],
        "PD-C-6": [{ anyOf: ["step:PD-C-6", "step:PD-C-3"], limit: 4 }],
        "PD-C-7": [{ anyOf: ["step:PD-C-7", "step:PD-C-6"], limit: 4 }],
        "PD-C-9": [{ anyOf: ["step:PD-C-9", "ac_table"], limit: 4 }],
        "PD-C-10": [{ anyOf: ["ac_table", "step:PD-C-9"], limit: 4 }],
    },
    risks: {
        "PD-C-3": [{ anyOf: ["step:PD-C-3", "step:PD-C-4"], limit: 3 }],
        "PD-C-4": [{ anyOf: ["step:PD-C-3", "step:PD-C-4"], limit: 3 }],
        "PD-C-5": [{ anyOf: ["step:PD-C-3", "step:PD-C-4"], limit: 3 }],
        "PD-C-6": [{ anyOf: ["step:PD-C-6", "step:PD-C-3"], limit: 3 }],
        "PD-C-7": [{ anyOf: ["step:PD-C-7", "judgement:PD-C-7"], limit: 3 }],
        "PD-C-9": [{ anyOf: ["step:PD-C-9", "judgement:PD-C-9", "step:PD-C-7"], limit: 3 }],
        "PD-C-10": [{ anyOf: ["step:PD-C-10", "judgement:PD-C-10", "step:PD-C-7"], limit: 3 }],
    },
};
export function uiRuntimeArtifactPath({ stateDir, runId, stepId }) {
    return join(stateDir, "runs", runId, "steps", stepId, "ui-runtime.json");
}
export function loadStepUiRuntime({ stateDir, runId, stepId }) {
    return loadJsonArtifact({
        path: uiRuntimeArtifactPath({ stateDir, runId, stepId }),
        normalizer: normalizeUiRuntime
    });
}
export function writeStepUiRuntime({ repoPath, runtime, step, guardResults = null, nextCommands = [] }) {
    const path = uiRuntimeArtifactPath({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId: step.id
    });
    mkdirSync(join(path, ".."), { recursive: true });
    const data = buildRuntimeUiData({ repoPath, runtime, step, guardResults, nextCommands });
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
    return { artifactPath: path, data };
}
function buildRuntimeUiData({ repoPath, runtime, step, guardResults = null, nextCommands = [] }) {
    const runId = runtime.run.id;
    const stepId = step.id;
    const attempt = latestAttemptResult({
        stateDir: runtime.stateDir,
        runId,
        stepId,
        provider: step.provider === "runtime" ? null : step.provider
    });
    const humanGate = runtime.run.id
        ? safeHumanGate(runtime, stepId)
        : null;
    const interruptions = runtime.run.id
        ? loadStepInterruptions({ stateDir: runtime.stateDir, runId, stepId })
        : [];
    const judgements = runtime.run.id
        ? loadJudgements({ stateDir: runtime.stateDir, runId, stepId }).map((item) => ({
            kind: asString(item.kind),
            status: asString(item.status),
            artifact: asString(item.artifactPath)
        }))
        : [];
    const artifacts = collectStepArtifacts({ stateDir: runtime.stateDir, runId, stepId }).map((artifact) => ({
        name: artifact.name,
        path: artifact.path
    }));
    const uiOutput = loadStepUiOutput({ stateDir: runtime.stateDir, runId, stepId });
    const highlights = deriveStepUiHighlights({ runtime, stepId, uiOutput });
    const diffNameOnly = runGit(repoPath, ["diff", "--name-only"]);
    const diffStat = runGit(repoPath, ["diff", "--stat"]);
    return normalizeUiRuntime({
        generated_at: new Date().toISOString(),
        run_status: runtime.run.status,
        changed_files: aliasCurrentDocPaths(repoPath, splitLines(diffNameOnly.stdout)),
        diff_stat: splitLines(diffStat.stdout),
        guards: Array.isArray(guardResults)
            ? guardResults.map((result) => ({
                id: asString(result.guardId),
                status: asString(result.status),
                evidence: asString(result.evidence)
            }))
            : [],
        latest_attempt: attempt
            ? {
                attempt: attempt.attempt ?? null,
                status: attempt.status ?? null,
                provider: attempt.provider ?? null,
                exit_code: attempt.exitCode ?? null,
                final_message: attempt.finalMessage ?? null,
                stderr: attempt.stderr ?? null,
                raw_log_path: attempt.rawLogPath ?? null
            }
            : null,
        gate: humanGate
            ? {
                status: humanGate.status ?? null,
                decision: humanGate.decision ?? null,
                summary: humanGate.summary ?? null,
                baseline: humanGate.baseline ?? null,
                rerun_requirement: humanGate.rerun_requirement ?? null
            }
            : null,
        interruptions: interruptions
            .filter((item) => item.status !== "answered")
            .map((item) => ({
            id: asString(item.id),
            kind: asString(item.kind),
            message: asString(item.message),
            artifact: asString(item.artifactPath)
        })),
        judgements,
        artifacts,
        highlights,
        next_commands: asStringList(nextCommands)
    });
}
function normalizeUiRuntime(value, meta = {}) {
    const source = value ?? {};
    const metadata = meta ?? {};
    return {
        generatedAt: asString(source.generated_at ?? source.generatedAt),
        runStatus: asString(source.run_status ?? source.runStatus),
        changedFiles: asStringList(source.changed_files ?? source.changedFiles),
        diffStat: asStringList(source.diff_stat ?? source.diffStat),
        guards: asRecordList(source.guards, (guard) => ({
            id: asString(guard.id),
            status: asString(guard.status),
            evidence: asString(guard.evidence)
        })),
        latestAttempt: source.latest_attempt
            ? {
                attempt: source.latest_attempt.attempt ?? null,
                status: asString(source.latest_attempt.status),
                provider: asString(source.latest_attempt.provider),
                exitCode: source.latest_attempt.exit_code ?? null,
                finalMessage: asString(source.latest_attempt.final_message),
                stderr: asString(source.latest_attempt.stderr),
                rawLogPath: asString(source.latest_attempt.raw_log_path)
            }
            : null,
        gate: source.gate
            ? {
                status: asString(source.gate.status),
                decision: asString(source.gate.decision),
                baseline: source.gate.baseline
                    ? {
                        commit: asString(source.gate.baseline.commit),
                        stepId: asString(source.gate.baseline.step_id ?? source.gate.baseline.stepId),
                        ref: asString(source.gate.baseline.ref),
                        capturedAt: asString(source.gate.baseline.captured_at ?? source.gate.baseline.capturedAt)
                    }
                    : null,
                rerunRequirement: source.gate.rerun_requirement
                    ? {
                        targetStepId: asString(source.gate.rerun_requirement.target_step_id ?? source.gate.rerun_requirement.targetStepId),
                        reason: asString(source.gate.rerun_requirement.reason),
                        changedFiles: asStringList(source.gate.rerun_requirement.changed_files ?? source.gate.rerun_requirement.changedFiles),
                        changedTicketSections: asStringList(source.gate.rerun_requirement.changed_ticket_sections ?? source.gate.rerun_requirement.changedTicketSections),
                        changedNoteSections: asStringList(source.gate.rerun_requirement.changed_note_sections ?? source.gate.rerun_requirement.changedNoteSections)
                    }
                    : null
            }
            : null,
        interruptions: asRecordList(source.interruptions, (item) => ({
            id: asString(item.id),
            kind: asString(item.kind),
            message: asString(item.message),
            artifact: asString(item.artifact)
        })),
        judgements: asRecordList(source.judgements, (item) => ({
            kind: asString(item.kind),
            status: asString(item.status),
            artifact: asString(item.artifact)
        })),
        artifacts: asRecordList(source.artifacts, (item) => ({
            name: asString(item.name),
            path: asString(item.path)
        })),
        highlights: source.highlights
            ? {
                summary: asStringList(source.highlights.summary),
                risks: riskBulletsFrom(source.highlights.risks),
                notes: asString(source.highlights.notes)
            }
            : {
                summary: [],
                risks: [],
                notes: ""
            },
        nextCommands: asStringList(source.next_commands ?? source.nextCommands),
        artifactPath: asString(metadata.artifactPath),
        parseErrors: asStringList(metadata.parseErrors),
        parseWarnings: asStringList(metadata.parseWarnings),
        rawText: asString(metadata.rawText)
    };
}
function splitLines(value) {
    return String(value ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}
function aliasCurrentDocPaths(repoPath, paths) {
    const aliases = new Map();
    for (const alias of ["current-note.md", "current-ticket.md"]) {
        try {
            const target = readlinkSync(join(repoPath, alias));
            aliases.set(relative(repoPath, resolve(repoPath, target)).replaceAll("\\", "/"), alias);
        }
        catch { }
    }
    return paths.map((path) => aliases.get(path) ?? path);
}
function runGit(repoPath, args) {
    const result = spawnSync("git", args, { cwd: repoPath, encoding: "utf8" });
    if (result.status !== 0) {
        return { stdout: "", stderr: result.stderr ?? "" };
    }
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
function safeHumanGate(runtime, stepId) {
    try {
        const path = join(runtime.stateDir, "runs", runtime.run.id, "steps", stepId, "human-gate.json");
        if (!existsSync(path)) {
            return null;
        }
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return null;
    }
}
function deriveStepUiHighlights({ runtime, stepId, uiOutput }) {
    const noteBody = runtime.note?.body ?? "";
    const ownSummary = asStringList(uiOutput?.summary);
    const ownRisks = riskBulletsFrom(uiOutput?.risks);
    const ownNotes = asString(uiOutput?.notes);
    return {
        summary: ownSummary.length ? ownSummary : fallbackSummaryLines({ runtime, noteBody, stepId }),
        risks: ownRisks.length ? ownRisks : fallbackRiskLines({ runtime, noteBody, stepId }),
        notes: ownNotes
    };
}
// risks may be a list of either strings (legacy) or structured objects
// { description, severity, defer_to_step }. Render each as a single
// bullet line for the highlights view.
function riskBulletsFrom(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((item) => {
        if (typeof item === "string")
            return item.trim();
        if (item && typeof item === "object") {
            const sev = typeof item.severity === "string" && item.severity ? `[${item.severity}] ` : "";
            const defer = typeof item.defer_to_step === "string" && item.defer_to_step ? ` -> ${item.defer_to_step}` : "";
            const desc = typeof item.description === "string" ? item.description.trim() : "";
            return `${sev}${desc}${defer}`.trim();
        }
        return "";
    })
        .filter(Boolean);
}
function fallbackSummaryLines({ runtime, noteBody, stepId }) {
    const configured = resolveFallbackLines({
        type: "summary",
        runtime,
        noteBody,
        stepId,
    });
    if (configured.length > 0) {
        return configured;
    }
    return bulletsFromText(stepNoteSection(noteBody, stepId), 4);
}
function fallbackRiskLines({ runtime, noteBody, stepId }) {
    return resolveFallbackLines({
        type: "risks",
        runtime,
        noteBody,
        stepId,
    });
}
function stepNoteSection(noteBody, stepId) {
    const heading = stepNoteHeading(stepId);
    return heading ? extractSection(noteBody, heading) ?? "" : "";
}
function acTableText(noteBody) {
    return extractSection(noteBody, "AC 裏取り結果") ?? "";
}
function stepJudgementText(runtime, stepId) {
    if (!runtime.run?.id) {
        return "";
    }
    return loadJudgements({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId })
        .map((item) => [asString(item.status), asString(item.summary)].filter(Boolean).join(": "))
        .filter(Boolean)
        .join("\n");
}
function preferredText(...items) {
    return items.map((item) => String(item ?? "").trim()).find(Boolean) ?? "";
}
function bulletsFromText(text, limit) {
    const value = String(text ?? "").trim();
    if (!value) {
        return [];
    }
    const bulletLines = value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^[-*]\s+/.test(line))
        .map((line) => line.replace(/^[-*]\s+/, "").trim())
        .filter(Boolean);
    if (bulletLines.length) {
        return bulletLines.slice(0, limit);
    }
    return value
        .split(/\r?\n{2,}/)
        .map((chunk) => chunk.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, limit);
}
function resolveFallbackLines({ type, runtime, noteBody, stepId }) {
    const plan = STEP_HIGHLIGHT_FALLBACKS[type]?.[stepId] ?? [];
    const collected = [];
    for (const rule of plan) {
        const text = preferredText(...rule.anyOf.map((source) => resolveFallbackSource({ runtime, noteBody, source })));
        if (!text) {
            continue;
        }
        collected.push(...bulletsFromText(text, rule.limit));
    }
    return collected;
}
function resolveFallbackSource({ runtime, noteBody, source }) {
    if (source === "ac_table") {
        return acTableText(noteBody);
    }
    if (source.startsWith("step:")) {
        return stepNoteSection(noteBody, source.slice("step:".length));
    }
    if (source.startsWith("judgement:")) {
        return stepJudgementText(runtime, source.slice("judgement:".length));
    }
    return "";
}
function stepNoteHeading(stepId) {
    const step = flowStep(stepId);
    return typeof step?.noteSection === "string" ? step.noteSection : "";
}
function flowStep(stepId) {
    try {
        return getStep(loadFlow(), stepId);
    }
    catch {
        return null;
    }
}
