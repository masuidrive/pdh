import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runCodex } from "../runtime/providers/codex.ts";
import { loadDotEnv } from "../support/env.ts";

export async function runCalcSmoke({ rootDir = "/tmp/pdh-flow-calc-smoke", stateDir = null, store = null, bypass = true, timeoutMs = 10 * 60 * 1000 } = {}) {
  loadDotEnv();
  const uvCache = "/tmp/pdh-flow-uv-cache";
  rmSync(rootDir, { recursive: true, force: true });
  mkdirSync(rootDir, { recursive: true });
  mkdirSync(uvCache, { recursive: true });
  const providerEnv = {
    ...process.env,
    TMPDIR: "/tmp",
    UV_CACHE_DIR: uvCache
  };
  spawnSync("git", ["init"], { cwd: rootDir, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "pdh-flow@example.local"], { cwd: rootDir, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "pdh-flow smoke"], { cwd: rootDir, stdio: "ignore" });

  writeFileSync(join(rootDir, "current-ticket.md"), `# Ticket: calc-cli

## Why
Provide a tiny smoke target for pdh-flow Codex execution.

## What
Create a Python CLI calculator that can run through uv.

## Acceptance Criteria
- [ ] Running \`uv run calc "1+2"\` prints \`3\`.
- [ ] Invalid expressions fail with a readable error.

## Implementation Notes
- Keep the implementation small and dependency-free.
`);
  writeFileSync(join(rootDir, "current-note.md"), `## Status: PD-C-6 (Implementation) | Flow: Full - ${new Date().toISOString()}

### PD-C-3. 計画
- Build a minimal Python project with a \`calc\` console script.
- Use a safe AST evaluator for +, -, *, /, parentheses, and numbers.

### PD-C-6
- Pending Codex implementation.
`);

  const prompt = `You are implementing a tiny smoke target repository.

Goal:
- Create a Python project runnable with uv.
- The command "uv run calc \"1+2\"" must print exactly "3".
- Invalid expressions must exit non-zero with a clear error.
- Keep it dependency-free.

Required files:
- pyproject.toml with a console script named calc.
- a small Python module implementing the CLI.
- README.md with one usage example.

Constraints:
- Do not read or print environment variables.
- Do not modify files outside this repository.
- After implementing, run "uv run calc \"1+2\"" and fix issues until it works.
`;

  const rawLogPath = join(rootDir, ".pdh-flow", "runs", "calc-smoke", "steps", "PD-C-6", "attempt-1", "codex.raw.jsonl");
  const events = [];
  const result = await runCodex({
    cwd: rootDir,
    prompt,
    rawLogPath,
    bypass,
    env: {
      TMPDIR: providerEnv.TMPDIR,
      UV_CACHE_DIR: providerEnv.UV_CACHE_DIR
    },
    timeoutMs,
    onEvent(event) {
      events.push(event);
      if (store) {
        store.addEvent({
          runId: "calc-smoke",
          stepId: "PD-C-6",
          type: event.type,
          provider: "codex",
          message: event.message,
          payload: event.payload ?? {}
        });
      }
    }
  });

  const verify = spawnSync("uv", ["run", "calc", "1+2"], {
    cwd: rootDir,
    encoding: "utf8",
    env: { ...process.env, TMPDIR: "/tmp", UV_CACHE_DIR: uvCache }
  });
  const output = (verify.stdout ?? "").trim();
  const passed = verify.status === 0 && output === "3";

  return {
    rootDir,
    rawLogPath,
    codexExitCode: result.exitCode,
    verifyExitCode: verify.status,
    verifyStdout: output,
    verifyStderr: (verify.stderr ?? "").trim(),
    passed,
    files: existsSync(rootDir) ? listTopLevel(rootDir) : [],
    finalMessage: result.finalMessage
  };
}

function listTopLevel(rootDir) {
  const listing = spawnSync("find", [rootDir, "-maxdepth", "2", "-type", "f"], { encoding: "utf8" });
  return listing.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => path.replace(`${rootDir}/`, ""));
}
