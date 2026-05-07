import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultJudgementKind } from "../guards/judgement-artifact.ts";
import type { AnyRecord } from "../../types.ts";

export function stepUiContract(step) {
  const ui = step.ui ?? {};
  return {
    viewer: asString(ui.viewer),
    decision: asString(ui.decision),
    mustShow: asStringList(ui.mustShow),
    omit: asStringList(ui.omit),
    skipDefaultSchema: ui.skipDefaultSchema === true
  };
}

export function uiOutputArtifactPath({ stateDir, runId, stepId }) {
  return join(stateDir, "runs", runId, "steps", stepId, "ui-output.json");
}

export function loadStepUiOutput({ stateDir, runId, stepId }) {
  return loadJsonArtifact({
    path: uiOutputArtifactPath({ stateDir, runId, stepId }),
    normalizer: normalizeUiOutput
  });
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
  // Prefer step.yaml's judgement.kind over the legacy DEFAULT_KIND_BY_STEP
  // map. The map only carries PD-C-4 / PD-C-7 / PD-C-9, so without this
  // fallback PD-D-* steps (and any future step using only step yaml's
  // `judgement.kind`) never get the judgement field in the auto-injected
  // template — agents then forget to emit it and the run sits blocked at
  // `judgement_status` guard.
  const judgementKind = (step?.judgement?.kind ? String(step.judgement.kind).trim() : "")
    || defaultJudgementKind(step.id);
  const acceptedStatuses: string[] = Array.isArray(step?.judgement?.acceptedStatuses)
    ? step.judgement.acceptedStatuses.map((s) => String(s).trim()).filter(Boolean)
    : [];

  const header = [
    "## UI 出力成果物",
    "",
    `\`${relativePath}\` に妥当な JSON を書く。`,
    "markdown fence は使わない。トップレベルキーを勝手に増やさない。",
    ...(judgementKind
      ? [
          "",
          `**重要**: このステップは \`judgement\` ブロック必須。\`kind: ${judgementKind}\` で 1 件、欠落・kind ミスマッチ・status 空のいずれかで runtime guard が step を blocked にする。`,
          "summary / risks / notes だけ書いて judgement を書き忘れる事故が頻発しているので、JSON を書き始める前に必ず judgement の枠を作っておくこと。"
        ]
      : []),
    "",
    "このステップ固有の契約:",
    `- viewer: ${contract.viewer || "(未指定)"}`,
    `- decision: ${contract.decision || "(未指定)"}`,
    ...(contract.mustShow.length > 0
      ? ["- must_show:", ...contract.mustShow.map((item) => `  - ${item}`)]
      : ["- must_show: (なし)"]),
    ...(contract.omit.length > 0
      ? ["- omit:", ...contract.omit.map((item) => `  - ${item}`)]
      : ["- omit: (なし)"]),
    ""
  ];

  if (contract.skipDefaultSchema) {
    return [...header, "JSON スキーマ・各フィールドのルールはステップ本文 `## 成果物` を正本として参照してください。", ""];
  }

  const statusHint = acceptedStatuses.length > 0
    ? `runtime guard が pass と認める status は ${acceptedStatuses.map((s) => `\`${s}\``).join(" / ")} のいずれか (条件未達ならこれ以外の status を書く)`
    : "guard 向けの正確な status を書く";

  const templateObject: AnyRecord = {
    summary: [
      "このステップで何を変えたか、何が分かったかを示す具体的な箇条書き 2-4 件"
    ],
    risks: [
      "未解消のリスクだけを書く。無ければ [] を使う。"
    ],
    // Embed an actual newline in the example string so JSON.stringify
    // emits `\n` (one-char escape) in the rendered template, modelling
    // the correct way for agents to write multi-line notes. Earlier
    // iterations had the literal text "\\n を使う" here; agents copied
    // that literally and produced double-escaped sources whose parsed
    // value contained the characters `\n` instead of an actual newline.
    notes: "1 行目: 任意の自由記述。\n2 行目: 改行は JSON の \\n 1 文字エスケープ (上のテンプレートで実際に動く形)。"
  };
  if (judgementKind) {
    templateObject.judgement = {
      kind: judgementKind,
      status: acceptedStatuses[0] ? `${acceptedStatuses[0]} (条件未達なら別 status)` : "guard 向けの正確な status",
      summary: "その judgement の短い理由"
    };
  }
  const template = JSON.stringify(templateObject, null, 2);

  return [
    ...header,
    "各フィールドのルール:",
    "- `summary`: このステップで何を変えたか、何が分かったかを示す具体的な箇条書きを 2-4 件書く。",
    "- `risks`: 未解消のリスクだけを書く。無ければ `[]` を使う。",
    "- `notes`: 任意の自由記述。複数行にしたい場合は JSON の 1 文字 newline エスケープを使う (= JSON ソース上は backslash 1 つ + `n` の 2 文字)。**`\\n` のような 2 文字 backslash で書かない** — それは parse 後に literal `\\n` になって markdown 上に `\\n-` のような文字列が露出する。下のテンプレートの `notes` の値はこの正しい形のリテラル例なので、そこの 1 文字 newline 表記をそのままコピーすればよい。",
    "- このファイル内の人間向け文面は、`current-ticket.md` の主言語に合わせる。",
    "- すべてのキーと文字列はダブルクォートで囲む。テキスト中に **literal な** ダブルクォートを置きたいときは `\\\"`、literal な backslash は `\\\\`。逆にいえば newline / tab 等の **JSON 標準エスケープを使うとき** はそのまま 1 文字 backslash + 文字 (`\\n`, `\\t`) を書く — 二重に backslash しない。",
    ...(judgementKind
      ? [
          `- \`judgement\`: 必須。\`kind: ${judgementKind}\` 固定、${statusHint}、短い \`summary\` を必ず書く。`,
          `- \`judgement\` を書き忘れた / kind を変えた / status を空にした場合 runtime guard が step を blocked にする。下のテンプレートの judgement ブロックは省略しない。`
        ]
      : []),
    "",
    "JSON 形は次を使う:",
    "",
    template,
    ""
  ];
}

