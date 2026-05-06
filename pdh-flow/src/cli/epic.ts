// Epic close / cancel lifecycle.
//
// Implements `pdh-flow finalize-epic --epic <slug>` and `pdh-flow
// cancel-epic --epic <slug> --reason TEXT`. The runtime is the
// canonical commit owner for Epic close (PD-D-4 gate); these
// commands also exist as standalone CLI for retry / manual use.
//
// Close (epic-branch case):
//   1. On epic/<slug>: update frontmatter (closed_at), git mv to
//      epics/done/<slug>/index.md, optimise screenshots in
//      epics/done/<slug>/screenshots/, commit `[PD-D-4] Close epic`
//   2. Switch to main (must be clean), `git merge --squash epic/<slug>`,
//      commit `Close epic <slug>`, push origin main
//   3. Delete local + remote epic/<slug> branch
//
// Close (main-direct case): edit frontmatter on main, mv, screenshot
// optimise, commit, push. No branch operations.
//
// Cancel (epic-branch case): transplant — read the file content from
// epic/<slug>, write it to epics/done/<slug>/index.md on main with
// `cancelled_at` + `cancel_reason` frontmatter, copy any
// epics/done/<slug>/* artefacts (verification.md, screenshots) over,
// commit, push, delete branch. Implementation commits never reach
// main.
//
// Cancel (main-direct case): edit frontmatter on main, mv, commit,
// push.
//
// Preflight (`--dry-run`): repo clean? branch exists (when needed)?
// no open linked tickets (`epic: <slug>` in tickets/<id>.md, not in
// tickets/done/)? merge dry-run for close. Output describes the
// planned actions and exits without side effects.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { optimizeScreenshotsInDir } from "../runtime/screenshot.ts";

type EpicSource = {
  slug: string;
  branch: string;            // "main" or "epic/<slug>"
  meta: Record<string, unknown>;
  body: string;
  origin: "main" | "branch"; // where the file was found
  pathOnMain: string;        // join(repo, "epics", `${slug}.md`)
};

type LifecycleOptions = {
  repo: string;
  slug: string;
  mode: "close" | "cancel";
  reason?: string;
  dryRun: boolean;
  noPush: boolean;
  noDeleteRemote: boolean;
  force: boolean;
};

export async function cmdFinalizeEpic(argv: string[]) {
  const options = parseArgv(argv);
  await runEpicLifecycle({
    repo: resolve(options.repo ?? process.cwd()),
    slug: requireOption(options, "epic"),
    mode: "close",
    reason: undefined,
    dryRun: options["dry-run"] === "true",
    noPush: options["no-push"] === "true",
    noDeleteRemote: options["no-delete-remote"] === "true",
    force: options["force"] === "true"
  });
}

export async function cmdCancelEpic(argv: string[]) {
  const options = parseArgv(argv);
  await runEpicLifecycle({
    repo: resolve(options.repo ?? process.cwd()),
    slug: requireOption(options, "epic"),
    mode: "cancel",
    reason: requireOption(options, "reason"),
    dryRun: options["dry-run"] === "true",
    noPush: options["no-push"] === "true",
    noDeleteRemote: options["no-delete-remote"] === "true",
    force: options["force"] === "true"
  });
}

async function runEpicLifecycle(opts: LifecycleOptions) {
  const epic = resolveEpic(opts.repo, opts.slug);
  const branchKind: "main" | "epic" = epic.branch === "main" ? "main" : "epic";

  const preflight = collectPreflight(opts.repo, epic, opts.mode);
  printPreflight(epic, opts, preflight);
  if (!opts.force) {
    const blockers = preflight.blockers;
    if (blockers.length > 0) {
      throw new Error(
        `Preflight failed for epic ${epic.slug}:\n  - ${blockers.join("\n  - ")}\n` +
        `Resolve the blockers above, or pass --force to override at your own risk.`
      );
    }
  }
  if (opts.dryRun) {
    console.log("--dry-run: no changes were made.");
    return;
  }

  if (opts.mode === "close") {
    if (branchKind === "epic") {
      await executeCloseEpicBranch(opts, epic);
    } else {
      await executeCloseMainDirect(opts, epic);
    }
  } else {
    if (branchKind === "epic") {
      await executeCancelEpicBranch(opts, epic);
    } else {
      await executeCancelMainDirect(opts, epic);
    }
  }
}

// ---------------- resolveEpic ----------------

