import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseAcVerificationTable } from "../guards/ac-verification.js";
import { getStep } from "../load.js";
import { activeReviewPlan, expandReviewerInstances } from "../../runtime/review.js";
import { loadRuntime, stepDir } from "../../runtime/state.js";
import { renderTemplate } from "./template-engine.js";
const REVIEWER_JSON_SHAPE = JSON.stringify({
    status: "Ready",
    summary: "短いレビュー要約",
    findings: [
        {
            severity: "major",
            title: "具体的な問題のタイトル",
            evidence: "具体的な証拠",
            recommendation: "具体的な修正案または follow-up"
        }
    ],
    notes: "任意の自由記述"
}, null, 2);
const REPAIR_JSON_SHAPE = JSON.stringify({
    summary: "短い修正要約",
    verification: ["実際に実行したコマンドまたは確認"],
    remaining_risks: ["未解消 blocker または follow-up risk"],
    notes: "任意の自由記述",
    commit_required: false,
    rerun_target_step: null
}, null, 2);
export function renderSubAgentContext(opts) {
    const repo = resolve(opts.repo);
    const runtime = loadRuntime(repo, { normalizeStaleRunning: true });
    if (!runtime.run) {
        throw new Error("No active run found in current-note.md (start a ticket first)");
    }
    const step = getStep(runtime.flow, opts.stepId);
    if (!step) {
        throw new Error(`Unknown step: ${opts.stepId}`);
    }
    const reviewerInfo = opts.reviewerId ? resolveReviewerInfo(runtime, opts.stepId, opts.reviewerId) : null;
    if (opts.reviewerId && !reviewerInfo) {
        throw new Error(`reviewer-id "${opts.reviewerId}" not found in step ${opts.stepId} review plan (checked active variant and full)`);
    }
    const role = (opts.role ?? reviewerInfo?.label ?? "").trim();
    const scope = (opts.scope ?? reviewerInfo?.responsibility ?? "").trim();
    if (!role) {
        throw new Error("--role is required (or pass --reviewer-id to inherit from flow)");
    }
    if (!scope) {
        throw new Error("--scope is required (or pass --reviewer-id to inherit from flow)");
    }
    const productBriefMarkdown = readOrPlaceholder(join(repo, "product-brief.md"), "(product-brief.md が見つかりません)");
    const ticketRaw = readOrPlaceholder(join(repo, "current-ticket.md"), "(current-ticket.md が見つかりません)");
    const ticketSectionMarkdown = stripFrontmatter(ticketRaw);
    const noteText = existsSync(join(repo, "current-note.md")) ? readFileSync(join(repo, "current-note.md"), "utf8") : "";
    const acVerificationTableMarkdown = noteText ? extractAcVerificationSection(noteText, repo) : null;
    let priorStep = null;
    if (opts.priorStep) {
        const section = noteText ? extractStepNoteSection(noteText, opts.priorStep) : null;
        priorStep = section
            ? { id: opts.priorStep, noteSectionMarkdown: section }
            : { id: opts.priorStep, noteSectionMarkdown: `(current-note.md に ${opts.priorStep} の節が見つかりませんでした)` };
    }
    const timestamp = opts.timestamp ?? formatTimestamp(new Date());
    const slug = slugify(role);
    const bundleDirName = `${slug}-${timestamp}`;
    const bundleDirAbs = join(stepDir(runtime.stateDir, runtime.run.id, opts.stepId), "sub-agents", bundleDirName);
    const bundlePathAbs = join(bundleDirAbs, "context.md");
    const outputSchema = opts.outputSchema ?? "freeform";
    let outputPath = null;
    let jsonShape = null;
    if (outputSchema === "reviewer") {
        outputPath = relative(repo, join(bundleDirAbs, "review.json")) || "review.json";
        jsonShape = REVIEWER_JSON_SHAPE;
    }
    else if (outputSchema === "repair") {
        outputPath = relative(repo, join(bundleDirAbs, "repair.json")) || "repair.json";
        jsonShape = REPAIR_JSON_SHAPE;
    }
    const reviewerCtx = reviewerInfo
        ? { label: reviewerInfo.label, responsibility: reviewerInfo.responsibility, focus: reviewerInfo.focus }
        : null;
    const body = renderTemplate("shared/sub_agent_context.j2", {
        role,
        scope,
        reviewer: reviewerCtx,
        run: runtime.run,
        step,
        productBriefMarkdown,
        ticketSectionMarkdown,
        acVerificationTableMarkdown,
        files: opts.files && opts.files.length ? opts.files : null,
        priorStep,
        outputSchema,
        outputPath,
        jsonShape,
        snapshotTimestamp: timestamp,
        bundlePath: relative(repo, bundlePathAbs) || "context.md"
    });
    return { body, bundleDir: bundleDirAbs, bundlePath: bundlePathAbs };
}
export function writeSubAgentContext(opts) {
    const result = renderSubAgentContext(opts);
    mkdirSync(dirname(result.bundlePath), { recursive: true });
    writeFileSync(result.bundlePath, result.body);
    return result;
}
function resolveReviewerInfo(runtime, stepId, reviewerId) {
    const variants = [runtime.run?.flow_variant ?? "full", "full"];
    for (const variant of variants) {
        const plan = activeReviewPlan(runtime.flow, variant, stepId);
        if (!plan)
            continue;
        const reviewers = Array.isArray(plan.reviewers) ? plan.reviewers : [];
        const direct = reviewers.find((r) => r.roleId === reviewerId || r.label === reviewerId);
        if (direct) {
            return {
                label: direct.label || direct.roleId || reviewerId,
                responsibility: direct.responsibility || "",
                focus: Array.isArray(direct.focus) ? direct.focus : []
            };
        }
        const expanded = expandReviewerInstances(plan).find((r) => r.reviewerId === reviewerId);
        if (expanded) {
            return {
                label: expanded.label,
                responsibility: expanded.responsibility,
                focus: expanded.focus
            };
        }
    }
    return null;
}
function readOrPlaceholder(path, placeholder) {
    if (!existsSync(path))
        return placeholder;
    return readFileSync(path, "utf8");
}
function stripFrontmatter(text) {
    if (!text.startsWith("---"))
        return text;
    const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
    if (!m)
        return text;
    return text.slice(m[0].length);
}
function extractAcVerificationSection(noteText, repoPath) {
    const section = extractMarkdownSection(noteText, ["AC 裏取り結果", "AC Verification"]);
    if (!section)
        return null;
    // Only embed if a parseable table is present (avoids embedding empty placeholder sections).
    const parsed = parseAcVerificationTable({ repoPath });
    if (!parsed.rows || parsed.rows.length === 0)
        return null;
    return section;
}
function extractStepNoteSection(noteText, stepId) {
    // Match heading like "## PD-C-3. 計画" / "### PD-C-3 計画" etc.
    const escaped = stepId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const headingRe = new RegExp(`^(#{1,6})\\s+${escaped}\\b.*$`, "m");
    const match = headingRe.exec(noteText);
    if (!match)
        return null;
    const startIdx = match.index;
    const after = noteText.slice(startIdx + match[0].length);
    const next = after.search(/\r?\n#{1,6}\s+/);
    const body = next >= 0 ? after.slice(0, next + 1) : after;
    return match[0] + body;
}
function extractMarkdownSection(text, headingNames) {
    for (const name of headingNames) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const headingRe = new RegExp(`^(#{1,6})\\s+${escaped}\\s*$`, "mi");
        const match = headingRe.exec(text);
        if (!match)
            continue;
        const startIdx = match.index;
        const after = text.slice(startIdx + match[0].length);
        const next = after.search(/\r?\n#{1,6}\s+/);
        const body = next >= 0 ? after.slice(0, next + 1) : after;
        return match[0] + body;
    }
    return null;
}
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "sub-agent";
}
function formatTimestamp(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}
