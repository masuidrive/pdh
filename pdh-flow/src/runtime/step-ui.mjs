import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { defaultJudgementKind, loadJudgements } from "./judgements.mjs";
import { loadStepInterruptions } from "./interruptions.mjs";
import { extractSection } from "../core/note-state.mjs";
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
  return join(stateDir, "runs", runId, "steps", stepId, "ui-output.json");
}

export function uiRuntimeArtifactPath({ stateDir, runId, stepId }) {
  return join(stateDir, "runs", runId, "steps", stepId, "ui-runtime.json");
}

export function loadStepUiOutput({ stateDir, runId, stepId }) {
  return loadJsonArtifact({
    path: uiOutputArtifactPath({ stateDir, runId, stepId }),
    normalizer: normalizeUiOutput
  });
}

export function loadStepUiRuntime({ stateDir, runId, stepId }) {
  return loadJsonArtifact({
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
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
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
  const relativePath = `.pdh-flow/runs/${run.id}/steps/${step.id}/ui-output.json`;
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
    notes: "Optional free text. Multi-line strings should use \\n inside the JSON string."
  };
  if (judgementKind) {
    templateObject.judgement = {
      kind: judgementKind,
      status: "Exact guard-facing status for this review step",
      summary: "Short rationale for that judgement"
    };
  }
  const template = JSON.stringify(templateObject, null, 2);

  return [
    "## UI Output Artifact",
    "",
    `Write valid JSON to \`${relativePath}\`.`,
    "Do not use markdown fences. Do not add extra top-level keys.",
    "",
    "Field rules:",
    "- `summary`: 2-4 concrete bullets about what changed or what was found in this step.",
    "- `risks`: unresolved risks only. Use `[]` when there are none.",
    "- `ready_when`: concrete conditions that mean this step is ready to advance.",
    "- `notes`: optional free text. Multi-line content uses `\\n` inside the JSON string.",
    "- Match the primary language used in `current-ticket.md` for all human-readable text in this file.",
    "- All keys and strings must be double-quoted. Escape inner double quotes with `\\\"`. Escape backslashes with `\\\\`.",
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
    "Use this JSON shape:",
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
  const uiOutput = loadStepUiOutput({ stateDir: runtime.stateDir, runId, stepId });
  const highlights = deriveStepUiHighlights({ runtime, stepId, uiOutput });
  const diffNameOnly = runGit(repoPath, ["diff", "--name-only"]);
  const diffStat = runGit(repoPath, ["diff", "--stat"]);
  return normalizeUiRuntime({
    generated_at: new Date().toISOString(),
    run_status: runtime.run.status,
    changed_files: aliasCurrentDocPaths(repoPath, splitLines(diffNameOnly.stdout)),
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
          final_message: attempt.finalMessage ?? null,
          stderr: attempt.stderr ?? null,
          raw_log_path: attempt.rawLogPath ?? null
        }
      : null,
    gate: humanGate
      ? {
          status: humanGate.status ?? null,
          decision: humanGate.decision ?? null,
          summary: humanGate.summary ?? null,
          baseline: humanGate.baseline ?? null,
          rerun_requirement: humanGate.rerun_requirement ?? null
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
    highlights,
    next_commands: asStringList(nextCommands)
  });
}

function loadJsonArtifact({ path, normalizer }) {
  if (!existsSync(path)) {
    return null;
  }
  const rawText = readFileSync(path, "utf8");
  let raw = {};
  const parseErrors = [];
  try {
    raw = JSON.parse(rawText) ?? {};
  } catch (error) {
    parseErrors.push(error?.message || String(error));
  }
  return normalizer(raw, {
    artifactPath: path,
    rawText,
    parseErrors,
    parseWarnings: []
  });
}

function normalizeUiOutput(value, meta = {}) {
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
      : null,
    artifactPath: asString(meta.artifactPath),
    parseErrors: asStringList(meta.parseErrors),
    parseWarnings: asStringList(meta.parseWarnings),
    rawText: asString(meta.rawText)
  };
}

function normalizeUiRuntime(value, meta = {}) {
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
          finalMessage: asString(source.latest_attempt.final_message),
          stderr: asString(source.latest_attempt.stderr),
          rawLogPath: asString(source.latest_attempt.raw_log_path)
        }
      : null,
    gate: source.gate
      ? {
          status: asString(source.gate.status),
          decision: asString(source.gate.decision),
          baseline: source.gate.baseline
            ? {
                commit: asString(source.gate.baseline.commit),
                stepId: asString(source.gate.baseline.step_id ?? source.gate.baseline.stepId),
                ref: asString(source.gate.baseline.ref),
                capturedAt: asString(source.gate.baseline.captured_at ?? source.gate.baseline.capturedAt)
              }
            : null,
          rerunRequirement: source.gate.rerun_requirement
            ? {
                targetStepId: asString(source.gate.rerun_requirement.target_step_id ?? source.gate.rerun_requirement.targetStepId),
                reason: asString(source.gate.rerun_requirement.reason),
                changedFiles: asStringList(source.gate.rerun_requirement.changed_files ?? source.gate.rerun_requirement.changedFiles),
                changedTicketSections: asStringList(source.gate.rerun_requirement.changed_ticket_sections ?? source.gate.rerun_requirement.changedTicketSections),
                changedNoteSections: asStringList(source.gate.rerun_requirement.changed_note_sections ?? source.gate.rerun_requirement.changedNoteSections)
              }
            : null
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
    highlights: source.highlights
      ? {
          summary: asStringList(source.highlights.summary),
          risks: asStringList(source.highlights.risks),
          notes: asString(source.highlights.notes)
        }
      : {
          summary: [],
          risks: [],
          notes: ""
        },
    nextCommands: asStringList(source.next_commands ?? source.nextCommands),
    artifactPath: asString(meta.artifactPath),
    parseErrors: asStringList(meta.parseErrors),
    parseWarnings: asStringList(meta.parseWarnings),
    rawText: asString(meta.rawText)
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

function aliasCurrentDocPaths(repoPath, paths) {
  const aliases = new Map();
  for (const alias of ["current-note.md", "current-ticket.md"]) {
    try {
      const target = readlinkSync(join(repoPath, alias));
      aliases.set(relative(repoPath, resolve(repoPath, target)).replaceAll("\\", "/"), alias);
    } catch {}
  }
  return paths.map((path) => aliases.get(path) ?? path);
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

function deriveStepUiHighlights({ runtime, stepId, uiOutput }) {
  const noteBody = runtime.note?.body ?? "";
  const ownSummary = asStringList(uiOutput?.summary);
  const ownRisks = asStringList(uiOutput?.risks);
  const ownNotes = asString(uiOutput?.notes);
  return {
    summary: ownSummary.length ? ownSummary : fallbackSummaryLines({ runtime, noteBody, stepId }),
    risks: ownRisks.length ? ownRisks : fallbackRiskLines({ runtime, noteBody, stepId }),
    notes: ownNotes
  };
}

function fallbackSummaryLines({ runtime, noteBody, stepId }) {
  switch (stepId) {
    case "PD-C-4":
      return bulletsFromText(stepNoteSection(noteBody, "PD-C-3"), 4);
    case "PD-C-5":
      return [
        ...bulletsFromText(stepNoteSection(noteBody, "PD-C-3"), 3),
        ...bulletsFromText(preferredText(stepNoteSection(noteBody, "PD-C-4"), stepJudgementText(runtime, "PD-C-4")), 1)
      ].slice(0, 4);
    case "PD-C-6":
      return bulletsFromText(preferredText(stepNoteSection(noteBody, "PD-C-6"), stepNoteSection(noteBody, "PD-C-3")), 4);
    case "PD-C-7":
      return bulletsFromText(preferredText(stepNoteSection(noteBody, "PD-C-7"), stepNoteSection(noteBody, "PD-C-6")), 4);
    case "PD-C-8":
    case "PD-C-9":
      return bulletsFromText(preferredText(stepNoteSection(noteBody, stepId), acTableText(noteBody)), 4);
    case "PD-C-10":
      return bulletsFromText(preferredText(acTableText(noteBody), stepNoteSection(noteBody, "PD-C-9")), 4);
    default:
      return bulletsFromText(stepNoteSection(noteBody, stepId), 4);
  }
}

function fallbackRiskLines({ runtime, noteBody, stepId }) {
  switch (stepId) {
    case "PD-C-3":
    case "PD-C-4":
    case "PD-C-5":
      return bulletsFromText(preferredText(stepNoteSection(noteBody, "PD-C-2"), stepNoteSection(noteBody, "PD-C-4")), 3);
    case "PD-C-6":
      return bulletsFromText(preferredText(stepNoteSection(noteBody, "PD-C-6"), stepNoteSection(noteBody, "PD-C-2")), 3);
    case "PD-C-7":
    case "PD-C-8":
    case "PD-C-10":
      return bulletsFromText(preferredText(stepNoteSection(noteBody, stepId), stepJudgementText(runtime, stepId), stepNoteSection(noteBody, "PD-C-7")), 3);
    default:
      return [];
  }
}

function stepNoteSection(noteBody, stepId) {
  const headingByStep = {
    "PD-C-2": "PD-C-2. 調査結果",
    "PD-C-3": "PD-C-3. 計画",
    "PD-C-4": "PD-C-4. 計画レビュー結果",
    "PD-C-6": "PD-C-6",
    "PD-C-7": "PD-C-7. 品質検証結果",
    "PD-C-8": "PD-C-8. 目的妥当性確認",
    "PD-C-9": "PD-C-9. プロセスチェックリスト",
    "PD-C-10": "PD-C-10"
  };
  const heading = headingByStep[stepId];
  return heading ? extractSection(noteBody, heading) ?? "" : "";
}

function acTableText(noteBody) {
  return extractSection(noteBody, "AC 裏取り結果") ?? "";
}

function stepJudgementText(runtime, stepId) {
  if (!runtime.run?.id) {
    return "";
  }
  return loadJudgements({ stateDir: runtime.stateDir, runId: runtime.run.id, stepId })
    .map((item) => [asString(item.status), asString(item.summary)].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("\n");
}

function preferredText(...items) {
  return items.map((item) => String(item ?? "").trim()).find(Boolean) ?? "";
}

function bulletsFromText(text, limit) {
  const value = String(text ?? "").trim();
  if (!value) {
    return [];
  }
  const bulletLines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
  if (bulletLines.length) {
    return bulletLines.slice(0, limit);
  }
  return value
    .split(/\r?\n{2,}/)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, limit);
}
