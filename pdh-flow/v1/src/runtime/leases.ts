// Resource lease registry for concurrent ticket execution.
//
// Why this exists: each pdh ticket runs in its own worktree, but per-ticket
// dev tooling (HTTP servers, DBs) collides on global resources — TCP ports
// can only be bound once, db namespaces must not overlap. This module hands
// out values from configured pools and reclaims them on close.
//
// State lives at ${mainRepo}/.pdh-flow/leases.json and is guarded by the
// existing withRunLock primitive (runId="leases" namespace, disjoint from
// real run locks). Config lives at ${mainRepo}/pdh-flow.config.yaml.
//
// Single-machine assumption per CLAUDE.md — no cross-host coordination.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { defaultStateDir } from "./state.ts";
import { withRunLock } from "./locks.ts";

// Lease state must live in the main repo, not in any specific worktree,
// so all worktrees of the same repo share one allocation pool. Given any
// path inside a worktree (or the main repo itself), this resolves to the
// main repo by asking git for the common .git directory and walking up.
// Falls back to the input path if git lookup fails (no .git, etc.) — the
// no-config path stays a no-op so the fallback is observably harmless.
export function resolveLeaseRepo(anyPath: string): string {
  const start = resolve(anyPath);
  const result = spawnSync(
    "git",
    ["-C", start, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" }
  );
  if (result.status !== 0 || !result.stdout) {
    return start;
  }
  const commonDir = result.stdout.trim();
  if (!commonDir) return start;
  return resolve(commonDir, "..");
}

export class LeaseExhaustedError extends Error {
  details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "LeaseExhaustedError";
    this.details = details;
  }
}

export class LeaseConfigError extends Error {
  details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "LeaseConfigError";
    this.details = details;
  }
}

const STATE_VERSION = 1;
const CONFIG_VERSION_SUPPORTED = 1;

export type LeaseKind = "port" | "name";

export interface PoolDef {
  kind: LeaseKind;
  range: [number, number] | null;
  exclude: number[];
  template: string | null;
  from: string[] | null;
  env: string;
}

export interface LeasesConfig {
  pools: Record<string, PoolDef>;
}

export interface LeaseEntry {
  ticket_id: string;
  pool: string;
  kind: LeaseKind;
  value: string | number;
  env: string;
  acquired_at: string;
  pid: number;
  hostname: string;
  worktree: string | null;
}

interface LeasesState {
  version: number;
  leases: LeaseEntry[];
}

export function leasesStatePath(mainRepo: string): string {
  return join(defaultStateDir(mainRepo), "leases.json");
}

export function leasesConfigPath(mainRepo: string): string {
  return join(mainRepo, "pdh-flow.config.yaml");
}

export function loadLeasesConfig(mainRepo: string): LeasesConfig {
  const path = leasesConfigPath(mainRepo);
  if (!existsSync(path)) {
    return { pools: {} };
  }
  let parsed: any;
  try {
    parsed = parseYaml(readFileSync(path, "utf8")) ?? {};
  } catch (error) {
    throw new LeaseConfigError(
      `pdh-flow.config.yaml: invalid YAML: ${(error as Error).message}`,
      { path }
    );
  }
  if (parsed.version !== undefined && parsed.version !== CONFIG_VERSION_SUPPORTED) {
    throw new LeaseConfigError(
      `pdh-flow.config.yaml: unsupported version ${parsed.version} (supported: ${CONFIG_VERSION_SUPPORTED})`,
      { path }
    );
  }
  const rawPools = parsed?.leases?.pools;
  if (!rawPools || typeof rawPools !== "object") {
    return { pools: {} };
  }
  const pools: Record<string, PoolDef> = {};
  for (const [name, raw] of Object.entries(rawPools as Record<string, any>)) {
    const kind = String(raw?.kind ?? "").trim() as LeaseKind;
    if (kind !== "port" && kind !== "name") {
      throw new LeaseConfigError(
        `pdh-flow.config.yaml: pool "${name}" has unknown kind "${raw?.kind}" (supported: port, name)`,
        { path, pool: name }
      );
    }
    let range: [number, number] | null = null;
    if (kind === "port") {
      const r = Array.isArray(raw.range) ? raw.range : null;
      if (
        !r
        || r.length !== 2
        || !Number.isInteger(r[0])
        || !Number.isInteger(r[1])
        || r[0] > r[1]
      ) {
        throw new LeaseConfigError(
          `pdh-flow.config.yaml: pool "${name}" requires range: [low, high] with integer low <= high`,
          { path, pool: name }
        );
      }
      range = [r[0], r[1]];
    }
    const template = typeof raw.template === "string" && raw.template.length > 0 ? raw.template : null;
    const from = Array.isArray(raw.from) && raw.from.length > 0 ? raw.from.map(String) : null;
    if (kind === "name" && !template && !from) {
      throw new LeaseConfigError(
        `pdh-flow.config.yaml: pool "${name}" requires either template: STR or from: [...]`,
        { path, pool: name }
      );
    }
    pools[name] = {
      kind,
      range,
      exclude: Array.isArray(raw.exclude) ? raw.exclude.map(Number).filter(Number.isInteger) : [],
      template,
      from,
      env: typeof raw.env === "string" && raw.env.length > 0 ? raw.env : defaultEnvName(name)
    };
  }
  return { pools };
}

