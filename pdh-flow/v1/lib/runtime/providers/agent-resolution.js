// Resolves the effective agent configuration for a step by layering:
//
//   1. Flow defaults — flow.providers[stepId] for edit, flow.reviewers[stepId]
//      (with the variant's reviewer roster) for review.
//   2. Variant defaults — reserved for future flows/variants/<id>.yaml
//      with per-variant agent layers. No-op today.
//   3. Note overrides — runtime.run.agent_overrides[stepId], populated
//      from current-note.md frontmatter at loadRuntime time.
//
// Returns a normalized struct so executeProviderStep and
// executeParallelReviewStep don't have to know about the layering.
//
// For review steps, an override that contains `reviewers: [...]` REPLACES
// the flow's roster wholesale. Aggregator and repair can be overridden
// independently. This is intentional: partial roster merging would
// require positional or role-based identity that the flow yaml doesn't
// currently model. If callers want to keep the default roster but swap
// one role, they can copy the flow yaml's roster into the override.
import { modelForStep, providerForStep, resolveStepReviewPlan } from "../../flow/load.js";
export function resolveStepAgent({ flow, runtimeRun, step }) {
    if (!flow || !step)
        return null;
    const variant = runtimeRun?.flow_variant;
    if (!variant) {
        throw new Error("resolveStepAgent requires runtimeRun.flow_variant");
    }
    const overrides = runtimeRun?.agent_overrides ?? {};
    const stepOverride = overrides?.[step.id] ?? null;
    if (step.mode === "review") {
        return resolveReviewAgent({ flow, runtimeRun, step, stepOverride });
    }
    return resolveEditAgent({ flow, variant, step, stepOverride });
}
function resolveEditAgent({ flow, variant, step, stepOverride }) {
    const base = {
        kind: "edit",
        provider: providerForStep(flow, step, variant) ?? step.provider ?? null,
        model: modelForStep(flow, step.id) ?? null,
        bare: false
    };
    const editOverride = stepOverride?.edit ?? null;
    if (!editOverride)
        return base;
    return {
        ...base,
        provider: editOverride.provider ?? base.provider,
        model: editOverride.model ?? base.model,
        bare: editOverride.bare ?? base.bare
    };
}
function resolveReviewAgent({ flow, runtimeRun, step, stepOverride }) {
    const variant = runtimeRun?.flow_variant ?? "full";
    const basePlan = resolveStepReviewPlan(flow, variant, step.id) ?? {};
    // basePlan from normalizeReviewPlan returns string-shaped
    // aggregatorProvider/repairProvider; convert to {provider, model} for
    // the resolver's uniform output shape.
    const baseAggregator = basePlan.aggregatorProvider
        ? { provider: basePlan.aggregatorProvider, model: null }
        : null;
    const baseRepair = basePlan.repairProvider
        ? { provider: basePlan.repairProvider, model: null }
        : null;
    const baseReviewers = Array.isArray(basePlan.reviewers) ? basePlan.reviewers : [];
    const baseMaxRepairs = Number.isInteger(basePlan.maxInPlaceRepairs)
        ? basePlan.maxInPlaceRepairs
        : null;
    const aggregatorOverride = normalizeAgentRef(stepOverride?.aggregator);
    const repairOverride = normalizeAgentRef(stepOverride?.repair);
    const reviewerOverride = Array.isArray(stepOverride?.reviewers) && stepOverride.reviewers.length
        ? stepOverride.reviewers
        : null;
    const maxRepairsOverride = Number.isInteger(stepOverride?.maxInPlaceRepairs)
        ? stepOverride.maxInPlaceRepairs
        : null;
    const aggregator = aggregatorOverride
        ? { provider: aggregatorOverride.provider ?? baseAggregator?.provider ?? null, model: aggregatorOverride.model ?? baseAggregator?.model ?? null }
        : baseAggregator;
    const repair = repairOverride
        ? { provider: repairOverride.provider ?? baseRepair?.provider ?? null, model: repairOverride.model ?? baseRepair?.model ?? null }
        : baseRepair;
    return {
        kind: "review",
        aggregator,
        repair,
        reviewers: reviewerOverride
            ? reviewerOverride.map(normalizeReviewerEntry).filter(Boolean)
            : baseReviewers,
        maxInPlaceRepairs: maxRepairsOverride ?? baseMaxRepairs
    };
}
function normalizeAgentRef(value) {
    if (value == null)
        return null;
    if (typeof value === "string") {
        return { provider: value, model: null };
    }
    if (typeof value !== "object")
        return null;
    return {
        provider: typeof value.provider === "string" ? value.provider : null,
        model: typeof value.model === "string" ? value.model : null
    };
}
function normalizeReviewerEntry(entry) {
    if (!entry || typeof entry !== "object")
        return null;
    // Override roster entries always travel as providers: string[] (one
    // per spawn). Legacy { provider, count } shape from older overrides
    // is materialized for safety, but new writes from the UI always use
    // the array form.
    let providers = [];
    if (Array.isArray(entry.providers)) {
        providers = entry.providers.filter((p) => typeof p === "string" && p.length > 0);
    }
    if (providers.length === 0 && typeof entry.provider === "string" && entry.provider.length > 0) {
        const count = Number.isInteger(entry.count) && entry.count > 0 ? entry.count : 1;
        providers = Array.from({ length: count }, () => entry.provider);
    }
    return {
        role: entry.role || entry.roleId || "reviewer",
        roleId: entry.roleId || entry.role || "reviewer",
        label: entry.label || entry.role || "Reviewer",
        provider: providers[0] ?? null,
        providers,
        model: entry.model ?? null,
        focus: Array.isArray(entry.focus) ? entry.focus : []
    };
}
