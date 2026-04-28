import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export function stepCommitArtifactPath({ stateDir, runId, stepId }) {
  return join(stateDir, "runs", runId, "steps", stepId, "step-commit.json");
}

export function loadStepCommitRecord({ stateDir, runId, stepId }) {
  const path = stepCommitArtifactPath({ stateDir, runId, stepId });
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function clearStepCommitRecord({ stateDir, runId, stepId }) {
  rmSync(stepCommitArtifactPath({ stateDir, runId, stepId }), { force: true });
}

export function writeStepCommitRecord({ repoPath, stateDir, runId, stepId, beforeCommit = null }) {
  const afterCommit = gitScalar(repoPath, ["rev-parse", "HEAD"]);
  if (!afterCommit || afterCommit === beforeCommit) {
    clearStepCommitRecord({ stateDir, runId, stepId });
    return null;
  }
  const artifactPath = stepCommitArtifactPath({ stateDir, runId, stepId });
  mkdirSync(join(stateDir, "runs", runId, "steps", stepId), { recursive: true });
  const record = {
    step_id: stepId,
    commit: afterCommit,
    short_commit: afterCommit.slice(0, 7),
    subject: gitScalar(repoPath, ["log", "-1", "--format=%s", afterCommit]) ?? "",
    before_commit: beforeCommit ?? null,
    recorded_at: new Date().toISOString(),
    artifactPath
  };
  writeFileSync(artifactPath, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function gitScalar(repoPath, args) {
  const result = spawnSync("git", args, { cwd: repoPath, text: true, encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}
