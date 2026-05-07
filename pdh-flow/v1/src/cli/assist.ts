// CLI commands for assist sessions and recommendation handling.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getStep, outcomeFromDecision } from "../flow/load.ts";
import {
  allowedAssistSignals,
  appendAssistSignal,
  appendTicketStartRequest,
  loadLatestAssistSignal,
  markAssistSessionFinished,
  markAssistSessionStarted,
  prepareAssistSession,
  prepareRepoAssistSession,
  prepareTicketAssistSession,
  repoAssistSessionPath,
  ticketAssistSessionPath,
  updateLatestAssistSignal
} from "../runtime/assist/runtime.ts";
import { answerLatestInterruption } from "../runtime/interruptions.ts";
import {
  appendProgressEvent,
  clearHumanGateProposal,
  defaultStateDir,
  latestHumanGate,
  resolveHumanGate,
  updateHumanGateProposal,
  updateRun
} from "../runtime/state.ts";
import { loadDotEnv } from "../support/env.ts";
import type { ProviderRunResult } from "../types.ts";
import {
  advanceRun,
  cmdRunNext,
  readMessageOption,
  refreshGateSummary,
  rerunFromStep,
  syncStepUiRuntime,
  withRuntimeLock
} from "./index.ts";
import {
  applyAssistSignalCommand,
  assertCurrentStep,
  assertRerunTarget,
  assistOpenCommand,
  humanStopCommands,
  isHumanGateStep,
  parseOptions,
  proposalStopCommands,
  rerunCurrentStepCommand,
  required,
  requireRuntime,
  resumeCommand,
  runNextCommand
} from "./utils.ts";

export async function cmdAssistOpen(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  loadDotEnv();
  let prepared = null;
  let runId = null;
  let stepId = null;
  let runtimeStatus = null;

  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const step = getStep(runtime.flow, stepId);
    const gate = latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId });
    const allowedSignals = allowedAssistSignals({ runStatus: runtime.run.status, step, runtime, gate });
    prepared = prepareAssistSession({
      repoPath: repo,
      runtime,
      step,
      bare: options.bare === "true",
      model: options.model ?? null
    });
    runId = runtime.run.id;
    runtimeStatus = runtime.run.status;
    appendProgressEvent({
      repoPath: repo,
      runId,
      stepId,
      type: "assist_prepared",
      provider: "runtime",
      message: `${stepId} assist prepared`,
      payload: {
        sessionId: prepared.sessionId,
        manifestPath: prepared.manifestPath,
        promptPath: prepared.promptPath,
        allowedSignals: prepared.allowedSignals
      }
    });
    syncStepUiRuntime({ repo, stepId });
  } });

  const args = buildAssistClaudeArgs({
    prepared,
    model: options.model ?? null,
    bare: options.bare === "true"
  });

  if (options["prepare-only"] === "true") {
    console.log(JSON.stringify({
      sessionId: prepared.sessionId,
      manifestPath: prepared.manifestPath,
      promptPath: prepared.promptPath,
      systemPromptPath: prepared.systemPromptPath,
      allowedSignals: prepared.allowedSignals,
      wrappers: {
        signal: prepared.wrappers.signalScriptPath,
        test: prepared.wrappers.testScriptPath
      },
      command: [process.env.CLAUDE_BIN || "claude", ...args]
    }, null, 2));
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("assist-open needs a TTY. Use --prepare-only for non-interactive use.");
  }

  markAssistSessionStarted({
    stateDir: defaultStateDir(repo),
    runId,
    stepId,
    sessionId: prepared.sessionId,
    command: [process.env.CLAUDE_BIN || "claude", ...args]
  });
  appendProgressEvent({
    repoPath: repo,
    runId,
    stepId,
    type: "assist_started",
    provider: "runtime",
    message: `${stepId} assist started`,
    payload: {
      sessionId: prepared.sessionId,
      status: runtimeStatus
    }
  });

  console.log(`Assist session: ${prepared.sessionId}`);
  console.log(`Manifest: ${prepared.manifestPath}`);
  console.log(`Prompt: ${prepared.promptPath}`);
  console.log(`Allowed signals: ${prepared.allowedSignals.join(", ")}`);

  const exit = await spawnAssistClaude({
    repo,
    args,
    command: process.env.CLAUDE_BIN || "claude"
  });

  markAssistSessionFinished({
    stateDir: defaultStateDir(repo),
    runId,
    stepId,
    sessionId: prepared.sessionId,
    exitCode: exit.exitCode,
    signal: exit.signal
  });
  appendProgressEvent({
    repoPath: repo,
    runId,
    stepId,
    type: "assist_finished",
    provider: "runtime",
    message: `${stepId} assist ${exit.exitCode === 0 ? "completed" : "failed"}`,
    payload: {
      sessionId: prepared.sessionId,
      exitCode: exit.exitCode,
      signal: exit.signal
    }
  });
  if (exit.exitCode !== 0) {
    process.exitCode = exit.exitCode ?? 1;
  }
}

