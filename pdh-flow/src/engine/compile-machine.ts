// Compile a CompiledFlatFlow into an XState v5 machine.
//
// Design notes:
// - Parallel-group members are NOT emitted as top-level states; they live
//   inside their parent parallel_group's `states` map. Their public NodeId
//   (e.g. code_quality_review.devils_advocate_1) is preserved in the actor
//   invocation input so audit / commits use the canonical name.
// - One global `round` counter in context; reset when entering a parallel
//   group, incremented on repair → parent loop-back. This is sufficient for
//   non-nested review loops (the only shape supported by the macro).
// - Variant-keyed transitions resolve at runtime via context.variant.
// - Terminal nodes become `type: 'final'`.

import { setup, assign, type AnyEventObject, type AnyStateMachine } from "xstate";
import type {
  CompiledFlatFlow,
  FlatNode,
  ParallelGroup,
  ProviderStepNode,
  GuardianStepNode,
  SystemStepNode,
  GateStepNode,
  TerminalNode,
  Transition,
} from "../types/index.ts";
import { runProvider, type FixtureMeta } from "./actors/run-provider.ts";
import { runGuardian } from "./actors/run-guardian.ts";
import { runSystem } from "./actors/run-system.ts";
import { awaitGate } from "./actors/await-gate.ts";

export interface CompileOptions {
  variant: string;
  worktreePath: string;
  runId: string;
  ticketId?: string;
  /** Optional fixture replay payload. When omitted, actors invoke real providers. */
  fixtureMeta?: FixtureMeta;
  /** For test purposes: stop the engine when entering this node. */
  stopAtNodeId?: string;
}

export interface EngineContext {
  variant: string;
  round: number;
  worktreePath: string;
  runId: string;
  ticketId?: string;
  fixtureMeta?: FixtureMeta;
  /** Track ParallelGroup membership so aggregator actors know what to read. */
  groupMembers: Record<string, string[]>;
  /** Last guardian decision; used for downstream guards / progress events. */
  lastGuardianDecision?: string;
  /** Reached if engine hit stopAtNodeId — read by run.ts to short-circuit. */
  stoppedAt?: string;
}

export function compileFlow(
  flat: CompiledFlatFlow,
  opts: CompileOptions,
): AnyStateMachine {
  const variant = flat.variants[opts.variant];
  if (!variant) throw new Error(`unknown variant: ${opts.variant}`);

  // Build membership map: parent_group_id → [member_node_id, ...]
  const groupMembers: Record<string, string[]> = {};
  const memberToGroup: Record<string, string> = {};
  for (const [nodeId, node] of Object.entries(flat.nodes)) {
    if (isParallelGroup(node)) {
      groupMembers[nodeId] = [...node.members];
      for (const m of node.members) memberToGroup[m] = nodeId;
    }
  }

  // Build top-level states, omitting members of parallel groups (they live
  // inside their parent group below). Keys are XState-safe (dots replaced
  // with `__`); the original NodeId is preserved in `state.id` and actor
  // inputs.
  const topLevelStates: Record<string, unknown> = {};
  for (const [nodeId, node] of Object.entries(flat.nodes)) {
    if (memberToGroup[nodeId]) continue; // skip; emitted under its parent
    topLevelStates[xstateId(nodeId)] = compileNode(nodeId, node, flat, opts, groupMembers);
  }
  // Sink states.
  topLevelStates.__stopped__ = { type: "final" as const, id: "__stopped__" };
  topLevelStates.__failed__ = { type: "final" as const, id: "__failed__" };

  // The dynamic shape of `states` defies XState's deep generic inference, so
  // we cast through unknown. Schema validation has already enforced shape.
  const config: any = {
    id: flat.flow,
    initial: variant.initial,
    context: {
      variant: opts.variant,
      round: 1,
      worktreePath: opts.worktreePath,
      runId: opts.runId,
      ticketId: opts.ticketId,
      fixtureMeta: opts.fixtureMeta,
      groupMembers,
    },
    states: topLevelStates,
  };
  return setup({
    types: {} as { context: EngineContext; events: AnyEventObject; input: undefined },
    actors: { runProvider, runGuardian, runSystem, awaitGate },
  }).createMachine(config) as AnyStateMachine;
}

