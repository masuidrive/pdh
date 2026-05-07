// CLI commands for the resource lease registry.
//
//   pdh-flow lease acquire --ticket <id> [--repo DIR] [--worktree DIR] [--pool NAME]...
//   pdh-flow lease release --ticket <id> [--repo DIR] [--pool NAME]...
//   pdh-flow lease list    [--ticket <id>] [--repo DIR]
//   pdh-flow lease gc      [--repo DIR]
//
// Output is JSON on stdout; errors go to stderr with non-zero exit.

import { resolve } from "node:path";
import {
  acquireForTicket,
  gcLeases,
  LeaseConfigError,
  LeaseExhaustedError,
  listLeases,
  releaseForTicket
} from "../runtime/leases.ts";
import { writeEnvLease, removeEnvLease } from "../runtime/env-lease.ts";
import { parseOptions, required } from "./utils.ts";

function collectMulti(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === flag) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        values.push(next);
        i += 1;
      }
      continue;
    }
    const eqPrefix = `${flag}=`;
    if (token.startsWith(eqPrefix)) {
      values.push(token.slice(eqPrefix.length));
    }
  }
  return values;
}

export async function cmdLeaseAcquire(argv: string[]): Promise<void> {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const ticketId = required(options, "ticket");
  const pools = collectMulti(argv, "--pool");
  const worktree = options.worktree ? resolve(options.worktree) : repo;
  try {
    const result = await acquireForTicket({
      mainRepo: repo,
      ticketId,
      worktree,
      pools: pools.length > 0 ? pools : undefined
    });
    if (result.leases.length > 0) {
      writeEnvLease(worktree, result.leases);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof LeaseExhaustedError || error instanceof LeaseConfigError) {
      console.error(`pdh-flow lease acquire: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

export async function cmdLeaseRelease(argv: string[]): Promise<void> {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const ticketId = required(options, "ticket");
  const pools = collectMulti(argv, "--pool");
  const worktree = options.worktree ? resolve(options.worktree) : repo;
  const result = await releaseForTicket({
    mainRepo: repo,
    ticketId,
    pools: pools.length > 0 ? pools : undefined
  });
  // After releasing, the worktree's .env.lease no longer reflects state
  // — drop it. Even when partial release was requested, the safe move
  // is to drop the file (callers can re-acquire the kept pools to
  // re-emit it).
  if (result.released.length > 0) {
    removeEnvLease(worktree);
  }
  console.log(JSON.stringify(result, null, 2));
}

export async function cmdLeaseList(argv: string[]): Promise<void> {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const ticketId = options.ticket ?? null;
  const leases = listLeases({ mainRepo: repo, ticketId });
  console.log(JSON.stringify({ leases }, null, 2));
}

export async function cmdLeaseGc(argv: string[]): Promise<void> {
  const options = parseOptions(argv);
  const repo = resolve(options.repo ?? process.cwd());
  const result = await gcLeases({ mainRepo: repo });
  console.log(JSON.stringify(result, null, 2));
}
