// Optional provider call logger gated by PDH_DEBUG_PROVIDER_LOG=1.
// Writes YAML request/response artifacts under
// `.pdh-flow/runs/<runId>/log/<stepId>-<roleId>-<seq>.{req,res}.yaml`.
// Sequence is per-(stepId, roleId), zero-padded to 3 digits.
//
// res.yaml embeds the structured artifacts the agent produced
// (ui-output.json / review.json / repair.json / judgement) since the
// `finalMessage` text is narration — the actual outcome of the step
// lives in those JSON artifacts that runtime guards consume.
//
// YAML is preferred over JSON here for readability: long multi-line
// strings (prompts, finalMessage) render as `|` block literals.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as yamlStringify } from "yaml";
export function isProviderDebugLogEnabled() {
    const value = process.env.PDH_DEBUG_PROVIDER_LOG;
    return value === "1" || value === "true";
}
export function readArtifactsForLog(artifactPaths = []) {
    return artifactPaths.map(({ name, path }) => {
        if (!existsSync(path)) {
            return { name, path, missing: true };
        }
        let rawText;
        try {
            rawText = readFileSync(path, "utf8");
        }
        catch (error) {
            return { name, path, error: error?.message ?? String(error) };
        }
        try {
            return { name, path, content: JSON.parse(rawText) };
        }
        catch (error) {
            return { name, path, parseError: error?.message ?? String(error), rawText };
        }
    });
}
export function recordProviderRequest(ctx, request) {
    if (!isProviderDebugLogEnabled())
        return null;
    if (!ctx.stateDir || !ctx.runId || !ctx.stepId || !ctx.roleId)
        return null;
    const logDir = join(ctx.stateDir, "runs", ctx.runId, "log");
    mkdirSync(logDir, { recursive: true });
    const seq = nextSeqFor(logDir, ctx.stepId, ctx.roleId);
    const seqStr = String(seq).padStart(3, "0");
    const reqPath = join(logDir, `${ctx.stepId}-${ctx.roleId}-${seqStr}.req.yaml`);
    writeFileSync(reqPath, dumpYaml(request));
    return { reqPath, seqStr };
}
export function recordProviderResponse(ctx, seqStr, response) {
    if (!isProviderDebugLogEnabled())
        return null;
    if (!seqStr)
        return null;
    const logDir = join(ctx.stateDir, "runs", ctx.runId, "log");
    mkdirSync(logDir, { recursive: true });
    const resPath = join(logDir, `${ctx.stepId}-${ctx.roleId}-${seqStr}.res.yaml`);
    writeFileSync(resPath, dumpYaml(response));
    return { resPath };
}
function dumpYaml(value) {
    // lineWidth=0 disables column wrapping (avoids folded blocks for long
    // single-line strings). blockQuote='literal' makes multi-line strings
    // use the `|` literal block form so prompts/transcripts stay readable.
    return yamlStringify(value, {
        lineWidth: 0,
        blockQuote: "literal",
        indent: 2
    });
}
function nextSeqFor(logDir, stepId, roleId) {
    if (!existsSync(logDir))
        return 1;
    const prefix = `${stepId}-${roleId}-`;
    let max = 0;
    for (const name of readdirSync(logDir)) {
        if (!name.startsWith(prefix))
            continue;
        const m = name.match(/-(\d{3,})\.(req|res)\.(yaml|json)$/);
        if (m) {
            const n = parseInt(m[1], 10);
            if (n > max)
                max = n;
        }
    }
    return max + 1;
}
