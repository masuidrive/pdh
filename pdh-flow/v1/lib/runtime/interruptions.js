import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
export function createInterruption({ stateDir, runId, stepId, message, source = "user", kind = "clarification" }) {
    const createdAt = new Date().toISOString();
    const id = `interrupt-${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const dir = interruptionDir(stateDir, runId, stepId);
    mkdirSync(dir, { recursive: true });
    const artifactPath = join(dir, `${id}.md`);
    const jsonPath = join(dir, `${id}.json`);
    const interruption = {
        id,
        runId,
        stepId,
        kind,
        source,
        status: "open",
        message,
        answer: null,
        createdAt,
        answeredAt: null,
        artifactPath,
        jsonPath
    };
    writeInterruption(interruption);
    return interruption;
}
export function answerLatestInterruption({ stateDir, runId, stepId, message, source = "user" }) {
    const open = latestOpenInterruption({ stateDir, runId, stepId });
    if (!open) {
        throw new Error(`No open interruption for ${stepId}`);
    }
    const answeredAt = new Date().toISOString();
    const answerPath = join(interruptionDir(stateDir, runId, stepId), `${open.id}-answer.md`);
    const interruption = {
        ...open,
        status: "answered",
        answer: {
            source,
            message,
            answeredAt,
            artifactPath: answerPath
        },
        answeredAt,
        answerPath
    };
    writeFileSync(answerPath, renderAnswerMarkdown(interruption));
    writeInterruption(interruption);
    return interruption;
}
export function latestOpenInterruption({ stateDir, runId, stepId }) {
    return loadStepInterruptions({ stateDir, runId, stepId })
        .filter((interruption) => interruption.status === "open")
        .sort(compareCreatedAt)
        .at(-1) ?? null;
}
export function loadStepInterruptions({ stateDir, runId, stepId }) {
    const dir = interruptionDir(stateDir, runId, stepId);
    if (!existsSync(dir)) {
        return [];
    }
    return readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")))
        .sort(compareCreatedAt);
}
export function renderInterruptionsForPrompt(interruptions) {
    if (!interruptions.length) {
        return ["(なし)"];
    }
    return interruptions.flatMap((interruption) => {
        const lines = [
            `### ${interruption.id}`,
            "",
            `- 状態: ${interruption.status}`,
            `- ステップ: ${interruption.stepId}`,
            `- 作成日時: ${interruption.createdAt}`,
            "",
            "メッセージ:",
            "",
            interruption.message.trim() || "(空)"
        ];
        if (interruption.answer?.message) {
            lines.push("", "回答:", "", interruption.answer.message.trim());
        }
        if (interruption.status === "open") {
            lines.push("", "この割り込みはまだ open です。回答済みとして先へ進めないでください。");
        }
        return [...lines, ""];
    });
}
export function renderInterruptionMarkdown(interruption) {
    const lines = [
        "# PDH Flow 割り込み",
        "",
        `- 実行ID: ${interruption.runId}`,
        `- ステップ: ${interruption.stepId}`,
        `- 状態: ${interruption.status}`,
        `- 種別: ${interruption.kind}`,
        `- 発生元: ${interruption.source}`,
        `- 作成日時: ${interruption.createdAt}`,
        "",
        "## メッセージ",
        "",
        interruption.message.trim() || "(空)"
    ];
    if (interruption.answer?.message) {
        lines.push("", "## 回答", "", `- 発生元: ${interruption.answer.source}`, `- 回答日時: ${interruption.answer.answeredAt}`, "", interruption.answer.message.trim());
    }
    return `${lines.join("\n")}\n`;
}
function renderAnswerMarkdown(interruption) {
    return [
        "# PDH Flow 割り込み回答",
        "",
        `- 実行ID: ${interruption.runId}`,
        `- ステップ: ${interruption.stepId}`,
        `- 割り込みID: ${interruption.id}`,
        `- 回答日時: ${interruption.answer.answeredAt}`,
        "",
        "## 回答",
        "",
        interruption.answer.message.trim() || "(空)",
        ""
    ].join("\n");
}
function writeInterruption(interruption) {
    writeFileSync(interruption.artifactPath, renderInterruptionMarkdown(interruption));
    writeFileSync(interruption.jsonPath, `${JSON.stringify(interruption, null, 2)}\n`);
}
function interruptionDir(stateDir, runId, stepId) {
    return join(stateDir, "runs", runId, "steps", stepId, "interruptions");
}
function compareCreatedAt(left, right) {
    return String(left.createdAt).localeCompare(String(right.createdAt));
}
