import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse, stringify } from "yaml";
import { defaultJudgementKind, loadJudgements } from "./judgements.mjs";
import { loadStepInterruptions } from "./interruptions.mjs";
import { collectStepArtifacts, latestAttemptResult } from "./runtime-state.mjs";

export function stepUiContract(step) {
  const ui = step.ui ?? {};
  return {
    viewer: asString(ui.viewer),
    decision: asString(ui.decision),
    mustShow: asStringList(ui.mustShow),
    omit: asStringList(ui.omit)
  };
}

export function uiOutputArtifactPath({ stateDir, runId, stepId }) {
  return join(stateDir, "runs", runId, "steps", stepId, "ui-output.yaml");
}

export function uiRuntimeArtifactPath({ stateDir, runId, stepId }) {
  return join(stateDir, "runs", runId, "steps", stepId, "ui-runtime.yaml");
}

export function loadStepUiOutput({ stateDir, runId, stepId }) {
  return loadYamlArtifact({
    path: uiOutputArtifactPath({ stateDir, runId, stepId }),
    normalizer: normalizeUiOutput
  });
}

export function loadStepUiRuntime({ stateDir, runId, stepId }) {
  return loadYamlArtifact({
    path: uiRuntimeArtifactPath({ stateDir, runId, stepId }),
    normalizer: normalizeUiRuntime
  });
}

export function writeStepUiRuntime({ repoPath, runtime, step, guardResults = null, nextCommands = [] }) {
  const path = uiRuntimeArtifactPath({
    stateDir: runtime.stateDir,
    runId: runtime.run.id,
    stepId: step.id
  });
  mkdirSync(join(path, ".."), { recursive: true });
  const data = buildRuntimeUiData({ repoPath, runtime, step, guardResults, nextCommands });
  writeFileSync(path, `${stringify(data).trimEnd()}\n`);
  return { artifactPath: path, data };
}

export function judgementFromUiOutput(stepId, uiOutput) {
  const kind = asString(uiOutput?.judgement?.kind) || defaultJudgementKind(stepId);
  const status = asString(uiOutput?.judgement?.status);
  if (!kind || !status) {
    return null;
  }
  return {
    kind,
    status,
    summary: asString(uiOutput?.judgement?.summary)
  };
}

export function renderUiOutputPromptSection({ run, step }) {
  const relativePath = `.pdh-flowchart/runs/${run.id}/steps/${step.id}/ui-output.yaml`;
  const contract = stepUiContract(step);
  const judgementKind = defaultJudgementKind(step.id);
  const templateObject = {
    summary: [
      "2-4 concrete bullets about what changed or what was found in this step"
    ],
    risks: [
      "Unresolved risks only. Use [] when there are none."
    ],
    ready_when: [
      "Concrete conditions that mean this step is ready to advance"
    ],
    notes: "Optional free text. Use a block scalar when needed."
  };
  if (judgementKind) {
    templateObject.judgement = {
      kind: judgementKind,
      status: "Exact guard-facing status for this review step",
      summary: "Short rationale for that judgement"
    };
  }
  const template = stringify(templateObject).trimEnd();

  return [
    "## UI Output Artifact",
    "",
    `Write plain YAML to \`${relativePath}\`.`,
    "Do not use markdown fences. Do not add extra top-level keys.",
    "",
    "Field rules:",
    "- `summary`: 2-4 concrete bullets about what changed or what was found in this step.",
    "- `risks`: unresolved risks only. Use `[]` when there are none.",
    "- `ready_when`: concrete conditions that mean this step is ready to advance.",
    "- `notes`: optional free text. Use a block scalar when it helps.",
    "- Match the primary language used in `current-ticket.md` for all human-readable text in this file.",
    ...(judgementKind
      ? [`- \`judgement\`: required for this review step. Use \`kind: ${judgementKind}\`, the exact guard-facing \`status\`, and a short \`summary\`.`]
      : []),
    "",
    "Step-specific contract:",
    `- viewer: ${contract.viewer || "(unspecified)"}`,
    `- decision: ${contract.decision || "(unspecified)"}`,
    ...(contract.mustShow.length > 0
      ? ["- must_show:", ...contract.mustShow.map((item) => `  - ${item}`)]
      : ["- must_show: (none)"]),
    ...(contract.omit.length > 0
      ? ["- omit:", ...contract.omit.map((item) => `  - ${item}`)]
      : ["- omit: (none)"]),
    "",
    "Use this YAML shape:",
    "",
    template,
    ""
  ];
}