function resolveEpic(repo: string, slug: string): EpicSource {
  const slugClean = slug.trim().replace(/\.md$/u, "");
  const mainPath = join(repo, "epics", `${slugClean}.md`);
  if (existsSync(mainPath)) {
    const text = readFileSync(mainPath, "utf8");
    const { meta, body } = splitFrontmatter(text);
    const branch = stringField(meta.branch) || "main";
    return { slug: slugClean, branch, meta, body, origin: "main", pathOnMain: mainPath };
  }
  // Fallback: epic/<slug> branch
  const branchName = `epic/${slugClean}`;
  if (!gitBranchExists(repo, branchName)) {
    throw new Error(
      `Epic ${slugClean} not found: epics/${slugClean}.md is missing on main and ${branchName} branch does not exist.`
    );
  }
  const showResult = runGit(repo, ["show", `${branchName}:epics/${slugClean}.md`]);
  if (showResult.status !== 0) {
    throw new Error(
      `Epic ${slugClean}: ${branchName} exists but epics/${slugClean}.md is missing on it. ` +
      `git show stderr: ${showResult.stderr.trim()}`
    );
  }
  const { meta, body } = splitFrontmatter(showResult.stdout);
  const branch = stringField(meta.branch) || branchName;
  return { slug: slugClean, branch, meta, body, origin: "branch", pathOnMain: mainPath };
}

// ---------------- preflight ----------------

type Preflight = {
  blockers: string[];
  notes: string[];
  openTickets: string[];
};

function collectPreflight(repo: string, epic: EpicSource, mode: "close" | "cancel"): Preflight {
  const blockers: string[] = [];
  const notes: string[] = [];

  // Already closed / cancelled?
  if (mode === "close" && epic.meta.closed_at) {
    blockers.push(`Epic frontmatter already has closed_at=${String(epic.meta.closed_at)}; epic appears to be already closed.`);
  }
  if (mode === "cancel" && epic.meta.cancelled_at) {
    blockers.push(`Epic frontmatter already has cancelled_at=${String(epic.meta.cancelled_at)}; epic appears to be already cancelled.`);
  }

  // Repo cleanliness on main (we'll be writing there)
  const mainStatus = runGit(repo, ["status", "--short"]);
  if (mainStatus.stdout.trim().length > 0) {
    blockers.push(
      `Working tree is dirty:\n${mainStatus.stdout.trim().split("\n").map((l) => "    " + l).join("\n")}\n` +
      `  Commit, stash, or discard the changes before retrying.`
    );
  }

  // Branch existence (epic-branch case)
  const onEpicBranch = epic.branch !== "main";
  if (onEpicBranch && !gitBranchExists(repo, epic.branch)) {
    blockers.push(`Epic frontmatter says branch=${epic.branch} but that branch does not exist locally.`);
  }

  // Open linked tickets (active = exists in tickets/, not in tickets/done/)
  const openTickets: string[] = [];
  for (const ticketRef of findOpenLinkedTickets(repo, epic.slug, onEpicBranch ? epic.branch : null)) {
    openTickets.push(ticketRef);
  }
  if (openTickets.length > 0) {
    blockers.push(
      `Epic still has ${openTickets.length} open ticket(s) linked to it:\n` +
      openTickets.map((t) => "    " + t).join("\n") + "\n" +
      `  Close or cancel them via ticket.sh (or pass --force to ignore).`
    );
  }

  // Merge dry-run for close
  if (mode === "close" && onEpicBranch) {
    const mergeCheck = simulateMerge(repo, epic.branch);
    if (mergeCheck.conflict) {
      blockers.push(
        `Merging ${epic.branch} into main would conflict:\n${mergeCheck.detail.split("\n").map((l) => "    " + l).join("\n")}`
      );
    }
  }

  if (epic.origin === "main") {
    notes.push(`Epic file resolved on main (${epic.pathOnMain}).`);
  } else {
    notes.push(`Epic file resolved via git show ${epic.branch}:epics/${epic.slug}.md`);
  }

  return { blockers, notes, openTickets };
}

function printPreflight(epic: EpicSource, opts: LifecycleOptions, pre: Preflight) {
  console.log(`Epic: ${epic.slug}`);
  console.log(`Branch policy: ${epic.branch}`);
  console.log(`Mode: ${opts.mode}${opts.reason ? ` (reason: ${opts.reason})` : ""}`);
  console.log(`Push: ${opts.noPush ? "skip" : "push to origin"}`);
  console.log(`Remote branch delete: ${opts.noDeleteRemote ? "skip" : "delete after merge"}`);
  for (const note of pre.notes) console.log(`note: ${note}`);
  if (pre.blockers.length === 0) {
    console.log("Preflight: OK");
  } else {
    console.log("Preflight: BLOCKED");
    for (const b of pre.blockers) console.log(`  ✗ ${b}`);
  }
}