export async function cmdTicketAssistOpen(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  loadDotEnv();
  const ticketId = required(options, "ticket");
  const variant = options.variant ?? "full";
  const prepared = prepareTicketAssistSession({
    repoPath: repo,
    ticketId,
    variant,
    bare: options.bare === "true",
    model: options.model ?? null
  });
  const args = buildAssistClaudeArgs({
    prepared,
    model: options.model ?? null,
    bare: options.bare === "true"
  });

  if (options["prepare-only"] === "true") {
    console.log(JSON.stringify({
      sessionId: prepared.sessionId,
      manifestPath: prepared.manifestPath,
      promptPath: prepared.promptPath,
      systemPromptPath: prepared.systemPromptPath,
      wrappers: {
        ticketStartRequest: prepared.wrappers.ticketStartRequestScriptPath,
        test: prepared.wrappers.testScriptPath
      },
      command: [process.env.CLAUDE_BIN || "claude", ...args]
    }, null, 2));
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("ticket-assist-open needs a TTY. Use --prepare-only for non-interactive use.");
  }

  markTicketAssistSessionStarted({
    repoPath: repo,
    ticketId,
    sessionId: prepared.sessionId,
    command: [process.env.CLAUDE_BIN || "claude", ...args]
  });

  console.log(`Assist session: ${prepared.sessionId}`);
  console.log(`Manifest: ${prepared.manifestPath}`);
  console.log(`Prompt: ${prepared.promptPath}`);

  const exit = await spawnAssistClaude({
    repo,
    args,
    command: process.env.CLAUDE_BIN || "claude"
  });

  markTicketAssistSessionFinished({
    repoPath: repo,
    ticketId,
    sessionId: prepared.sessionId,
    exitCode: exit.exitCode,
    signal: exit.signal
  });
  if (exit.exitCode !== 0) {
    process.exitCode = exit.exitCode ?? 1;
  }
}

export async function cmdRepoAssistOpen(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  loadDotEnv();
  const prepared = prepareRepoAssistSession({
    repoPath: repo,
    bare: options.bare === "true",
    model: options.model ?? null
  });
  const args = buildAssistClaudeArgs({
    prepared,
    model: options.model ?? null,
    bare: options.bare === "true"
  });

  if (options["prepare-only"] === "true") {
    console.log(JSON.stringify({
      sessionId: prepared.sessionId,
      manifestPath: prepared.manifestPath,
      promptPath: prepared.promptPath,
      systemPromptPath: prepared.systemPromptPath,
      command: [process.env.CLAUDE_BIN || "claude", ...args]
    }, null, 2));
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("repo-assist-open needs a TTY. Use --prepare-only for non-interactive use.");
  }

  markRepoAssistSessionStarted({
    repoPath: repo,
    sessionId: prepared.sessionId,
    command: [process.env.CLAUDE_BIN || "claude", ...args]
  });

  console.log(`Repo assist session: ${prepared.sessionId}`);
  console.log(`Manifest: ${prepared.manifestPath}`);
  console.log(`Prompt: ${prepared.promptPath}`);

  const exit = await spawnAssistClaude({
    repo,
    args,
    command: process.env.CLAUDE_BIN || "claude"
  });

  markRepoAssistSessionFinished({
    repoPath: repo,
    sessionId: prepared.sessionId,
    exitCode: exit.exitCode,
    signal: exit.signal
  });
  if (exit.exitCode !== 0) {
    process.exitCode = exit.exitCode ?? 1;
  }
}

