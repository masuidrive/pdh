import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const DEFAULT_KIND_BY_STEP = {
  "PD-C-4": "plan_review",
  "PD-C-7": "quality_review",
  "PD-C-9": "final_verification"
};

const DEFAULT_ACCEPTED_STATUS_BY_KIND = {
  plan_review: "No Critical/Major",
  quality_review: "No Critical/Major",
  final_verification: "Ready"
};

export function defaultJudgementKind(stepId) {
  return DEFAULT_KIND_BY_STEP[stepId] ?? null;
}

export function defaultAcceptedJudgementStatus(kind) {
  return DEFAULT_ACCEPTED_STATUS_BY_KIND[kind] ?? "No Critical/Major";
}

export function writeJudgement({ stateDir, runId, stepId, kind = null, status = null, summary = null, source = "runtime", details = {} }) {
  const resolvedKind = kind ?? defaultJudgementKind(stepId);
  if (!resolvedKind) {
    throw new Error(`No default judgement kind for ${stepId}; pass --kind`);
  }
  const resolvedStatus = status ?? defaultAcceptedJudgementStatus(resolvedKind);
  const artifactDir = join(stateDir, "runs", runId, "steps", stepId, "judgements");
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, `${resolvedKind}.json`);
  const body = {
    kind: resolvedKind,
    status: resolvedStatus,
    summary: summary ?? "",
    source,
    stepId,
    runId,
    createdAt: new Date().toISOString(),
    details
  };
  writeFileSync(artifactPath, JSON.stringify(body, null, 2));
  return { artifactPath, judgement: body };
}

export function loadJudgements({ stateDir, runId, stepId }) {
  const artifactDir = join(stateDir, "runs", runId, "steps", stepId, "judgements");
  if (!existsSync(artifactDir)) {
    return [];
  }
  const judgements = [];
  for (const entry of readdirSync(artifactDir)) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const path = join(artifactDir, entry);
    try {
      const judgement = JSON.parse(readFileSync(path, "utf8"));
      judgements.push({ ...judgement, artifactPath: path });
    } catch (error) {
      judgements.push({
        kind: basename(entry, ".json"),
        status: "invalid",
        summary: error.message,
        artifactPath: path
      });
    }
  }
  return judgements;
}