// ---------------- close: epic-branch ----------------

async function executeCloseEpicBranch(opts: LifecycleOptions, epic: EpicSource) {
  const stamp = new Date().toISOString();
  const closedMeta = { ...epic.meta, closed_at: stamp };

  // 1. Switch to epic branch (clean check already done in preflight)
  runGitOrThrow(opts.repo, ["switch", epic.branch], `switch to ${epic.branch}`);

  // 2. Update epic file on epic branch (move to epics/done/<slug>/index.md)
  const newRel = join("epics", "done", epic.slug, "index.md");
  const oldRel = join("epics", `${epic.slug}.md`);
  const newAbs = join(opts.repo, newRel);
  const oldAbs = join(opts.repo, oldRel);
  mkdirSync(dirname(newAbs), { recursive: true });
  const newText = serializeFrontmatter(closedMeta, epic.body);
  // Use git mv when possible (preserves rename history). Falls back to
  // plain write+remove when git mv fails (e.g. file already moved).
  if (existsSync(oldAbs)) {
    runGitOrThrow(opts.repo, ["mv", oldRel, newRel], `git mv ${oldRel} → ${newRel}`);
    writeFileSync(newAbs, newText);
  } else if (existsSync(newAbs)) {
    writeFileSync(newAbs, newText);
  } else {
    writeFileSync(newAbs, newText);
  }

  // 3. Optimise screenshots
  const shotsDir = join(opts.repo, "epics", "done", epic.slug, "screenshots");
  await tryOptimiseScreenshots(opts.repo, shotsDir);

  // 4. Commit on epic branch
  runGitOrThrow(opts.repo, ["add", "-A", "epics/"], "stage epic close changes");
  runGitOrThrow(opts.repo, ["commit", "-m", `[PD-D-4] Close epic ${epic.slug}`], "commit epic close");

  // 5. Switch to main, merge --squash + commit
  runGitOrThrow(opts.repo, ["switch", "main"], "switch to main");
  runGitOrThrow(opts.repo, ["merge", "--squash", epic.branch], `squash merge ${epic.branch}`);
  runGitOrThrow(opts.repo, ["commit", "-m", `Close epic ${epic.slug}`], "commit squash merge");

  // 6. Push main
  if (!opts.noPush) {
    runGit(opts.repo, ["push", "origin", "main"]);
  }

  // 7. Delete local epic branch. We use -D (force) because squash merge
  // doesn't mark the branch as "merged" in git's graph sense, even
  // though the work is now on main.
  runGit(opts.repo, ["branch", "-D", epic.branch]);

  // 8. Delete remote epic branch
  if (!opts.noPush && !opts.noDeleteRemote) {
    runGit(opts.repo, ["push", "origin", "--delete", epic.branch]);
  }

  console.log(`Epic ${epic.slug} closed. main now contains the squash merge; ${epic.branch} branch deleted.`);
}

// ---------------- close: main-direct ----------------

async function executeCloseMainDirect(opts: LifecycleOptions, epic: EpicSource) {
  const stamp = new Date().toISOString();
  const closedMeta = { ...epic.meta, closed_at: stamp };
  const oldRel = join("epics", `${epic.slug}.md`);
  const newRel = join("epics", "done", epic.slug, "index.md");
  const oldAbs = join(opts.repo, oldRel);
  const newAbs = join(opts.repo, newRel);

  runGitOrThrow(opts.repo, ["switch", "main"], "switch to main");
  mkdirSync(dirname(newAbs), { recursive: true });
  if (existsSync(oldAbs)) {
    runGitOrThrow(opts.repo, ["mv", oldRel, newRel], `git mv ${oldRel} → ${newRel}`);
  }
  writeFileSync(newAbs, serializeFrontmatter(closedMeta, epic.body));

  const shotsDir = join(opts.repo, "epics", "done", epic.slug, "screenshots");
  await tryOptimiseScreenshots(opts.repo, shotsDir);

  runGitOrThrow(opts.repo, ["add", "-A", "epics/"], "stage epic close changes");
  runGitOrThrow(opts.repo, ["commit", "-m", `Close epic ${epic.slug}`], "commit epic close");

  if (!opts.noPush) {
    runGit(opts.repo, ["push", "origin", "main"]);
  }
  console.log(`Epic ${epic.slug} closed (main-direct, no branch operations).`);
}

