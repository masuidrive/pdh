import { resolve } from "node:path";
import { renderSubAgentContext, writeSubAgentContext } from "../flow/prompts/sub-agent.js";
import { parseOptions } from "./utils.js";
export function cmdSubAgentContext(argv) {
    const options = parseOptions(argv);
    const repo = resolve(options.repo ?? process.cwd());
    const stepId = required(options, "step");
    const outputSchema = options["output-schema"] ?? "freeform";
    if (!["reviewer", "repair", "freeform"].includes(outputSchema)) {
        throw new Error(`--output-schema must be reviewer | repair | freeform; got "${outputSchema}"`);
    }
    const params = {
        repo,
        stepId,
        role: options.role,
        scope: options.scope,
        reviewerId: options["reviewer-id"],
        files: parseList(options.files),
        outputSchema: outputSchema,
        priorStep: options["prior-step"]
    };
    if (options.stdout === "true") {
        const result = renderSubAgentContext(params);
        process.stdout.write(result.body);
        return;
    }
    const result = writeSubAgentContext(params);
    console.log(result.bundlePath);
}
function required(options, key) {
    const value = options[key];
    if (!value || value === "true") {
        throw new Error(`Missing --${key}`);
    }
    return value;
}
function parseList(value) {
    if (!value || value === "true")
        return undefined;
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}
