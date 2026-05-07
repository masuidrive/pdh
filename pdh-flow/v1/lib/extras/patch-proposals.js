import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
const TRACKED_FILES = ["current-note.md", "current-ticket.md"];
export function snapshotNoteTicketFiles({ repoPath }) {
    return Object.fromEntries(TRACKED_FILES.map((path) => [path, readRepoFile(repoPath, path)]));
}
export function captureNoteTicketPatchProposal({ repoPath, stateDir, runId, stepId, attempt = 1, before = null }) {
    if (before) {
        return captureSnapshotDiff({ repoPath, stateDir, runId, stepId, attempt, before });
    }
    const result = spawnSync("git", ["diff", "--", "current-note.md", "current-ticket.md"], {
        cwd: repoPath,
        encoding: "utf8"
    });
    if (result.status !== 0) {
        throw new Error((result.stderr || result.stdout || "git diff failed").trim());
    }
    if (!result.stdout.trim()) {
        return { status: "empty" };
    }
    const artifactDir = join(stateDir, "runs", runId, "steps", stepId, `attempt-${attempt}`);
    mkdirSync(artifactDir, { recursive: true });
    const artifactPath = join(artifactDir, "note-ticket.patch");
    writeFileSync(artifactPath, result.stdout);
    return { status: "written", artifactPath };
}
function captureSnapshotDiff({ repoPath, stateDir, runId, stepId, attempt, before }) {
    const artifactDir = join(stateDir, "runs", runId, "steps", stepId, `attempt-${attempt}`);
    let patch = "";
    for (const path of TRACKED_FILES) {
        const after = readRepoFile(repoPath, path);
        if ((before[path] ?? "") === after) {
            continue;
        }
        const tempDir = mkdtempSync(join(tmpdir(), "pdh-flow-diff-"));
        try {
            const beforePath = join(tempDir, "before");
            const afterPath = join(tempDir, "after");
            writeFileSync(beforePath, before[path] ?? "");
            writeFileSync(afterPath, after);
            const result = spawnSync("diff", ["-u", "--label", `a/${path}`, "--label", `b/${path}`, beforePath, afterPath], {
                encoding: "utf8"
            });
            if (![0, 1].includes(result.status)) {
                throw new Error((result.stderr || result.stdout || "diff failed").trim());
            }
            patch += result.stdout;
        }
        finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    }
    if (!patch.trim()) {
        return { status: "empty" };
    }
    mkdirSync(artifactDir, { recursive: true });
    const artifactPath = join(artifactDir, "note-ticket.patch");
    writeFileSync(artifactPath, patch);
    return { status: "written", artifactPath };
}
function readRepoFile(repoPath, path) {
    const fullPath = join(repoPath, path);
    return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
}