function buildRuntimeUiData({ repoPath, runtime, step, guardResults = null, nextCommands = [] }) {
  const runId = runtime.run.id;
  const stepId = step.id;
  const attempt = latestAttemptResult({
    stateDir: runtime.stateDir,
    runId,
    stepId,
    provider: step.provider === "runtime" ? null : step.provider
  });
  const humanGate = runtime.run.id
    ? safeHumanGate(runtime, stepId)
    : null;
  const interruptions = runtime.run.id
    ? loadStepInterruptions({ stateDir: runtime.stateDir, runId, stepId })
    : [];
  const judgements = runtime.run.id
    ? loadJudgements({ stateDir: runtime.stateDir, runId, stepId }).map((item) => ({
        kind: asString(item.kind),
        status: asString(item.status),
        artifact: asString(item.artifactPath)
      }))
    : [];
  const artifacts = collectStepArtifacts({ stateDir: runtime.stateDir, runId, stepId }).map((artifact) => ({
    name: artifact.name,
    path: artifact.path
  }));
  const diffNameOnly = runGit(repoPath, ["diff", "--name-only"]);
  const diffStat = runGit(repoPath, ["diff", "--stat"]);
  return normalizeUiRuntime({
    generated_at: new Date().toISOString(),
    run_status: runtime.run.status,
    changed_files: splitLines(diffNameOnly.stdout),
    diff_stat: splitLines(diffStat.stdout),
    guards: Array.isArray(guardResults)
      ? guardResults.map((result) => ({
          id: asString(result.guardId),
          status: asString(result.status),
          evidence: asString(result.evidence)
        }))
      : [],
    latest_attempt: attempt
      ? {
          attempt: attempt.attempt ?? null,
          status: attempt.status ?? null,
          provider: attempt.provider ?? null,
          exit_code: attempt.exitCode ?? null,
          raw_log_path: attempt.rawLogPath ?? null
        }
      : null,
    gate: humanGate
      ? {
          status: humanGate.status ?? null,
          decision: humanGate.decision ?? null,
          summary: humanGate.summary ?? null
        }
      : null,
    interruptions: interruptions
      .filter((item) => item.status !== "answered")
      .map((item) => ({
        id: asString(item.id),
        kind: asString(item.kind),
        message: asString(item.message),
        artifact: asString(item.artifactPath)
      })),
    judgements,
    artifacts,
    next_commands: asStringList(nextCommands)
  });
}

function loadYamlArtifact({ path, normalizer }) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = parse(readFileSync(path, "utf8")) ?? {};
    return normalizer(raw);
  } catch {
    return null;
  }
}

function normalizeUiOutput(value) {
  const source = value ?? {};
  return {
    summary: asStringList(source.summary),
    risks: asStringList(source.risks),
    readyWhen: asStringList(source.ready_when ?? source.readyWhen),
    notes: asString(source.notes),
    judgement: source.judgement
      ? {
          kind: asString(source.judgement.kind),
          status: asString(source.judgement.status),
          summary: asString(source.judgement.summary)
        }
      : null
  };
}

function normalizeUiRuntime(value) {
  const source = value ?? {};
  return {
    generatedAt: asString(source.generated_at ?? source.generatedAt),
    runStatus: asString(source.run_status ?? source.runStatus),
    changedFiles: asStringList(source.changed_files ?? source.changedFiles),
    diffStat: asStringList(source.diff_stat ?? source.diffStat),
    guards: asRecordList(source.guards, (guard) => ({
      id: asString(guard.id),
      status: asString(guard.status),
      evidence: asString(guard.evidence)
    })),
    latestAttempt: source.latest_attempt
      ? {
          attempt: source.latest_attempt.attempt ?? null,
          status: asString(source.latest_attempt.status),
          provider: asString(source.latest_attempt.provider),
          exitCode: source.latest_attempt.exit_code ?? null,
          rawLogPath: asString(source.latest_attempt.raw_log_path)
        }
      : null,
    gate: source.gate
      ? {
          status: asString(source.gate.status),
          decision: asString(source.gate.decision),
          summary: asString(source.gate.summary)
        }
      : null,
    interruptions: asRecordList(source.interruptions, (item) => ({
      id: asString(item.id),
      kind: asString(item.kind),
      message: asString(item.message),
      artifact: asString(item.artifact)
    })),
    judgements: asRecordList(source.judgements, (item) => ({
      kind: asString(item.kind),
      status: asString(item.status),
      artifact: asString(item.artifact)
    })),
    artifacts: asRecordList(source.artifacts, (item) => ({
      name: asString(item.name),
      path: asString(item.path)
    })),
    nextCommands: asStringList(source.next_commands ?? source.nextCommands)
  };
}

function asString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function asStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(asString).filter(Boolean);
}

function asRecordList(value, normalizer) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizer(item ?? {}));
}

function splitLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function runGit(repoPath, args) {
  const result = spawnSync("git", args, { cwd: repoPath, text: true, encoding: "utf8" });
  if (result.status !== 0) {
    return { stdout: "", stderr: result.stderr ?? "" };
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function safeHumanGate(runtime, stepId) {
  try {
    const path = join(runtime.stateDir, "runs", runtime.run.id, "steps", stepId, "human-gate.json");
    if (!existsSync(path)) {
      return null;
    }
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