export async function cmdAssistSignal(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const signal = normalizeAssistSignal(required(options, "signal"));
  const autoRunNext = options["no-run-next"] !== "true";
  let response = null;
  let shouldRunNext = false;

  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const step = getStep(runtime.flow, stepId);
    const signalGate = latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId });
    const allowedSignals = allowedAssistSignals({ runStatus: runtime.run.status, step, runtime, gate: signalGate });
    if (!allowedSignals.includes(signal)) {
      throw new Error(`Signal ${signal} is not allowed while status=${runtime.run.status} step=${stepId}. Allowed: ${allowedSignals.join(", ") || "(none)"}`);
    }

    const reason = options.reason ?? null;
    const message = signal === "answer" ? readMessageOption(options, "assist-signal") : null;
    const targetStepId = signal === "propose-rerun-from" ? required(options, "target-step") : null;
    const recorded = appendAssistSignal({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId,
      signal,
      reason,
      message,
      runNext: autoRunNext
    });

    if (runtime.run.status === "needs_human") {
      if (signal === "propose-rerun-from") {
        assertRerunTarget({ runtime, currentStepId: stepId, targetStepId });
      }
      const summary = refreshGateSummary({ repo, runtime, step });
      const gate = updateHumanGateProposal({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId,
        action: signal.replace(/^propose-/, "").replaceAll("-", "_"),
        reason,
        target_step_id: targetStepId
      });
      updateRun(repo, { status: "needs_human", current_step_id: stepId });
      appendProgressEvent({
        repoPath: repo,
        runId: runtime.run.id,
        stepId,
        type: "human_gate_proposed",
        provider: "runtime",
        message: `${stepId} ${gate.proposal?.action || signal} via assist`,
        payload: { ...gate, assistSignal: recorded, summary: summary.artifactPath }
      });
      syncStepUiRuntime({ repo, stepId, nextCommands: proposalStopCommands(repo, stepId) });
      response = {
        status: "ok",
        stepId,
        signal,
        proposal: gate.proposal,
        summary: summary.artifactPath,
        runNext: false
      };
      return;
    }

    if (runtime.run.status === "interrupted") {
      const interruption = answerLatestInterruption({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId,
        message,
        source: "assist"
      });
      updateRun(repo, { status: "running", current_step_id: stepId });
      appendProgressEvent({
        repoPath: repo,
        runId: runtime.run.id,
        stepId,
        type: "interrupt_answered",
        provider: "runtime",
        message: `${stepId} interrupt answered via assist`,
        payload: { ...interruption, assistSignal: recorded }
      });
      syncStepUiRuntime({ repo, stepId, nextCommands: [runNextCommand(repo)] });
      response = {
        status: "ok",
        stepId,
        signal,
        answered: interruption.id,
        runNext: autoRunNext
      };
      shouldRunNext = autoRunNext;
      return;
    }

    if (runtime.run.status === "failed") {
      updateLatestAssistSignal({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId,
        mutator(current) {
          if (!current || current.id !== recorded.id) {
            return current;
          }
          return {
            ...current,
            status: "pending"
          };
        }
      });
      appendProgressEvent({
        repoPath: repo,
        runId: runtime.run.id,
        stepId,
        type: "assist_continue_requested",
        provider: "runtime",
        message: `${stepId} rerun requested via assist`,
        payload: recorded
      });
      syncStepUiRuntime({ repo, stepId, nextCommands: [assistOpenCommand(repo, stepId), applyAssistSignalCommand(repo, stepId), resumeCommand(repo)] });
      response = {
        status: "ok",
        stepId,
        signal,
        pendingConfirmation: true,
        next: applyAssistSignalCommand(repo, stepId),
        runNext: false
      };
      return;
    }

    updateRun(repo, { status: "running", current_step_id: stepId });
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId,
      type: "assist_continue",
      provider: "runtime",
      message: `${stepId} continue via assist`,
      payload: recorded
    });
    syncStepUiRuntime({ repo, stepId, nextCommands: [runNextCommand(repo)] });
    response = {
      status: "ok",
      stepId,
      signal,
      runNext: autoRunNext
    };
    shouldRunNext = autoRunNext;
  } });

  console.log(JSON.stringify(response, null, 2));
  if (shouldRunNext) {
    await cmdRunNext(["--repo", repo]);
  }
}