// ---------------- cancel: epic-branch ----------------

async function executeCancelEpicBranch(opts: LifecycleOptions, epic: EpicSource) {
  const stamp = new Date().toISOString();
  const cancelledMeta = {
    ...epic.meta,
    cancelled_at: stamp,
    cancel_reason: opts.reason ?? ""
  };
  const newRel = join("epics", "done", epic.slug, "index.md");
  const newAbs = join(opts.repo, newRel);

  runGitOrThrow(opts.repo, ["switch", "main"], "switch to main");
  mkdirSync(dirname(newAbs), { recursive: true });
  writeFileSync(newAbs, serializeFrontmatter(cancelledMeta, epic.body));

  // Best-effort: copy any epics/done/<slug>/* artefacts from epic branch
  // (verification.md, screenshots/, etc.) over to main.
  transplantArtefacts(opts.repo, epic.branch, epic.slug);

  // Optimise screenshots that landed on main
  const shotsDir = join(opts.repo, "epics", "done", epic.slug, "screenshots");
  await tryOptimiseScreenshots(opts.repo, shotsDir);

  runGitOrThrow(opts.repo, ["add", "-A", "epics/"], "stage epic cancel changes");
  runGitOrThrow(
    opts.repo,
    ["commit", "-m", `Cancel epic ${epic.slug}: ${opts.reason ?? "(no reason given)"}`],
    "commit epic cancel"
  );

  if (!opts.noPush) {
    runGit(opts.repo, ["push", "origin", "main"]);
  }
  // Force-delete local branch since implementation commits are intentionally not merged
  runGit(opts.repo, ["branch", "-D", epic.branch]);
  if (!opts.noPush && !opts.noDeleteRemote) {
    runGit(opts.repo, ["push", "origin", "--delete", epic.branch]);
  }
  console.log(`Epic ${epic.slug} cancelled. Implementation commits on ${epic.branch} were NOT merged into main.`);
}

// ---------------- cancel: main-direct ----------------

async function executeCancelMainDirect(opts: LifecycleOptions, epic: EpicSource) {
  const stamp = new Date().toISOString();
  const cancelledMeta = {
    ...epic.meta,
    cancelled_at: stamp,
    cancel_reason: opts.reason ?? ""
  };
  const oldRel = join("epics", `${epic.slug}.md`);
  const newRel = join("epics", "done", epic.slug, "index.md");
  const oldAbs = join(opts.repo, oldRel);
  const newAbs = join(opts.repo, newRel);

  runGitOrThrow(opts.repo, ["switch", "main"], "switch to main");
  mkdirSync(dirname(newAbs), { recursive: true });
  if (existsSync(oldAbs)) {
    runGitOrThrow(opts.repo, ["mv", oldRel, newRel], `git mv ${oldRel} → ${newRel}`);
  }
  writeFileSync(newAbs, serializeFrontmatter(cancelledMeta, epic.body));

  runGitOrThrow(opts.repo, ["add", "-A", "epics/"], "stage epic cancel changes");
  runGitOrThrow(
    opts.repo,
    ["commit", "-m", `Cancel epic ${epic.slug}: ${opts.reason ?? "(no reason given)"}`],
    "commit epic cancel"
  );
  if (!opts.noPush) {
    runGit(opts.repo, ["push", "origin", "main"]);
  }
  console.log(`Epic ${epic.slug} cancelled (main-direct).`);
}

// ---------------- helpers ----------------

function transplantArtefacts(repo: string, branch: string, slug: string) {
  const ls = runGit(repo, ["ls-tree", "-r", "--name-only", branch, "--", `epics/done/${slug}/`]);
  if (ls.status !== 0 || !ls.stdout.trim()) return;
  for (const file of ls.stdout.trim().split(/\r?\n/)) {
    if (!file) continue;
    if (file === `epics/done/${slug}/index.md`) continue; // we wrote our own version
    const show = spawnSync("git", ["show", `${branch}:${file}`], { cwd: repo, encoding: "buffer" });
    if (show.status !== 0) continue;
    const target = join(repo, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, show.stdout);
  }
}