function compileNode(
  nodeId: string,
  node: FlatNode,
  flat: CompiledFlatFlow,
  opts: CompileOptions,
  groupMembers: Record<string, string[]>,
): unknown {
  let result: any;
  if (isParallelGroup(node)) {
    result = compileParallelGroup(nodeId, node, flat, opts, groupMembers);
  } else if (isProvider(node)) {
    result = compileProvider(nodeId, node, flat, opts);
  } else if (isGuardian(node)) {
    result = compileGuardian(nodeId, node, flat, opts, groupMembers);
  } else if (isSystem(node)) {
    result = compileSystem(nodeId, node, opts);
  } else if (isGate(node)) {
    result = compileGate(nodeId, node, opts);
  } else if (isTerminal(node)) {
    result = compileTerminal(node);
  } else {
    throw new Error(`unsupported node shape at ${nodeId}: ${JSON.stringify(node)}`);
  }
  // Use the XState-safe id so #-style refs work; original NodeId still
  // travels with actor inputs / commit metadata.
  result.id = xstateId(nodeId);
  return result;
}

/** Convert a public NodeId (which may contain dots) into an XState-safe id.
 *  XState treats `.` as a path separator even inside #id references, so we
 *  replace `.` with `__` for state ids while keeping the original NodeId in
 *  actor inputs / commit subjects / audit metadata. */
function xstateId(nodeId: string): string {
  return nodeId.replace(/\./g, "__");
}

/** Resolve a public NodeId target to its absolute #-style XState reference. */
function abs(target: string | undefined): string | undefined {
  if (!target) return undefined;
  if (target.startsWith("#")) return target;
  if (target === "__stopped__" || target === "__failed__") return "#" + target;
  return "#" + xstateId(target);
}

function compileProvider(
  nodeId: string,
  node: ProviderStepNode,
  flat: CompiledFlatFlow,
  opts: CompileOptions,
): unknown {
  const onDoneTarget = resolveTransition(node.on_done, opts.variant);
  if (!onDoneTarget) {
    throw new Error(
      `compile: top-level provider ${nodeId} has no on_done target`,
    );
  }
  const stopGuard = onDoneTarget === opts.stopAtNodeId;
  const targetNode = flat.nodes[onDoneTarget];
  const enteringParallel = !!(targetNode && isParallelGroup(targetNode));

  // F-011/H10-9: per-loop round counter.
  //   - First entry to a parallel_group from upstream: reset round to 1.
  //   - Repair loop-back (source is `<group>.repair`): increment.
  // Result: every node in a clean run reports round 1; only repair-driven
  // re-iteration of a review_loop bumps the number. Far less confusing
  // than the previous global stage counter.
  const isRepairLoopback =
    enteringParallel && nodeId === `${onDoneTarget}.repair`;

  const actions = enteringParallel
    ? assign({
        round: ({ context }: any) =>
          isRepairLoopback ? (context as EngineContext).round + 1 : 1,
      })
    : undefined;

  return {
    invoke: {
      src: "runProvider",
      input: ({ context }: { context: EngineContext }) => ({
        nodeId,
        round: context.round,
        worktreePath: context.worktreePath,
        runId: context.runId,
        fixtureMeta: context.fixtureMeta,
        provider: node.provider,
        role: node.role,
        promptSpec: node.prompt,
        ...(node.resume_session_from
          ? { resumeSessionFrom: node.resume_session_from }
          : {}),
        ...(node.enable_user_input
          ? { enableUserInput: true }
          : {}),
      }),
      onDone: stopGuard
        ? {
            target: "#__stopped__",
            actions: assign({ stoppedAt: () => onDoneTarget }),
          }
        : actions
        ? { target: abs(onDoneTarget), actions }
        : { target: abs(onDoneTarget) },
      onError: {
        target: "#__failed__",
        actions: assign({
          __lastError: ({ event }: any) =>
            `at ${nodeId}: ${(event?.error?.message ?? event?.error ?? "(no message)")}`,
        }),
      } as any,
    },
  };
}