export async function cmdTicketStartRequest(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const ticketId = required(options, "ticket");
  const variant = options.variant ?? "full";
  const request = appendTicketStartRequest({
    repoPath: repo,
    ticketId,
    variant,
    reason: options.reason ?? null,
    source: options.source ?? "assist"
  });
  console.log(JSON.stringify(request, null, 2));
}

export async function cmdApplyAssistSignal(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const autoRunNext = options["no-run-next"] !== "true";
  let response = null;
  let shouldRunNext = false;

  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const signal = loadLatestAssistSignal({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId });
    if (!signal) {
      throw new Error(`${stepId} does not have a latest assist signal`);
    }
    if (signal.signal !== "continue") {
      throw new Error(`${stepId} latest assist signal is ${signal.signal}; only continue can be applied here`);
    }
    if (runtime.run.status !== "failed" && runtime.run.status !== "blocked") {
      throw new Error(`${stepId} assist continue can only be applied while status is failed or blocked; current status is ${runtime.run.status}`);
    }
    const updatedSignal = updateLatestAssistSignal({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId,
      mutator(current) {
        if (!current || current.id !== signal.id) {
          return current;
        }
        return {
          ...current,
          status: "accepted",
          accepted_at: new Date().toISOString()
        };
      }
    }) ?? signal;
    updateRun(repo, { status: "running", current_step_id: stepId });
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId,
      type: "assist_continue_accepted",
      provider: "runtime",
      message: `${stepId} rerun accepted via assist`,
      payload: updatedSignal
    });
    syncStepUiRuntime({ repo, stepId, nextCommands: [rerunCurrentStepCommand(repo)] });
    response = {
      status: "ok",
      stepId,
      signal: updatedSignal.signal,
      runNext: autoRunNext
    };
    shouldRunNext = autoRunNext;
  } });

  console.log(JSON.stringify(response, null, 2));
  if (shouldRunNext) {
    await cmdRunNext(["--repo", repo, "--force"]);
  }
}