export function normalizeUiOutput(value, meta = {}) {
  const source: any = value ?? {};
  const metadata: any = meta ?? {};
  return {
    summary: asStringList(source.summary),
    // risks is the structured form { description, severity, defer_to_step }
    // (see flows/shared/common_c.j2 + commit 8cc03bd). Pass through verbatim
    // — the frontend normalizes any leftover string-shape via normalizeRisks.
    risks: Array.isArray(source.risks) ? source.risks : [],
    readyWhen: asStringList(source.ready_when ?? source.readyWhen),
    notes: asString(source.notes),
    judgement: source.judgement
      ? {
          kind: asString(source.judgement.kind),
          status: asString(source.judgement.status),
          summary: asString(source.judgement.summary)
        }
      : null,
    // PD-C-1 intent-gate fields. All optional; pass through verbatim so
    // the frontend can render them when present without forcing every
    // step type to populate them. Schema documented in PD-C-1.j2.
    interpretation: source.interpretation && typeof source.interpretation === "object" ? source.interpretation : null,
    unknowns: Array.isArray(source.unknowns) ? source.unknowns : [],
    contextGaps: Array.isArray(source.context_gaps ?? source.contextGaps) ? (source.context_gaps ?? source.contextGaps) : [],
    alignment: source.alignment && typeof source.alignment === "object" ? source.alignment : null,
    teamRecommendation: source.team_recommendation ?? source.teamRecommendation ?? null,
    // PD-C-3 plan fields. Carried over to PD-C-6 via auto-embed.
    plan_tasks: Array.isArray(source.plan_tasks ?? source.planTasks) ? (source.plan_tasks ?? source.planTasks) : [],
    per_file_context: Array.isArray(source.per_file_context ?? source.perFileContext) ? (source.per_file_context ?? source.perFileContext) : [],
    artifactPath: asString(metadata.artifactPath),
    parseErrors: asStringList(metadata.parseErrors),
    parseWarnings: asStringList(metadata.parseWarnings),
    rawText: asString(metadata.rawText)
  };
}

export function loadJsonArtifact({ path, normalizer }) {
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

export function asString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

export function asStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(asString).filter(Boolean);
}

export function asRecordList(value, normalizer) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizer(item ?? {}));
}
