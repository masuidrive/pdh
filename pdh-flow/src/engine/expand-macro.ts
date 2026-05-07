// Expand macro nodes in a FlowYAML into the flat-flow shape consumed by the
// engine. Currently the only macro is `review_loop`; new macros register here.
//
// Round counter (max_rounds) is *not* materialized as flow nodes — it lives
// in the XState machine's context, and the aggregate node's transitions
// reference the loop bound via the guardian_step's max_rounds field.
//
// The original macro id becomes a parallel_group in the flat output. Reviewer
// nodes are dotted children (e.g. code_quality_review.devils_advocate_1).
// The aggregate is `<id>.aggregate`, repair is `<id>.repair`.

import type {
  CompiledFlatFlow,
  FlatNode,
  FlowYAML,
  GuardianStepNode,
  ParallelGroup,
  ProviderStepNode,
  ReviewLoopMacro,
  Transition,
} from "../types/index.ts";
import { getValidator, SCHEMA_IDS, SchemaViolation } from "./validate.ts";

export interface ExpandOptions {
  /** Source path of the YAML, surfaced in compiled_at metadata only. */
  sourcePath?: string;
}

export function expandFlow(
  flow: FlowYAML,
  opts: ExpandOptions = {},
): CompiledFlatFlow {
  const flatNodes: Record<string, FlatNode> = {};
  const macroOrigins: Record<string, string> = {};

  for (const [nodeId, node] of Object.entries(flow.nodes)) {
    if (isMacro(node)) {
      const expanded = expandReviewLoop(nodeId, node);
      for (const [eid, en] of Object.entries(expanded.nodes)) {
        if (flatNodes[eid]) {
          throw new SchemaViolation(SCHEMA_IDS.flatFlow, [
            {
              instancePath: `/nodes/${eid}`,
              schemaPath: "expand-macro",
              keyword: "duplicate",
              params: { nodeId: eid },
              message: `node id collision after macro expansion: ${eid}`,
            },
          ]);
        }
        flatNodes[eid] = en;
        if (eid !== nodeId) macroOrigins[eid] = nodeId;
      }
    } else {
      flatNodes[nodeId] = node as FlatNode;
    }
  }

  const flat: CompiledFlatFlow = {
    flow: flow.flow,
    version: 1,
    compiled_at: new Date().toISOString(),
    ...(opts.sourcePath ? { source_path: opts.sourcePath } : {}),
    ...(flow.defaults ? { defaults: flow.defaults } : {}),
    variants: flow.variants,
    nodes: flatNodes,
    macro_origins: macroOrigins,
  } as CompiledFlatFlow;

  return getValidator().validateOrThrow<CompiledFlatFlow>(
    SCHEMA_IDS.flatFlow,
    flat,
  );
}

function isMacro(node: unknown): node is ReviewLoopMacro {
  return (
    typeof node === "object" &&
    node !== null &&
    "macro" in node &&
    (node as { macro?: unknown }).macro === "review_loop"
  );
}

interface ExpansionResult {
  nodes: Record<string, FlatNode>;
}

function expandReviewLoop(
  parentId: string,
  macro: ReviewLoopMacro,
): ExpansionResult {
  const out: Record<string, FlatNode> = {};

  // ── 1. Reviewer nodes (parallel members) ─────────────────────────────
  const reviewerIds: string[] = [];
  for (const spec of macro.reviewers) {
    const count = spec.count ?? 1;
    for (let i = 1; i <= count; i++) {
      const reviewerId = `${parentId}.${spec.role}_${i}`;
      reviewerIds.push(reviewerId);
      const node: ProviderStepNode = {
        type: "provider_step",
        provider: spec.provider,
        role: spec.role,
        ...(spec.focus
          ? {
              prompt: {
                intent: `${spec.role} review (${i}/${count})`,
                checkpoints: spec.focus,
              },
            }
          : {}),
        // No on_done — member of parallel_group; group's on_all_done fires.
      };
      out[reviewerId] = node;
    }
  }

  if (reviewerIds.length === 0) {
    throw new SchemaViolation(SCHEMA_IDS.flatFlow, [
      {
        instancePath: `/nodes/${parentId}`,
        schemaPath: "expand-macro",
        keyword: "minItems",
        params: {},
        message: `review_loop "${parentId}" has zero reviewers (all counts are 0)`,
      },
    ]);
  }

  // ── 2. Aggregate node (guardian) ─────────────────────────────────────
  const aggregateId = `${parentId}.aggregate`;
  const repairId = `${parentId}.repair`;

  const hasAggregator = !!macro.aggregator;
  const hasRepair = !!macro.repair;

  if (hasAggregator) {
    const guardianOutputs: GuardianStepNode["outputs"] = {
      pass: macro.on_pass,
    };
    if (hasRepair) {
      guardianOutputs.repair_needed = {
        next: repairId,
        ...(macro.on_aborted
          ? { max_round_escalation: asNodeId(macro.on_aborted) }
          : {}),
      };
    } else if (macro.on_aborted) {
      // No repair loop, but aggregator can still abort — surface via abort.
      guardianOutputs.abort = macro.on_aborted;
    }
    const aggregate: GuardianStepNode = {
      type: "guardian_step",
      provider: macro.aggregator!.provider,
      role: macro.aggregator!.role ?? "aggregator",
      inputs_from: reviewerIds.length === 1 ? reviewerIds[0] : [...reviewerIds] as [string, ...string[]],
      outputs: guardianOutputs,
      max_rounds: macro.max_rounds ?? 1,
      ...(macro.label ? { label: `${macro.label} 集約` } : {}),
    };
    out[aggregateId] = aggregate;
  }

  // ── 3. Repair node (provider) ────────────────────────────────────────
  if (hasRepair) {
    const repair: ProviderStepNode = {
      type: "provider_step",
      provider: macro.repair!.provider,
      role: macro.repair!.role ?? "repair",
      // Loop back to the parent parallel_group so XState re-enters all
      // reviewer regions for round N+1.
      on_done: parentId,
    };
    out[repairId] = repair;
  }

  // ── 4. Parallel group at the parent id ───────────────────────────────
  const groupTarget: Transition = hasAggregator
    ? aggregateId
    : macro.on_pass;
  const group: ParallelGroup = {
    type: "parallel_group",
    members: reviewerIds as [string, ...string[]],
    on_all_done: groupTarget,
    ...(macro.label ? { label: macro.label } : {}),
  };
  out[parentId] = group;

  return { nodes: out };
}

function asNodeId(t: Transition): string {
  // For repair_needed.max_round_escalation (which the schema constrains to
  // a plain NodeId), we collapse a variant-keyed transition by taking its
  // 'full' entry (or the first entry). This is a deliberate simplification:
  // escalation should not depend on variant in practice. If a flow needs
  // variant-keyed escalation, it should expand it manually rather than rely
  // on macro sugar.
  if (typeof t === "string") return t;
  return (
    (t as Record<string, string>).full ??
    (t as Record<string, string>).light ??
    Object.values(t as Record<string, string>)[0]!
  );
}