export async function cmdAcceptProposal(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const autoRunNext = options["no-run-next"] !== "true";
  let response = null;
  let shouldRunNext = false;

  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const step = getStep(runtime.flow, stepId);
    if (!isHumanGateStep(step)) {
      throw new Error(`${stepId} is not a human gate step`);
    }
    const gate = latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId });
    const proposal = gate?.proposal;
    if (!proposal || proposal.status !== "pending") {
      throw new Error(`${stepId} does not have a pending proposal`);
    }
    assertProposalCompatibleWithGateEdits({ runtime, stepId, gate, proposal });

    let advanced = null;
    if (proposal.action === "rerun_from") {
      const targetStepId = proposal.target_step_id;
      if (!targetStepId) {
        throw new Error(`${stepId} proposal is missing target_step_id`);
      }
      assertRerunTarget({ runtime, currentStepId: stepId, targetStepId });
      resolveHumanGate({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId,
        decision: "changes_requested"
      });
      advanced = rerunFromStep({
        repo,
        runtime,
        step,
        targetStepId,
        reason: proposal.reason
      });
    } else {
      const decision = gateDecisionFromProposal(proposal.action);
      if (!decision) {
        throw new Error(`Unsupported proposal action: ${proposal.action}`);
      }
      resolveHumanGate({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId,
        decision
      });
      advanced = advanceRun({
        repo,
        runtime,
        step,
        outcome: outcomeFromDecision(decision)
      });
    }

    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId,
      type: "human_gate_proposal_accepted",
      provider: "runtime",
      message: `${stepId} accepted ${proposal.action}`,
      payload: {
        proposal,
        result: advanced
      }
    });
    response = {
      status: "ok",
      stepId,
      accepted: proposal,
      result: advanced,
      runNext: autoRunNext && advanced?.status !== "completed"
    };
    shouldRunNext = autoRunNext && advanced?.status !== "completed";
  } });

  console.log(JSON.stringify(response, null, 2));
  if (shouldRunNext) {
    await cmdRunNext(["--repo", repo]);
  }
}

export async function cmdDeclineProposal(argv) {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  let response = null;

  await withRuntimeLock({ repo, options, action: async () => {
    const runtime = requireRuntime(repo);
    const stepId = options.step ?? runtime.run.current_step_id;
    assertCurrentStep(runtime.run, stepId, options);
    const step = getStep(runtime.flow, stepId);
    if (!isHumanGateStep(step)) {
      throw new Error(`${stepId} is not a human gate step`);
    }
    const gate = latestHumanGate({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId });
    const proposal = gate?.proposal;
    if (!proposal || proposal.status !== "pending") {
      throw new Error(`${stepId} does not have a pending proposal`);
    }
    clearHumanGateProposal({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId
    });
    updateRun(repo, { status: "needs_human", current_step_id: stepId });
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId,
      type: "human_gate_proposal_declined",
      provider: "runtime",
      message: `${stepId} declined ${proposal.action}`,
      payload: {
        proposal
      }
    });
    syncStepUiRuntime({ repo, stepId, nextCommands: humanStopCommands(repo, stepId) });
    response = {
      status: "ok",
      stepId,
      declined: proposal,
      next: assistOpenCommand(repo, stepId)
    };
  } });

  console.log(JSON.stringify(response, null, 2));
}

// --- helpers ---

export function buildAssistClaudeArgs({ prepared, model = null, bare = false }) {
  const args = [
    "--append-system-prompt",
    prepared.systemPrompt,
    "--setting-sources",
    "user",
    "--permission-mode",
    "bypassPermissions",
    "-n",
    prepared.manifest.step?.id
      ? `pdh-assist:${prepared.manifest.step.id}`
      : `pdh-ticket-assist:${prepared.manifest.ticket || "session"}`
  ];
  if (model) {
    args.push("--model", model);
  }
  if (!bare) {
    args.push(readFileSync(prepared.promptPath, "utf8"));
  }
  return args;
}

function markTicketAssistSessionStarted({ repoPath, ticketId, sessionId, command }) {
  updateTicketAssistSession({
    repoPath,
    ticketId,
    sessionId,
    mutator(session) {
      return {
        ...session,
        status: "running",
        started_at: new Date().toISOString(),
        command
      };
    }
  });
}

function markTicketAssistSessionFinished({ repoPath, ticketId, sessionId, exitCode, signal = null }) {
  updateTicketAssistSession({
    repoPath,
    ticketId,
    sessionId,
    mutator(session) {
      return {
        ...session,
        status: exitCode === 0 ? "exited" : "failed",
        finished_at: new Date().toISOString(),
        exit_code: exitCode,
        signal
      };
    }
  });
}

