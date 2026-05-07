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
import { optimizeScreenshotsInDir } from "../runtime/screenshot.js";
import { startRun, loadRuntime } from "../runtime/state.js";
import { loadFlow, getInitialStep, getStep } from "../flow/load.js";
import { assertStepInVariant } from "./utils.js";
// pdh-flow start-epic --epic <slug> [--variant full|light] [--repo DIR]
//
// Initiates a runtime-managed Epic close cycle (flow=pdh-epic-core).
// Resolves the epic file, switches the working tree to the epic's
// branch when the epic frontmatter says `branch: epic/<slug>`, and
// records a fresh run in .pdh-flow/runtime.json. The first
// `pdh-flow run-next` after this then drives PD-D-1 → … → PD-D-4.
//
// Limitations (intentional, can lift later):
//   - One active run per repo: aborts if a ticket / epic run is
//     already in progress (use --force-reset to overwrite).
//   - The "ticket_id" field in pdh-meta is set to `epic-<slug>` so
//     the existing ticket-shaped runtime UI/code keeps working; this
//     value is opaque to the close machinery.
//   - The epic branch must exist locally (we don't auto-create it).
export async function cmdStartEpic(argv) {
    const options = parseArgv(argv);
    const repo = resolve(options.repo ?? process.cwd());
    const slug = requireOption(options, "epic").trim().replace(/\.md$/u, "");
    const variant = options.variant ?? "full";
    const flowId = "pdh-epic-core";
    const flow = loadFlow(flowId);
    const startStep = options["start-step"] ?? getInitialStep(flow, variant);
    assertStepInVariant(flow, variant, startStep);
    const epic = resolveEpic(repo, slug);
    // Refuse to start if a run already exists, mirroring cmdRun.
    const runtimeBefore = loadRuntime(repo, { normalizeStaleRunning: true });
    if (runtimeBefore.run?.id && options["force-reset"] !== "true") {
        const activeTicket = runtimeBefore.run.ticket_id || "<unknown>";
        const activeStep = runtimeBefore.run.current_step_id || "<unknown>";
        const activeStatus = runtimeBefore.run.status || "<unknown>";
        throw new Error(`Active run already exists (ticket=${activeTicket}, step=${activeStep}, status=${activeStatus}). ` +
            `Stop or complete it before starting an epic run, or pass --force-reset.`);
    }
    // For epic-branch case, switch to the epic branch so the runtime
    // operates on the right working tree. Caller is expected to have
    // committed any pending changes (the runtime preflight rejects a
    // dirty tree later anyway).
    if (epic.branch !== "main") {
        const status = runGit(repo, ["status", "--short"]);
        if (status.stdout.trim().length > 0) {
            throw new Error(`Working tree is dirty; cannot switch to ${epic.branch}.\n${status.stdout.trim()}`);
        }
        if (!gitBranchExists(repo, epic.branch)) {
            throw new Error(`Epic frontmatter says branch=${epic.branch} but that branch does not exist locally.`);
        }
        runGitOrThrow(repo, ["switch", epic.branch], `switch to ${epic.branch}`);
    }
    const ticketLabel = `epic-${slug}`;
    const started = startRun({
        repoPath: repo,
        ticket: ticketLabel,
        variant,
        flowId,
        startStep
    });
    writeEpicCurrentTicket({ repo, slug, epic });
    console.log(started.run.id);
    console.log(`Epic: ${slug} (branch: ${epic.branch})`);
    const stepObj = getStep(started.flow, started.run.current_step_id);
    console.log(`Current step: ${stepObj.id}${stepObj.label ? ` — ${stepObj.label}` : ""}`);
    console.log(`Next: pdh-flow run-next --repo ${repo}`);
}
// startRun creates a placeholder current-ticket.md (Why/What/Product AC TODO).
// For Epic close runs the durable subject is the Epic file itself, so we
// overwrite the placeholder with a pointer + the Epic body so PD-D-1〜4
// agents see Outcome / Exit Criteria without having to grep first.
function writeEpicCurrentTicket(args) {
    const { repo, slug, epic } = args;
    const path = join(repo, "current-ticket.md");
    const title = stringField(epic.meta.title) || slug;
    const branch = epic.branch;
    const sourcePath = epic.origin === "main" ? `epics/${slug}.md` : `${branch}:epics/${slug}.md`;
    const lines = [
        `# Epic: ${title}`,
        "",
        `この run は Epic close cycle (PD-D-1〜4) です。**durable subject は Epic ファイル本体** (\`epics/${slug}.md\`) です。`,
        "",
        `- slug: \`${slug}\``,
        `- branch: \`${branch}\``,
        `- file: \`${sourcePath}\``,
        "",
        "## Epic 本文 (参照用スナップショット)",
        "",
        epic.body.trimEnd(),
        "",
        "## 補足",
        "",
        "- Outcome / Scope / Non-goals / Exit Criteria は上の Epic 本文を読む。`current-ticket.md` ではなく `epics/<slug>.md` を最新参照する。",
        "- 配下 ticket 一覧は `tickets/<id>.md` の frontmatter `epic: <slug>` で grep する。"
    ];
    writeFileSync(path, lines.join("\n") + "\n");
}
export async function cmdFinalizeEpic(argv) {
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
export async function cmdCancelEpic(argv) {
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
async function runEpicLifecycle(opts) {
    const epic = resolveEpic(opts.repo, opts.slug);
    const branchKind = epic.branch === "main" ? "main" : "epic";
    const preflight = collectPreflight(opts.repo, epic, opts.mode);
    printPreflight(epic, opts, preflight);
    if (!opts.force) {
        const blockers = preflight.blockers;
        if (blockers.length > 0) {
            throw new Error(`Preflight failed for epic ${epic.slug}:\n  - ${blockers.join("\n  - ")}\n` +
                `Resolve the blockers above, or pass --force to override at your own risk.`);
        }
    }
    if (opts.dryRun) {
        console.log("--dry-run: no changes were made.");
        return;
    }
    if (opts.mode === "close") {
        if (branchKind === "epic") {
            await executeCloseEpicBranch(opts, epic);
        }
        else {
            await executeCloseMainDirect(opts, epic);
        }
    }
    else {
        if (branchKind === "epic") {
            await executeCancelEpicBranch(opts, epic);
        }
        else {
            await executeCancelMainDirect(opts, epic);
        }
    }
}
// ---------------- resolveEpic ----------------
function resolveEpic(repo, slug) {
    const slugClean = slug.trim().replace(/\.md$/u, "");
    const mainPath = join(repo, "epics", `${slugClean}.md`);
    // 1. Main branch (via git show, not working tree — the working tree
    // may be checked out to an epic branch and not reflect main's state).
    const onMain = runGit(repo, ["show", `main:epics/${slugClean}.md`]);
    if (onMain.status === 0) {
        const { meta, body } = splitFrontmatter(onMain.stdout);
        const branch = stringField(meta.branch) || "main";
        return { slug: slugClean, branch, meta, body, origin: "main", pathOnMain: mainPath };
    }
    // 2. Scan all epic/* branches for `epics/<slug>.md`. The branch name
    // doesn't have to match the slug (e.g. file
    // 260506-025311-calc-web.md may live on epic/calc-web branch); the
    // canonical link is the file slug, not the branch name.
    const branches = listEpicBranches(repo);
    for (const branchName of branches) {
        const showResult = runGit(repo, ["show", `${branchName}:epics/${slugClean}.md`]);
        if (showResult.status === 0) {
            const { meta, body } = splitFrontmatter(showResult.stdout);
            const branch = stringField(meta.branch) || branchName;
            return { slug: slugClean, branch, meta, body, origin: "branch", pathOnMain: mainPath };
        }
    }
    throw new Error(`Epic ${slugClean} not found: epics/${slugClean}.md is missing on main and on every epic/* branch. ` +
        `Looked at: main, ${branches.length ? branches.join(", ") : "(no epic/* branches)"}.`);
}
function listEpicBranches(repo) {
    const r = runGit(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads/epic/*"]);
    if (r.status !== 0)
        return [];
    return String(r.stdout || "").split(/\r?\n/).filter(Boolean);
}
function collectPreflight(repo, epic, mode) {
    const blockers = [];
    const notes = [];
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
        blockers.push(`Working tree is dirty:\n${mainStatus.stdout.trim().split("\n").map((l) => "    " + l).join("\n")}\n` +
            `  Commit, stash, or discard the changes before retrying.`);
    }
    // Branch existence (epic-branch case)
    const onEpicBranch = epic.branch !== "main";
    if (onEpicBranch && !gitBranchExists(repo, epic.branch)) {
        blockers.push(`Epic frontmatter says branch=${epic.branch} but that branch does not exist locally.`);
    }
    // Open linked tickets (active = exists in tickets/, not in tickets/done/)
    const openTickets = [];
    for (const ticketRef of findOpenLinkedTickets(repo, epic.slug, onEpicBranch ? epic.branch : null)) {
        openTickets.push(ticketRef);
    }
    if (openTickets.length > 0) {
        blockers.push(`Epic still has ${openTickets.length} open ticket(s) linked to it:\n` +
            openTickets.map((t) => "    " + t).join("\n") + "\n" +
            `  Close or cancel them via ticket.sh (or pass --force to ignore).`);
    }
    // Merge dry-run for close
    if (mode === "close" && onEpicBranch) {
        const mergeCheck = simulateMerge(repo, epic.branch);
        if (mergeCheck.conflict) {
            blockers.push(`Merging ${epic.branch} into main would conflict:\n${mergeCheck.detail.split("\n").map((l) => "    " + l).join("\n")}`);
        }
    }
    if (epic.origin === "main") {
        notes.push(`Epic file resolved on main (${epic.pathOnMain}).`);
    }
    else {
        notes.push(`Epic file resolved via git show ${epic.branch}:epics/${epic.slug}.md`);
    }
    return { blockers, notes, openTickets };
}
function printPreflight(epic, opts, pre) {
    console.log(`Epic: ${epic.slug}`);
    console.log(`Branch policy: ${epic.branch}`);
    console.log(`Mode: ${opts.mode}${opts.reason ? ` (reason: ${opts.reason})` : ""}`);
    console.log(`Push: ${opts.noPush ? "skip" : "push to origin"}`);
    console.log(`Remote branch delete: ${opts.noDeleteRemote ? "skip" : "delete after merge"}`);
    for (const note of pre.notes)
        console.log(`note: ${note}`);
    if (pre.blockers.length === 0) {
        console.log("Preflight: OK");
    }
    else {
        console.log("Preflight: BLOCKED");
        for (const b of pre.blockers)
            console.log(`  ✗ ${b}`);
    }
}
// ---------------- close: epic-branch ----------------
async function executeCloseEpicBranch(opts, epic) {
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
    }
    else if (existsSync(newAbs)) {
        writeFileSync(newAbs, newText);
    }
    else {
        writeFileSync(newAbs, newText);
    }
    // 3. Optimise any pre-existing screenshots that landed in the durable
    // tree. PD-D-3 itself saves to the gitignored transient run dir
    // (`.pdh-flow/runs/<run-id>/steps/PD-D-3/screenshots/`), so this dir
    // is normally empty. Kept for legacy epics whose verification.md was
    // staged with screenshots before the transient-only convention.
    const shotsDir = join(opts.repo, "epics", "done", epic.slug, "screenshots");
    await tryOptimiseScreenshots(opts.repo, shotsDir);
    // 4. Commit on epic branch
    runGitOrThrow(opts.repo, ["add", "-A", "epics/"], "stage epic close changes");
    runGitOrThrow(opts.repo, ["commit", "-m", `[PD-D-4] Close epic ${epic.slug}`], "commit epic close");
    // 5. Switch to main, merge --squash + commit. `-X theirs` resolves
    // content-modify conflicts in favor of the epic branch (authoritative
    // source for the close). Structural conflicts (modify/delete,
    // rename/delete) aren't auto-resolved by `-X theirs`, so we run a
    // post-merge pass that takes the epic branch's version for any
    // remaining unmerged path. The dry-run preflight runs the same merge
    // and reports residual conflicts as informational, but does not run
    // the resolution pass.
    runGitOrThrow(opts.repo, ["switch", "main"], "switch to main");
    runGit(opts.repo, ["merge", "--squash", "-X", "theirs", epic.branch]);
    resolveEpicMergeConflicts(opts.repo, epic.branch);
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
async function executeCloseMainDirect(opts, epic) {
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
    // PD-D-3 screenshots are transient (see PD-D-3.j2). The durable dir
    // is normally empty; this is here for legacy/manual screenshots.
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
async function executeCancelEpicBranch(opts, epic) {
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
    // Optimise screenshots that landed on main via transplant (legacy).
    // New runs keep PD-D-3 screenshots transient under .pdh-flow/.
    const shotsDir = join(opts.repo, "epics", "done", epic.slug, "screenshots");
    await tryOptimiseScreenshots(opts.repo, shotsDir);
    runGitOrThrow(opts.repo, ["add", "-A", "epics/"], "stage epic cancel changes");
    runGitOrThrow(opts.repo, ["commit", "-m", `Cancel epic ${epic.slug}: ${opts.reason ?? "(no reason given)"}`], "commit epic cancel");
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
async function executeCancelMainDirect(opts, epic) {
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
    runGitOrThrow(opts.repo, ["commit", "-m", `Cancel epic ${epic.slug}: ${opts.reason ?? "(no reason given)"}`], "commit epic cancel");
    if (!opts.noPush) {
        runGit(opts.repo, ["push", "origin", "main"]);
    }
    console.log(`Epic ${epic.slug} cancelled (main-direct).`);
}
// ---------------- helpers ----------------
function transplantArtefacts(repo, branch, slug) {
    const ls = runGit(repo, ["ls-tree", "-r", "--name-only", branch, "--", `epics/done/${slug}/`]);
    if (ls.status !== 0 || !ls.stdout.trim())
        return;
    for (const file of ls.stdout.trim().split(/\r?\n/)) {
        if (!file)
            continue;
        if (file === `epics/done/${slug}/index.md`)
            continue; // we wrote our own version
        const show = spawnSync("git", ["show", `${branch}:${file}`], { cwd: repo, encoding: "buffer" });
        if (show.status !== 0)
            continue;
        const target = join(repo, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, show.stdout);
    }
}
async function tryOptimiseScreenshots(repo, shotsDir) {
    if (!existsSync(shotsDir))
        return;
    try {
        const result = await optimizeScreenshotsInDir(shotsDir, {
            logger: (msg) => console.log(msg)
        });
        if (result.failed.length > 0) {
            for (const fail of result.failed) {
                console.warn(`screenshot optimisation failed for ${fail.path}: ${fail.reason}`);
            }
        }
    }
    catch (err) {
        console.warn(`screenshot optimisation skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
}
function findOpenLinkedTickets(repo, epicSlug, epicBranch) {
    const open = [];
    // Scan main's tickets/ working tree
    const mainTicketsDir = join(repo, "tickets");
    if (existsSync(mainTicketsDir)) {
        for (const entry of readdirSync(mainTicketsDir, { withFileTypes: true })) {
            if (!entry.isFile())
                continue;
            if (!entry.name.endsWith(".md"))
                continue;
            if (entry.name === "README.md")
                continue;
            if (entry.name.endsWith("-note.md"))
                continue;
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
                if (!path)
                    continue;
                if (!path.endsWith(".md"))
                    continue;
                if (path === "tickets/README.md")
                    continue;
                if (path.endsWith("-note.md"))
                    continue;
                if (path.startsWith("tickets/done/"))
                    continue;
                const show = runGit(repo, ["show", `${epicBranch}:${path}`]);
                if (show.status !== 0)
                    continue;
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
// Resolves any unmerged paths after `git merge --squash -X theirs <branch>`
// by taking the epic branch's version: if the file exists on the epic
// branch we check it out and stage it; if not (file was deleted on epic
// branch but kept on main) we `git rm` it. This handles modify/delete and
// rename/delete which `-X theirs` does not auto-resolve.
function resolveEpicMergeConflicts(repo, epicBranch) {
    const status = runGit(repo, ["diff", "--name-only", "--diff-filter=U"]);
    if (status.status !== 0)
        return;
    const paths = status.stdout
        .split(/\r?\n/u)
        .map((p) => p.trim())
        .filter(Boolean);
    if (paths.length === 0)
        return;
    for (const path of paths) {
        const onEpic = runGit(repo, ["cat-file", "-e", `${epicBranch}:${path}`]);
        if (onEpic.status === 0) {
            // File exists on epic branch — take its version.
            runGitOrThrow(repo, ["checkout", "--theirs", "--", path], `take theirs for ${path}`);
            runGitOrThrow(repo, ["add", path], `stage resolved ${path}`);
        }
        else {
            // File deleted on epic branch — remove from main.
            runGitOrThrow(repo, ["rm", "-f", path], `remove ${path} (not on ${epicBranch})`);
        }
    }
}
function simulateMerge(repo, branch) {
    // Mirror the real close: `git merge --squash -X theirs <branch>`. The
    // epic branch is the authoritative source for the close; main may have
    // diverged (e.g. epic file deleted on main when relocated to the epic
    // branch) and we want the epic branch's state to win, not flag a
    // modify/delete conflict.
    //
    // We snapshot the original ref AND main's sha before the dry-run, so
    // we can `git reset --hard` main back to its pre-dry-run state and
    // restore the user's branch checkout. `git merge --squash` stages
    // changes into the index without entering a merge state, so a hard
    // reset is sufficient (no `merge --abort` needed).
    const headRef = runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (headRef.status !== 0)
        return { conflict: false, detail: "" };
    const originalRef = headRef.stdout.trim();
    const mainShaBefore = runGit(repo, ["rev-parse", "main"]);
    if (mainShaBefore.status !== 0) {
        return { conflict: true, detail: `Could not resolve main sha: ${mainShaBefore.stderr.trim()}` };
    }
    const mainSha = mainShaBefore.stdout.trim();
    const switched = originalRef !== "main";
    if (switched) {
        const sw = runGit(repo, ["switch", "main"]);
        if (sw.status !== 0) {
            return { conflict: true, detail: `Could not switch to main for merge dry-run: ${sw.stderr.trim()}` };
        }
    }
    const merge = runGit(repo, ["merge", "--squash", "-X", "theirs", branch]);
    // After merge --squash, attempt the same modify/delete + rename/delete
    // resolution that the real close does. If everything resolves, the
    // dry-run is clean. We swallow errors from the resolver because
    // dry-run shouldn't throw on resolution attempts.
    try {
        resolveEpicMergeConflicts(repo, branch);
    }
    catch {
        // ignore — the residualConflict check below catches actual leftovers
    }
    const residual = runGit(repo, ["diff", "--name-only", "--diff-filter=U"]);
    const residualConflict = residual.status === 0 && residual.stdout.trim().length > 0;
    const conflict = residualConflict;
    let detail = "";
    if (conflict) {
        const stderr = `${merge.stdout.trim()}\n${merge.stderr.trim()}`.trim();
        detail = `Unresolvable paths after auto-resolve:\n  ${residual.stdout.trim().split(/\r?\n/u).join("\n  ")}\n\n--- raw merge output ---\n${stderr}`;
    }
    else if (merge.status !== 0) {
        detail = `Merge had conflicts but auto-resolve handled them: ${merge.stdout.trim().split(/\r?\n/u).slice(0, 3).join(" / ")}`;
    }
    // Reset main back to its original sha to undo any staged squash changes.
    runGit(repo, ["reset", "--hard", mainSha]);
    if (switched) {
        const back = runGit(repo, ["switch", originalRef]);
        if (back.status !== 0) {
            return { conflict, detail: `${detail}\n(warning: failed to switch back to ${originalRef}: ${back.stderr.trim()})`.trim() };
        }
    }
    return { conflict, detail };
}
// ---------------- frontmatter ----------------
function splitFrontmatter(text) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(text);
    if (!match)
        return { meta: {}, body: text };
    let meta = {};
    try {
        meta = (parseYaml(match[1]) ?? {});
    }
    catch {
        meta = {};
    }
    return { meta, body: text.slice(match[0].length) };
}
function serializeFrontmatter(meta, body) {
    const yamlText = stringifyYaml(meta).trimEnd();
    return `---\n${yamlText}\n---\n${body}`;
}
function stringField(v) {
    return typeof v === "string" && v.trim() ? v.trim() : null;
}
// ---------------- argv parsing ----------------
function parseArgv(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("--")) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.startsWith("--")) {
                out[key] = "true";
            }
            else {
                out[key] = next;
                i += 1;
            }
        }
    }
    return out;
}
function requireOption(opts, key) {
    const v = opts[key];
    if (!v || v === "true") {
        throw new Error(`Missing required option: --${key}`);
    }
    return v;
}
// ---------------- git wrappers ----------------
function runGit(repo, args) {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        status: result.status ?? 1
    };
}
function runGitOrThrow(repo, args, description) {
    const result = runGit(repo, args);
    if (result.status !== 0) {
        throw new Error(`git failed (${description}): ${result.stderr.trim() || result.stdout.trim()}`);
    }
    return result;
}
function gitBranchExists(repo, branch) {
    const r = runGit(repo, ["rev-parse", "--verify", `refs/heads/${branch}`]);
    return r.status === 0;
}