function compileGuardian(
  nodeId: string,
  node: GuardianStepNode,
  flat: CompiledFlatFlow,
  opts: CompileOptions,
  groupMembers: Record<string, string[]>,
): unknown {
  // Determine which upstream node ids the guardian is supposed to consume.
  // Two sources, in priority order:
  //   1. node.inputs_from — explicit upstream link (e.g. final_verification
  //      reads code_quality_review.aggregate). Single string or array.
  //   2. Parent parallel_group membership — for aggregators emitted by the
  //      review_loop macro, the reviewer ids are the group's members.
  // If neither resolves, we fall through to []; the prompt + slim schema
  // cannot constrain evidence_consumed in that case (rare; flag it).
  let expectedEvidence: string[];
  if (node.inputs_from) {
    expectedEvidence = Array.isArray(node.inputs_from)
      ? [...node.inputs_from]
      : [node.inputs_from];
  } else {
    const parentGroupId = findParentGroup(nodeId, flat);
    expectedEvidence = parentGroupId ? groupMembers[parentGroupId] ?? [] : [];
  }

  const passTarget = resolveTransition(node.outputs.pass, opts.variant);
  const repairTarget = node.outputs.repair_needed?.next;
  const escalation = node.outputs.repair_needed?.max_round_escalation;
  const abortTarget = resolveTransition(node.outputs.abort, opts.variant);
  const escalateHumanTarget = resolveTransition(
    node.outputs.escalate_human,
    opts.variant,
  );

  const maxRounds = node.max_rounds ?? 1;

  // Build guarded onDone branches.
  type Branch = { guard?: (...args: unknown[]) => boolean; target: string; actions?: unknown };
  const branches: Branch[] = [];

  const stopOrAbs = (t: string | undefined) =>
    t === undefined
      ? undefined
      : t === opts.stopAtNodeId
      ? "#__stopped__"
      : abs(t);

  branches.push({
    guard: ({ event }: any) => event.output?.decision === "pass",
    target: stopOrAbs(passTarget) ?? "#__stopped__",
    actions: assign({
      lastGuardianDecision: () => "pass",
      ...(passTarget === opts.stopAtNodeId
        ? { stoppedAt: () => passTarget! }
        : {}),
    }) as unknown,
  });

  if (repairTarget) {
    branches.push({
      guard: ({ event, context }: any) =>
        event.output?.decision === "repair_needed" &&
        (context as EngineContext).round < maxRounds,
      target: abs(repairTarget),
      actions: assign({ lastGuardianDecision: () => "repair_needed" }) as unknown,
    });
    if (escalation) {
      branches.push({
        guard: ({ event }: any) => event.output?.decision === "repair_needed",
        target: stopOrAbs(escalation),
        actions: assign({
          lastGuardianDecision: () => "repair_needed_exhausted",
          ...(escalation === opts.stopAtNodeId
            ? { stoppedAt: () => escalation }
            : {}),
        }) as unknown,
      });
    }
  }
  if (abortTarget) {
    branches.push({
      guard: ({ event }: any) => event.output?.decision === "abort",
      target: stopOrAbs(abortTarget),
      actions: assign({ lastGuardianDecision: () => "abort" }) as unknown,
    });
    // Fallback: repair_needed when no repair is wired → route to abort.
    // Handles flows where the macro author set `repair: null` but the LLM
    // still legitimately decides repair_needed (it doesn't see flow shape).
    if (!repairTarget) {
      branches.push({
        guard: ({ event }: any) => event.output?.decision === "repair_needed",
        target: stopOrAbs(abortTarget),
        actions: assign({
          lastGuardianDecision: () => "repair_needed_no_repair_node",
        }) as unknown,
      });
    }
  }
  if (escalateHumanTarget) {
    branches.push({
      guard: ({ event }: any) => event.output?.decision === "escalate_human",
      target: stopOrAbs(escalateHumanTarget),
      actions: assign({ lastGuardianDecision: () => "escalate_human" }) as unknown,
    });
  }

  return {
    invoke: {
      src: "runGuardian",
      input: ({ context }: { context: EngineContext }) => ({
        nodeId,
        round: context.round,
        worktreePath: context.worktreePath,
        runId: context.runId,
        fixtureMeta: context.fixtureMeta,
        expectedEvidenceNodes: expectedEvidence,
        provider: node.provider,
        role: node.role,
        maxRounds: node.max_rounds,
      }),
      onDone: branches,
      onError: {
        target: "#__failed__",
        actions: assign({
          __lastError: ({ event }: any) =>
            `at ${nodeId}: ${(event?.error?.message ?? event?.error ?? "(no message)")}`,
        }),
      } as any,
    },
  };
}

