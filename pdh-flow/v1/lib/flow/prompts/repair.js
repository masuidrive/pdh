import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getStep, resolveSkillBodies } from "../load.js";
import { renderTemplate } from "./template-engine.js";
export function writeReviewRepairPromptArtifact({ repoPath, stateDir, run, flow, stepId, reviewPlan, aggregate, round, provider }) {
    const step = getStep(flow, stepId);
    const artifactPath = join(stateDir, "runs", run.id, "steps", stepId, "review-rounds", `round-${round}`, "repair-prompt.md");
    mkdirSync(join(artifactPath, ".."), { recursive: true });
    const body = renderReviewRepairPrompt({ repoPath, run, flow, step, reviewPlan, aggregate, round, provider });
    writeFileSync(artifactPath, body);
    return { artifactPath, body };
}
export function renderReviewRepairPrompt({ repoPath, run, flow, step, reviewPlan, aggregate, round, provider }) {
    const outputPath = `.pdh-flow/runs/${run.id}/steps/${step.id}/review-rounds/round-${round}/repair.json`;
    const skillBodies = resolveSkillBodies("repair");
    const blockers = blockingFindings(aggregate);
    const repairStepRules = Array.isArray(reviewPlan?.repairRules) ? reviewPlan.repairRules : [];
    const jsonShape = JSON.stringify({
        summary: "短い修正要約",
        verification: ["実際に実行したコマンドまたは確認"],
        remaining_risks: ["未解消 blocker または follow-up risk"],
        notes: "任意の自由記述",
        commit_required: false,
        rerun_target_step: null
    }, null, 2);
    const blockerLines = renderBlockerLines(blockers);
    return renderTemplate("shared/repair_prompt.j2", {
        run,
        step,
        reviewPlan: reviewPlan ?? {},
        round,
        provider,
        skillBodies,
        repairStepRules,
        blockerLines,
        outputPath,
        jsonShape
    });
}
function renderBlockerLines(blockers) {
    if (!blockers.length) {
        return ["- blocking finding は検出されていません。残っている検証不足や証跡不足を片付けて、次のレビューラウンドへ渡してください。"];
    }
    const lines = [];
    for (const finding of blockers) {
        lines.push(`- [${finding.severity}] ${finding.reviewerLabel}: ${finding.title}`);
        if (finding.evidence) {
            lines.push(`  - 証拠: ${finding.evidence}`);
        }
        if (finding.recommendation) {
            lines.push(`  - 推奨対応: ${finding.recommendation}`);
        }
    }
    return lines;
}
function blockingFindings(aggregate) {
    if (!aggregate?.findings?.length) {
        return [];
    }
    const severe = aggregate.findings.filter((finding) => ["critical", "major"].includes(String(finding.severity || "").toLowerCase()));
    if (severe.length > 0) {
        return severe;
    }
    return aggregate.findings.filter((finding) => !["none", "note"].includes(String(finding.severity || "").toLowerCase()));
}
