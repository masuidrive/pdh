// CLI commands for assist sessions and recommendation handling.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getStep, outcomeFromDecision } from "../core/flow.mjs";
import {
  allowedAssistSignals,
  appendAssistSignal,
  appendTicketStartRequest,
  loadLatestAssistSignal,
  markAssistSessionFinished,
  markAssistSessionStarted,
  prepareAssistSession,
  prepareTicketAssistSession,
  ticketAssistSessionPath,
  updateLatestAssistSignal
} from "../runtime/assist-runtime.mjs";
import { answerLatestInterruption } from "../runtime/interruptions.mjs";
import {
  appendProgressEvent,
  clearHumanGateRecommendation,
  defaultStateDir,
  latestHumanGate,
  resolveHumanGate,
  updateHumanGateRecommendation,
  updateRun
} from "../runtime/runtime-state.mjs";
import { loadDotEnv } from "../core/env.mjs";
import {
  advanceRun,
  cmdRunNext,
  readMessageOption,
  refreshGateSummary,
  rerunFromStep,
  syncStepUiRuntime,
  withRuntimeLock
} from "./index.mjs";
import {
  applyAssistSignalCommand,
  assertCurrentStep,
  assertRerunTarget,
  assistOpenCommand,
  humanStopCommands,
  isHumanGateStep,
  parseOptions,
  recommendedStopCommands,
  rerunCurrentStepCommand,
  required,
  requireRuntime,
  resumeCommand,
  runNextCommand
} from "./utils.mjs";

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
    const allowedSignals = allowedAssistSignals({ runStatus: runtime.run.status, step, runtime });
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
    const allowedSignals = allowedAssistSignals({ runStatus: runtime.run.status, step, runtime });
    if (!allowedSignals.includes(signal)) {
      throw new Error(`Signal ${signal} is not allowed while status=${runtime.run.status} step=${stepId}. Allowed: ${allowedSignals.join(", ") || "(none)"}`);
    }

    const reason = options.reason ?? null;
    const message = signal === "answer" ? readMessageOption(options, "assist-signal") : null;
    const targetStepId = signal === "recommend-rerun-from" ? required(options, "target-step") : null;
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
      if (signal === "recommend-rerun-from") {
        assertRerunTarget({ runtime, currentStepId: stepId, targetStepId });
      }
      const summary = refreshGateSummary({ repo, runtime, step });
      const gate = updateHumanGateRecommendation({
        stateDir: runtime.stateDir,
        runId: runtime.run.id,
        stepId,
        action: signal.replace(/^recommend-/, "").replaceAll("-", "_"),
        reason,
        target_step_id: targetStepId
      });
      updateRun(repo, { status: "needs_human", current_step_id: stepId });
      appendProgressEvent({
        repoPath: repo,
        runId: runtime.run.id,
        stepId,
        type: "human_gate_recommended",
        provider: "runtime",
        message: `${stepId} ${gate.recommendation?.action || signal} via assist`,
        payload: { ...gate, assistSignal: recorded, summary: summary.artifactPath }
      });
      syncStepUiRuntime({ repo, stepId, nextCommands: recommendedStopCommands(repo, stepId) });
      response = {
        status: "ok",
        stepId,
        signal,
        recommendation: gate.recommendation,
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

export async function cmdAcceptRecommendation(argv) {
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
    const recommendation = gate?.recommendation;
    if (!recommendation || recommendation.status !== "pending") {
      throw new Error(`${stepId} does not have a pending recommendation`);
    }
    assertRecommendationCompatibleWithGateEdits({ runtime, stepId, gate, recommendation });

    let advanced = null;
    if (recommendation.action === "rerun_from") {
      const targetStepId = recommendation.target_step_id;
      if (!targetStepId) {
        throw new Error(`${stepId} recommendation is missing target_step_id`);
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
        reason: recommendation.reason
      });
    } else {
      const decision = gateDecisionFromRecommendation(recommendation.action);
      if (!decision) {
        throw new Error(`Unsupported recommendation action: ${recommendation.action}`);
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
      type: "human_gate_recommendation_accepted",
      provider: "runtime",
      message: `${stepId} accepted ${recommendation.action}`,
      payload: {
        recommendation,
        result: advanced
      }
    });
    response = {
      status: "ok",
      stepId,
      accepted: recommendation,
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

export async function cmdDeclineRecommendation(argv) {
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
    const recommendation = gate?.recommendation;
    if (!recommendation || recommendation.status !== "pending") {
      throw new Error(`${stepId} does not have a pending recommendation`);
    }
    clearHumanGateRecommendation({
      stateDir: runtime.stateDir,
      runId: runtime.run.id,
      stepId
    });
    updateRun(repo, { status: "needs_human", current_step_id: stepId });
    appendProgressEvent({
      repoPath: repo,
      runId: runtime.run.id,
      stepId,
      type: "human_gate_recommendation_declined",
      provider: "runtime",
      message: `${stepId} declined ${recommendation.action}`,
      payload: {
        recommendation
      }
    });
    syncStepUiRuntime({ repo, stepId, nextCommands: humanStopCommands(repo, stepId) });
    response = {
      status: "ok",
      stepId,
      declined: recommendation,
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
  if (!bare) {
    args.push("--prompt-file", prepared.promptPath);
  }
  if (model) {
    args.push("--model", model);
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
    "approve": "recommend-approve",
    "request-changes": "recommend-request-changes",
    "reject": "recommend-reject",
    "rerun-from": "recommend-rerun-from"
  };
  return map[signal] || signal;
}

function gateDecisionFromRecommendation(action) {
  const map = {
    approve: "approved",
    request_changes: "changes_requested",
    reject: "rejected"
  };
  return map[action] ?? null;
}

export function formatRecommendation(recommendation) {
  if (!recommendation) return "(none)";
  const action = recommendation.action || "(unknown)";
  const target = recommendation.target_step_id ? ` -> ${recommendation.target_step_id}` : "";
  const reason = recommendation.reason ? ` (${recommendation.reason})` : "";
  return `${action}${target}${reason}`;
}

function assertRecommendationCompatibleWithGateEdits({ runtime, stepId, gate, recommendation }) {
  const requiredTargetStepId = gate?.rerun_requirement?.target_step_id;
  if (!requiredTargetStepId) {
    return;
  }
  if (recommendation.action !== "rerun_from") {
    if (recommendation.action === "reject") {
      return;
    }
    throw new Error(`${stepId} gate edits require rerun from ${requiredTargetStepId}: ${gate.rerun_requirement.reason}`);
  }
  const sequence = runtime.flow.variants?.[runtime.run.flow_variant]?.sequence ?? [];
  const requiredIndex = sequence.indexOf(requiredTargetStepId);
  const targetIndex = sequence.indexOf(recommendation.target_step_id);
  if (targetIndex < 0 || requiredIndex < 0) {
    return;
  }
  if (targetIndex > requiredIndex) {
    throw new Error(`${stepId} gate edits require rerun from ${requiredTargetStepId} or earlier, but the recommendation targets ${recommendation.target_step_id}. ${gate.rerun_requirement.reason}`);
  }
}

async function spawnAssistClaude({ repo, command, args }) {
  const child = spawn(command, args, {
    cwd: repo,
    stdio: "inherit",
    env: process.env
  });
  return await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ exitCode: code ?? (signal ? 1 : 0), signal }));
  });
}