function compileSystem(
  nodeId: string,
  node: SystemStepNode,
  opts: CompileOptions,
): unknown {
  const onDoneTarget = resolveTransition(node.on_done, opts.variant);
  const onFailureTarget = resolveTransition(node.on_failure, opts.variant);
  return {
    invoke: {
      src: "runSystem",
      input: ({ context }: { context: EngineContext }) => ({
        nodeId,
        action: node.action,
        worktreePath: context.worktreePath,
        runId: context.runId,
        ticketId: context.ticketId,
        params: node.params,
      }),
      onDone:
        onDoneTarget === opts.stopAtNodeId
          ? {
              target: "#__stopped__",
              actions: assign({ stoppedAt: () => onDoneTarget! }),
            }
          : { target: abs(onDoneTarget!) },
      onError: onFailureTarget ? { target: abs(onFailureTarget) } : { target: "#__failed__" },
    },
  };
}

function compileGate(
  nodeId: string,
  node: GateStepNode,
  opts: CompileOptions,
): unknown {
  // Build guarded onDone branches: actor returns { decision: 'approved' |
  // 'rejected' | 'cancelled' }; map each to the configured target node.
  type Branch = { guard: (...a: unknown[]) => boolean; target: string; actions?: unknown };
  const branches: Branch[] = [];
  for (const [key, target] of Object.entries(node.outputs)) {
    const resolved = resolveTransition(target as Transition, opts.variant);
    if (!resolved) continue;
    branches.push({
      guard: ({ event }: any) => event.output?.decision === key,
      target: resolved === opts.stopAtNodeId ? "#__stopped__" : abs(resolved)!,
      actions: assign({
        lastGuardianDecision: () => `gate_${key}`,
        ...(resolved === opts.stopAtNodeId
          ? { stoppedAt: () => resolved }
          : {}),
      }) as unknown,
    });
  }

  return {
    invoke: {
      src: "awaitGate",
      input: ({ context }: { context: EngineContext }) => ({
        nodeId,
        round: context.round,
        worktreePath: context.worktreePath,
        runId: context.runId,
        fixtureMeta: context.fixtureMeta,
      }),
      onDone: branches,
      onError: {
        target: "#__failed__",
        actions: assign({
          __lastError: ({ event }: any) =>
            `at ${nodeId}: ${event?.error?.message ?? "(no message)"}`,
        }),
      } as any,
    },
  };
}

function compileTerminal(node: TerminalNode): unknown {
  return { type: "final" as const };
}