function markRepoAssistSessionStarted({ repoPath, sessionId, command }) {
  updateRepoAssistSession({
    repoPath,
    sessionId,
    mutator(session) {
      return {
        ...session,
        status: "running",
        started_at: new Date().toISOString(),
        command
      };
    }
  });
}

function markRepoAssistSessionFinished({ repoPath, sessionId, exitCode, signal = null }) {
  updateRepoAssistSession({
    repoPath,
    sessionId,
    mutator(session) {
      return {
        ...session,
        status: exitCode === 0 ? "exited" : "failed",
        finished_at: new Date().toISOString(),
        exit_code: exitCode,
        signal
      };
    }
  });
}

function updateRepoAssistSession({ repoPath, sessionId, mutator }) {
  const path = repoAssistSessionPath({ repoPath });
  if (!existsSync(path)) {
    return null;
  }
  const session = JSON.parse(readFileSync(path, "utf8"));
  if (session.id !== sessionId) {
    return session;
  }
  const updated = mutator(session) ?? session;
  writeFileSync(path, JSON.stringify(updated, null, 2) + "\n");
  return updated;
}

function updateTicketAssistSession({ repoPath, ticketId, sessionId, mutator }) {
  const path = ticketAssistSessionPath({ repoPath, ticketId });
  if (!existsSync(path)) {
    return null;
  }
  const session = JSON.parse(readFileSync(path, "utf8"));
  if (session.id !== sessionId) {
    return session;
  }
  const updated = mutator(session) ?? session;
  writeFileSync(path, JSON.stringify(updated, null, 2) + "\n");
  return updated;
}

function normalizeAssistSignal(signal) {
  const map = {
    "approve": "propose-approve",
    "request-changes": "propose-request-changes",
    "reject": "propose-reject",
    "rerun-from": "propose-rerun-from"
  };
  return map[signal] || signal;
}

function gateDecisionFromProposal(action) {
  const map = {
    approve: "approved",
    request_changes: "changes_requested",
    reject: "rejected"
  };
  return map[action] ?? null;
}

export function formatProposal(proposal) {
  if (!proposal) return "(none)";
  const action = proposal.action || "(unknown)";
  const target = proposal.target_step_id ? ` -> ${proposal.target_step_id}` : "";
  const reason = proposal.reason ? ` (${proposal.reason})` : "";
  return `${action}${target}${reason}`;
}

function assertProposalCompatibleWithGateEdits({ runtime, stepId, gate, proposal }) {
  const requiredTargetStepId = gate?.rerun_requirement?.target_step_id;
  if (!requiredTargetStepId) {
    return;
  }
  if (proposal.action !== "rerun_from") {
    if (proposal.action === "reject") {
      return;
    }
    throw new Error(`${stepId} gate edits require rerun from ${requiredTargetStepId}: ${gate.rerun_requirement.reason}`);
  }
  const sequence = runtime.flow.variants?.[runtime.run.flow_variant]?.sequence ?? [];
  const requiredIndex = sequence.indexOf(requiredTargetStepId);
  const targetIndex = sequence.indexOf(proposal.target_step_id);
  if (targetIndex < 0 || requiredIndex < 0) {
    return;
  }
  if (targetIndex > requiredIndex) {
    throw new Error(`${stepId} gate edits require rerun from ${requiredTargetStepId} or earlier, but the proposal targets ${proposal.target_step_id}. ${gate.rerun_requirement.reason}`);
  }
}

async function spawnAssistClaude({ repo, command, args }: { repo: string; command: string; args: string[] }): Promise<ProviderRunResult> {
  const child = spawn(command, args, {
    cwd: repo,
    stdio: "inherit",
    env: process.env
  });
  return await new Promise<ProviderRunResult>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({
      exitCode: code ?? (signal ? 1 : 0),
      pid: child.pid ?? null,
      finalMessage: "",
      sessionId: null,
      stderr: "",
      timedOut: false,
      timeoutKind: null,
      signal
    }));
  });
}
