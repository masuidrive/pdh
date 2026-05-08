#!/usr/bin/env node
// pdh-flow v2 CLI entrypoint.
//
// Dispatches subcommands. Stays small on purpose: each subcommand lives in
// its own file and is invoked here. Argument parsing uses Node's built-in
// util.parseArgs (no third-party CLI library).

import { parseArgs } from "node:util";

import { cmdCheckFlow } from "./check-flow.ts";
import { cmdCompileFlow } from "./compile-flow.ts";
import { cmdRunEngine } from "./run-engine.ts";
import { cmdServe } from "./serve.ts";

const SUBCOMMANDS = {
  "check-flow": cmdCheckFlow,
  "compile-flow": cmdCompileFlow,
  "run-engine": cmdRunEngine,
  serve: cmdServe,
  help: cmdHelp,
} as const;

type SubcommandName = keyof typeof SUBCOMMANDS;

function isSubcommand(name: string): name is SubcommandName {
  return Object.hasOwn(SUBCOMMANDS, name);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // No-arg or --help / -h falls into help.
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    cmdHelp();
    return;
  }

  const [name, ...rest] = argv;
  if (!isSubcommand(name)) {
    process.stderr.write(`unknown subcommand: ${name}\n\n`);
    cmdHelp();
    process.exitCode = 2;
    return;
  }

  try {
    await SUBCOMMANDS[name](rest);
  } catch (error) {
    process.stderr.write(
      `error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

function cmdHelp(): void {
  process.stdout.write(`pdh-flow (v2)

Usage:
  pdh-flow <subcommand> [options]

Subcommands:
  check-flow    --flow <id> [--repo <dir>]
                Validate flows/<id>.yaml against the schema. Exits 0 on success,
                non-zero on schema or expansion violation.

  compile-flow  --flow <id> [--repo <dir>] [--out <file>]
                Validate + macro-expand flows/<id>.yaml to flat-flow form.
                Prints JSON to stdout (or writes --out) for inspection.

  run-engine    --ticket <id> --flow <id> [--variant <full|light>]
                [--repo <dir>] [--start-at <node>] [--stop-at <node>]
                [--fixture <dir>]
                Run the v2 engine. With --fixture, replays node outputs from
                the given fixture dir (for testing); without --fixture, real
                provider invocation is required (not yet wired in v0.2.0-pre).

  serve         [--worktree <dir>] [--port <n>] [--static-dir <dir>]
                Launch the Web UI HTTP server against the worktree's
                .pdh-flow/runs state (default port 5170). Approves gates by
                writing into the same files the engine's await-gate actor
                polls.

  help          Show this message.

Options shared by all subcommands:
  --repo DIR    Repo root that contains flows/ (default: cwd).

For implementation status see pdh-flow's plan file.
`);
}

// `parseArgs` helper used by subcommands; exported for reuse.
export interface ParsedArgs {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

export function parseSubcommandArgs(
  args: string[],
  options: Record<string, { type: "string" | "boolean"; short?: string; multiple?: boolean }>,
): ParsedArgs {
  const r = parseArgs({
    args,
    options: options as never,
    allowPositionals: true,
    strict: true,
  });
  return {
    values: r.values as ParsedArgs["values"],
    positionals: r.positionals,
  };
}

await main();