function compileParallelGroup(
  nodeId: string,
  group: ParallelGroup,
  flat: CompiledFlatFlow,
  opts: CompileOptions,
  groupMembers: Record<string, string[]>,
): unknown {
  // Each member becomes a parallel region with internal running → completed.
  const regions: Record<string, unknown> = {};
  for (const memberId of group.members) {
    const memberNode = flat.nodes[memberId];
    if (!memberNode) {
      throw new Error(`parallel member not found: ${memberId}`);
    }
    if (!isProvider(memberNode)) {
      throw new Error(
        `parallel member must be provider_step, got ${(memberNode as { type?: string }).type} for ${memberId}`,
      );
    }
    // Use the suffix after the parent prefix as the region key.
    const suffix = memberId.startsWith(nodeId + ".")
      ? memberId.slice(nodeId.length + 1).replace(/\./g, "_")
      : memberId.replace(/\./g, "_");
    regions[suffix] = {
      initial: "running",
      states: {
        running: {
          invoke: {
            src: "runProvider",
            input: ({ context }: { context: EngineContext }) => ({
              nodeId: memberId,
              round: context.round,
              worktreePath: context.worktreePath,
              runId: context.runId,
              fixtureMeta: context.fixtureMeta,
              provider: (memberNode as ProviderStepNode).provider,
              role: (memberNode as ProviderStepNode).role,
              promptSpec: (memberNode as ProviderStepNode).prompt,
              ...((memberNode as ProviderStepNode).resume_session_from
                ? {
                    resumeSessionFrom: (memberNode as ProviderStepNode)
                      .resume_session_from,
                  }
                : {}),
              ...((memberNode as ProviderStepNode).enable_user_input
                ? { enableUserInput: true }
                : {}),
            }),
            onDone: { target: "completed" },
            onError: { target: "failed" },
          },
        },
        completed: { type: "final" as const },
        failed: { type: "final" as const },
      },
    };
  }

  const onAllDoneTarget = resolveTransition(group.on_all_done, opts.variant);
  return {
    type: "parallel" as const,
    states: regions,
    onDone:
      onAllDoneTarget === opts.stopAtNodeId
        ? {
            target: "#__stopped__",
            actions: assign({ stoppedAt: () => onAllDoneTarget! }),
          }
        : { target: abs(onAllDoneTarget!) },
    // Reset round counter to 1 each time we ENTER the parallel group.
    // (Re-entry from repair → loop-back should see round++; the repair
    // transition itself bumps round, and the parent re-enter does NOT clobber
    // it because XState's `entry` only runs on initial entry, not re-entry?
    // Actually XState fires entry on every re-entry. To preserve round-2
    // semantics we have to NOT reset on entry. Instead, callers reset via
    // context.round = 1 when entering a fresh review.
    // For the prototype, the test seeds context.round = 1 and only the
    // repair → parent transition increments it; XState will keep the value
    // across the parallel re-entry.
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level "stopped" + "failed" sink states. Added by the wrapper below.
// We add these to the machine so that test runs can short-circuit cleanly
// instead of running every successor node.
// ─────────────────────────────────────────────────────────────────────────

export function withSinkStates(states: Record<string, unknown>): Record<string, unknown> {
  return {
    ...states,
    __stopped__: { type: "final" as const },
    __failed__: { type: "final" as const },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function resolveTransition(
  t: Transition | undefined,
  variant: string,
): string | undefined {
  if (t === undefined) return undefined;
  if (typeof t === "string") return t;
  const map = t as Record<string, string>;
  return map[variant] ?? map.full ?? Object.values(map)[0];
}

function findParentGroup(nodeId: string, flat: CompiledFlatFlow): string | undefined {
  for (const [pid, n] of Object.entries(flat.nodes)) {
    if (isParallelGroup(n) && (n as ParallelGroup).on_all_done === nodeId) {
      return pid;
    }
  }
  return undefined;
}

function isParallelGroup(n: FlatNode): n is ParallelGroup {
  return (n as { type?: string }).type === "parallel_group";
}
function isProvider(n: FlatNode): n is ProviderStepNode {
  return (n as { type?: string }).type === "provider_step";
}
function isGuardian(n: FlatNode): n is GuardianStepNode {
  return (n as { type?: string }).type === "guardian_step";
}
function isSystem(n: FlatNode): n is SystemStepNode {
  return (n as { type?: string }).type === "system_step";
}
function isGate(n: FlatNode): n is GateStepNode {
  return (n as { type?: string }).type === "gate_step";
}
function isTerminal(n: FlatNode): n is TerminalNode {
  return (n as { type?: string }).type === "terminal";
}
