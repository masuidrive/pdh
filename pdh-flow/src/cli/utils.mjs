// Shared CLI helpers: argv parsing, step assertions, and `pdh-flow X` command-builder strings.
import { loadRuntime } from "../runtime/runtime-state.mjs";

export function requireRuntime(repo) {
  const runtime = loadRuntime(repo, { normalizeStaleRunning: true });
  if (!runtime.run?.current_step_id || !runtime.run?.flow_id) {
    throw new Error("No active run found in current-note.md");
  }
  return runtime;
}

export function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const eq = token.indexOf("=");
    if (eq > 0) {
      options[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = "true";
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

export function required(options, key) {
  if (!options[key]) {
    throw new Error(`Missing --${key}`);
  }
  return options[key];
}

export function assertStepInVariant(flow, variant, stepId) {
  const sequence = flow.variants?.[variant]?.sequence ?? [];
  if (!sequence.includes(stepId)) {
    throw new Error(`${stepId} is not in ${variant} flow`);
  }
}

export function assertCurrentStep(run, stepId, options = {}) {
  if (options.force === "true") {
    return;
  }
  if (run.current_step_id !== stepId) {
    throw new Error(`Current step is ${run.current_step_id}; refusing to operate on ${stepId}. Pass --force to override.`);
  }
}

export function assertRerunTarget({ runtime, currentStepId, targetStepId }) {
  const sequence = runtime.flow.variants?.[runtime.run.flow_variant]?.sequence ?? [];
  const currentIndex = sequence.indexOf(currentStepId);
  const targetIndex = sequence.indexOf(targetStepId);
  if (targetIndex < 0) {
    throw new Error(`Unknown rerun target for ${runtime.run.flow_variant}: ${targetStepId}`);
  }
  if (currentIndex < 0) {
    throw new Error(`Current step ${currentStepId} is not part of ${runtime.run.flow_variant}`);
  }
  if (targetIndex >= currentIndex) {
    throw new Error(`Rerun target must be earlier than ${currentStepId}; got ${targetStepId}`);
  }
}

export function isHumanGateStep(step) {
  if (step.provider === "runtime" && step.mode === "human" && Boolean(step.human_gate)) {
    return true;
  }
  if (step.assistEscalation) {
    return true;
  }
  return false;
}

export function formatStepName(step) {
  return step.label ? `${step.id} ${step.label}` : step.id;
}

const CLI = "node src/cli/index.mjs";

export function humanDecisionCommands(repo, stepId) {
  const repoArg = ` --repo ${shellQuote(repo)}`;
  return [
    `${CLI} approve${repoArg} --step ${stepId} --reason ok`,
    `${CLI} request-changes${repoArg} --step ${stepId} --reason "<reason>"`,
    `${CLI} reject${repoArg} --step ${stepId} --reason "<reason>"`
  ];
}

export function humanStopCommands(repo, stepId) {
  return [showGateCommand(repo, stepId), assistOpenCommand(repo, stepId), ...humanDecisionCommands(repo, stepId)];
}

export function recommendationCommands(repo, stepId) {
  const repoArg = ` --repo ${shellQuote(repo)}`;
  return [
    `${CLI} accept-recommendation${repoArg} --step ${stepId}`,
    `${CLI} decline-recommendation${repoArg} --step ${stepId} --reason "<reason>"`
  ];
}

export function recommendedStopCommands(repo, stepId) {
  return [showGateCommand(repo, stepId), assistOpenCommand(repo, stepId), ...recommendationCommands(repo, stepId)];
}

export function runNextCommand(repo) {
  return `${CLI} run-next --repo ${shellQuote(repo)}`;
}

export function rerunCurrentStepCommand(repo) {
  return `${CLI} run-next --repo ${shellQuote(repo)} --force`;
}

export function statusCommand(repo) {
  return `${CLI} status --repo ${shellQuote(repo)}`;
}

export function assistOpenCommand(repo, stepId) {
  return `${CLI} assist-open --repo ${shellQuote(repo)} --step ${stepId}`;
}

export function applyAssistSignalCommand(repo, stepId) {
  return `${CLI} apply-assist-signal --repo ${shellQuote(repo)} --step ${stepId}`;
}

export function resumeCommand(repo) {
  return `${CLI} resume --repo ${shellQuote(repo)}`;
}

export function showGateCommand(repo, stepId) {
  return `${CLI} show-gate --repo ${shellQuote(repo)} --step ${stepId}`;
}

export function interruptAnswerCommands(repo, stepId) {
  return [
    `${CLI} show-interrupts --repo ${shellQuote(repo)} --step ${stepId}`,
    `${CLI} answer --repo ${shellQuote(repo)} --step ${stepId} --message "<answer>"`
  ];
}

export function interruptStopCommands(repo, stepId) {
  return [
    `${CLI} show-interrupts --repo ${shellQuote(repo)} --step ${stepId}`,
    assistOpenCommand(repo, stepId),
    `${CLI} answer --repo ${shellQuote(repo)} --step ${stepId} --message "<answer>"`
  ];
}

export function blockedStopCommands(repo, stepId) {
  return [
    assistOpenCommand(repo, stepId),
    runNextCommand(repo)
  ];
}

export function nextProviderCommand(repo) {
  return `${CLI} run-provider --repo ${shellQuote(repo)}`;
}

export function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function firstLine(text) {
  return String(text ?? "").trim().split(/\r?\n/)[0] || "(empty)";
}