function defaultEnvName(poolName: string): string {
  return poolName.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

function loadStateRaw(mainRepo: string): LeasesState {
  const path = leasesStatePath(mainRepo);
  if (!existsSync(path)) {
    return { version: STATE_VERSION, leases: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.leases)) {
      return {
        version: Number(parsed.version) || STATE_VERSION,
        leases: parsed.leases.filter((entry: unknown): entry is LeaseEntry => !!entry && typeof entry === "object")
      };
    }
  } catch {
    // fall through to empty
  }
  return { version: STATE_VERSION, leases: [] };
}

function saveStateRaw(mainRepo: string, state: LeasesState): void {
  const path = leasesStatePath(mainRepo);
  mkdirSync(defaultStateDir(mainRepo), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === "EPERM";
  }
}

// Returns true when the ticket file's frontmatter shows it's closed or
// cancelled, OR when the ticket file has been moved into tickets/done/,
// OR when the ticket file is missing entirely (orphan). Conservative on
// parse errors: returns false so the lease is kept.
function ticketIsClosed(mainRepo: string, ticketId: string): boolean {
  const active = join(mainRepo, "tickets", `${ticketId}.md`);
  const done = join(mainRepo, "tickets", "done", `${ticketId}.md`);
  if (existsSync(done)) return true;
  if (!existsSync(active)) {
    // Both locations missing — ticket is gone (likely cancelled+removed).
    return true;
  }
  let content: string;
  try {
    content = readFileSync(active, "utf8");
  } catch {
    return false;
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(content);
  if (!match) return false;
  let meta: any;
  try {
    meta = parseYaml(match[1]) ?? {};
  } catch {
    return false;
  }
  const closed = String(meta.closed_at ?? "").trim();
  const cancelled = String(meta.cancelled_at ?? meta.canceled_at ?? "").trim();
  if (closed && closed !== "null") return true;
  if (cancelled && cancelled !== "null") return true;
  return false;
}

function shouldGc(entry: LeaseEntry, mainRepo: string): boolean {
  // Reason A: ticket is closed/cancelled per its frontmatter / done/ move.
  if (ticketIsClosed(mainRepo, entry.ticket_id)) return true;
  // Reason B: original owner pid is dead AND its worktree is gone. Both
  // must be true so we don't reclaim a lease whose owner is just
  // transiently between processes (e.g. dev server restart).
  const sameHost = entry.hostname === hostname();
  const samePid = sameHost && Number.isInteger(entry.pid) && entry.pid > 0;
  const pidGone = samePid ? !pidIsAlive(entry.pid) : false;
  const worktreeGone = entry.worktree ? !existsSync(entry.worktree) : false;
  return pidGone && worktreeGone;
}

interface SweepResult {
  state: LeasesState;
  reclaimed: LeaseEntry[];
}

function sweep(state: LeasesState, mainRepo: string): SweepResult {
  const reclaimed: LeaseEntry[] = [];
  const survivors: LeaseEntry[] = [];
  for (const entry of state.leases) {
    if (shouldGc(entry, mainRepo)) {
      reclaimed.push(entry);
    } else {
      survivors.push(entry);
    }
  }
  return { state: { ...state, leases: survivors }, reclaimed };
}

function slugHash(ticketId: string): string {
  return createHash("sha1").update(String(ticketId)).digest("hex").slice(0, 8);
}

function renderName(template: string, ticketId: string): string {
  return template
    .replaceAll("{slug-hash}", slugHash(ticketId))
    .replaceAll("{ticket-id}", String(ticketId));
}

function allocatePort(poolName: string, pool: PoolDef, used: Set<number>): number {
  if (!pool.range) {
    throw new LeaseConfigError(`pool "${poolName}" missing range`, { pool: poolName });
  }
  const [lo, hi] = pool.range;
  const exclude = new Set<number>(pool.exclude);
  for (let candidate = lo; candidate <= hi; candidate += 1) {
    if (used.has(candidate) || exclude.has(candidate)) continue;
    return candidate;
  }
  throw new LeaseExhaustedError(
    `pool "${poolName}" exhausted: no free port in [${lo}, ${hi}]`,
    { pool: poolName, kind: "port", range: [lo, hi] }
  );
}

function allocateName(poolName: string, pool: PoolDef, ticketId: string, used: Set<string>): string {
  if (pool.template) {
    return renderName(pool.template, ticketId);
  }
  if (!pool.from) {
    throw new LeaseConfigError(`pool "${poolName}" missing template/from`, { pool: poolName });
  }
  for (const candidate of pool.from) {
    if (!used.has(candidate)) return candidate;
  }
  throw new LeaseExhaustedError(
    `pool "${poolName}" exhausted: no free name in from-list (${pool.from.length} entries)`,
    { pool: poolName, kind: "name", from: pool.from }
  );
}

export interface AcquireOptions {
  mainRepo: string;
  ticketId: string;
  worktree?: string | null;
  pools?: string[];
}

export interface AcquireResult {
  leases: LeaseEntry[];
  reclaimed: LeaseEntry[];
}

export async function acquireForTicket(options: AcquireOptions): Promise<AcquireResult> {
  const mainRepo = resolveLeaseRepo(options.mainRepo);
  const { ticketId, worktree = null } = options;
  const config = loadLeasesConfig(mainRepo);
  const allPoolNames = Object.keys(config.pools);
  if (allPoolNames.length === 0) {
    return { leases: [], reclaimed: [] };
  }
  const requested = options.pools && options.pools.length > 0 ? options.pools : allPoolNames;
  for (const name of requested) {
    if (!config.pools[name]) {
      throw new LeaseConfigError(
        `unknown pool "${name}" — not declared in pdh-flow.config.yaml`,
        { pool: name }
      );
    }
  }
  const stateDir = defaultStateDir(mainRepo);
  return withRunLock(
    { stateDir, runId: "leases", waitMs: 5000 },
    async () => {
      const initial = loadStateRaw(mainRepo);
      const swept = sweep(initial, mainRepo);
      let leases = swept.state.leases;
      const acquired: LeaseEntry[] = [];
      let newAllocations = 0;
      for (const poolName of requested) {
        const pool = config.pools[poolName];
        const existing = leases.find(
          (entry) => entry.ticket_id === ticketId && entry.pool === poolName
        );
        if (existing) {
          acquired.push(existing);
          continue;
        }
        let value: string | number;
        if (pool.kind === "port") {
          const used = new Set<number>(
            leases
              .filter((entry) => entry.pool === poolName && entry.kind === "port")
              .map((entry) => Number(entry.value))
          );
          value = allocatePort(poolName, pool, used);
        } else {
          const used = new Set<string>(
            leases
              .filter((entry) => entry.pool === poolName && entry.kind === "name")
              .map((entry) => String(entry.value))
          );
          value = allocateName(poolName, pool, ticketId, used);
        }
        const entry: LeaseEntry = {
          ticket_id: ticketId,
          pool: poolName,
          kind: pool.kind,
          value,
          env: pool.env,
          acquired_at: new Date().toISOString(),
          pid: process.pid,
          hostname: hostname(),
          worktree: worktree ? resolve(worktree) : null
        };
        leases = [...leases, entry];
        acquired.push(entry);
        newAllocations += 1;
      }
      const dirty = swept.reclaimed.length > 0 || newAllocations > 0;
      if (dirty) {
        saveStateRaw(mainRepo, { ...swept.state, leases });
      }
      return { leases: acquired, reclaimed: swept.reclaimed };
    }
  );
}

export interface ReleaseOptions {
  mainRepo: string;
  ticketId: string;
  pools?: string[];
}

export async function releaseForTicket(options: ReleaseOptions): Promise<{ released: LeaseEntry[] }> {
  const mainRepo = resolveLeaseRepo(options.mainRepo);
  const { ticketId } = options;
  const stateDir = defaultStateDir(mainRepo);
  return withRunLock(
    { stateDir, runId: "leases", waitMs: 5000 },
    async () => {
      const state = loadStateRaw(mainRepo);
      const matchesScope = (entry: LeaseEntry): boolean => {
        if (entry.ticket_id !== ticketId) return false;
        if (options.pools && options.pools.length > 0) {
          return options.pools.includes(entry.pool);
        }
        return true;
      };
      const released = state.leases.filter(matchesScope);
      if (released.length === 0) {
        return { released: [] };
      }
      const survivors = state.leases.filter((entry) => !matchesScope(entry));
      saveStateRaw(mainRepo, { ...state, leases: survivors });
      return { released };
    }
  );
}

export async function gcLeases({ mainRepo: anyPath }: { mainRepo: string }): Promise<{ reclaimed: LeaseEntry[] }> {
  const mainRepo = resolveLeaseRepo(anyPath);
  const stateDir = defaultStateDir(mainRepo);
  return withRunLock(
    { stateDir, runId: "leases", waitMs: 5000 },
    async () => {
      const initial = loadStateRaw(mainRepo);
      const swept = sweep(initial, mainRepo);
      if (swept.reclaimed.length > 0) {
        saveStateRaw(mainRepo, swept.state);
      }
      return { reclaimed: swept.reclaimed };
    }
  );
}

export function listLeases({ mainRepo: anyPath, ticketId = null }: { mainRepo: string; ticketId?: string | null }): LeaseEntry[] {
  const mainRepo = resolveLeaseRepo(anyPath);
  const state = loadStateRaw(mainRepo);
  if (ticketId) {
    return state.leases.filter((entry) => entry.ticket_id === ticketId);
  }
  return state.leases;
}