async function tryOptimiseScreenshots(repo: string, shotsDir: string) {
  if (!existsSync(shotsDir)) return;
  try {
    const result = await optimizeScreenshotsInDir(shotsDir, {
      logger: (msg) => console.log(msg)
    });
    if (result.failed.length > 0) {
      for (const fail of result.failed) {
        console.warn(`screenshot optimisation failed for ${fail.path}: ${fail.reason}`);
      }
    }
  } catch (err) {
    console.warn(`screenshot optimisation skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function findOpenLinkedTickets(repo: string, epicSlug: string, epicBranch: string | null): string[] {
  const open: string[] = [];
  // Scan main's tickets/ working tree
  const mainTicketsDir = join(repo, "tickets");
  if (existsSync(mainTicketsDir)) {
    for (const entry of readdirSync(mainTicketsDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md")) continue;
      if (entry.name === "README.md") continue;
      if (entry.name.endsWith("-note.md")) continue;
      const text = readFileSync(join(mainTicketsDir, entry.name), "utf8");
      const { meta } = splitFrontmatter(text);
      const epic = stringField(meta.epic);
      if (epic && epic.replace(/\.md$/u, "") === epicSlug) {
        open.push(`tickets/${entry.name} (on main)`);
      }
    }
  }
  // Scan epic branch (if applicable) — there may be tickets there that
  // never made it to main.
  if (epicBranch) {
    const ls = runGit(repo, ["ls-tree", "-r", "--name-only", epicBranch, "--", "tickets/"]);
    if (ls.status === 0) {
      for (const path of ls.stdout.trim().split(/\r?\n/)) {
        if (!path) continue;
        if (!path.endsWith(".md")) continue;
        if (path === "tickets/README.md") continue;
        if (path.endsWith("-note.md")) continue;
        if (path.startsWith("tickets/done/")) continue;
        const show = runGit(repo, ["show", `${epicBranch}:${path}`]);
        if (show.status !== 0) continue;
        const { meta } = splitFrontmatter(show.stdout);
        const epic = stringField(meta.epic);
        if (epic && epic.replace(/\.md$/u, "") === epicSlug) {
          open.push(`${path} (on ${epicBranch})`);
        }
      }
    }
  }
  return open;
}

function simulateMerge(repo: string, branch: string): { conflict: boolean; detail: string } {
  // Use a try-then-abort approach: `git merge --no-commit --no-ff <branch>`
  // followed by `git merge --abort`. This is on the working tree, so we
  // assume the caller has confirmed the tree is clean.
  const before = runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (before.status !== 0) return { conflict: false, detail: "" };
  // Make sure we're on main first
  if (before.stdout.trim() !== "main") {
    const sw = runGit(repo, ["switch", "main"]);
    if (sw.status !== 0) {
      return { conflict: true, detail: `Could not switch to main for merge dry-run: ${sw.stderr.trim()}` };
    }
  }
  const merge = runGit(repo, ["merge", "--no-commit", "--no-ff", branch]);
  // Abort regardless — we don't want to leave the merge in progress
  const abort = runGit(repo, ["merge", "--abort"]);
  void abort;
  return {
    conflict: merge.status !== 0,
    detail: merge.status !== 0 ? merge.stdout.trim() + "\n" + merge.stderr.trim() : ""
  };
}

// ---------------- frontmatter ----------------

function splitFrontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(text);
  if (!match) return { meta: {}, body: text };
  let meta: Record<string, unknown> = {};
  try {
    meta = (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
  } catch {
    meta = {};
  }
  return { meta, body: text.slice(match[0].length) };
}

function serializeFrontmatter(meta: Record<string, unknown>, body: string): string {
  const yamlText = stringifyYaml(meta).trimEnd();
  return `---\n${yamlText}\n---\n${body}`;
}

function stringField(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ---------------- argv parsing ----------------

function parseArgv(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[key] = "true";
      } else {
        out[key] = next;
        i += 1;
      }
    }
  }
  return out;
}

function requireOption(opts: Record<string, string>, key: string): string {
  const v = opts[key];
  if (!v || v === "true") {
    throw new Error(`Missing required option: --${key}`);
  }
  return v;
}

// ---------------- git wrappers ----------------

function runGit(repo: string, args: string[]) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1
  };
}

function runGitOrThrow(repo: string, args: string[], description: string) {
  const result = runGit(repo, args);
  if (result.status !== 0) {
    throw new Error(
      `git failed (${description}): ${result.stderr.trim() || result.stdout.trim()}`
    );
  }
  return result;
}

function gitBranchExists(repo: string, branch: string): boolean {
  const r = runGit(repo, ["rev-parse", "--verify", `refs/heads/${branch}`]);
  return r.status === 0;
}
