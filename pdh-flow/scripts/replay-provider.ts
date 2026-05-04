#!/usr/bin/env node
// Generic provider replayer for the runtime test suite.
//
// Set PDH_REPLAY_FIXTURE to a fixture directory shaped like:
//
//   raw.jsonl              provider stdout to replay; may contain
//                          ${SESSION_ID} / ${THREAD_ID} (or any custom)
//                          placeholders that get substituted at replay
//                          time.
//   artifacts/<basename>   files to drop at the paths the prompt asks for.
//                          The prompt is scanned for both
//                            Write valid JSON to `<path>`
//                            Write JSON to `<path>`
//                          patterns. The replayer matches by basename so
//                          any state-dir-relative path works.
//   meta.json (optional)   { "exit": <int>,         // process exit code
//                            "delayMs": <int>,      // sleep before stdout
//                            "stderr": <string>,    // text to write to
//                                                   // stderr before exit
//                            "placeholders": {      // overrides random
//                              "SESSION_ID": "fixed-value",
//                              ...
//                            } }
//
// Optional sequencing for multi-call scenarios (review loops, retries):
//
//   PDH_REPLAY_COUNT_FILE  path to a counter file. The replayer reads it,
//                          increments it, and if the fixture dir contains
//                          a `call-<n>` subdir, that subdir is used for
//                          this invocation.
//
// Optional argv capture (for tests that assert what was passed):
//
//   FAKE_ARGS_FILE         write argv to this path (one arg per line)
//   FAKE_CODEX_ARGS_FILE / FAKE_CLAUDE_ARGS_FILE
//                          same, picked first if set (matches the
//                          conventions the existing tests already use).
//
// The replayer never authors provider content — content comes from
// raw.jsonl + artifacts/, both produced by scripts/record-fixture.sh from
// a real provider run.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const fixtureRoot = process.env.PDH_REPLAY_FIXTURE;
if (!fixtureRoot) {
  process.stderr.write("replay-provider: PDH_REPLAY_FIXTURE not set\n");
  process.exit(2);
}

const fixture = resolveFixtureDir();
const meta = loadMeta(fixture);

writeArgsCaptureIfRequested(meta);

let stdinBuffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdinBuffer += chunk;
});
process.stdin.on("end", () => {
  run(stdinBuffer).catch((err) => {
    process.stderr.write(`replay-provider: ${err?.stack || err}\n`);
    process.exit(1);
  });
});
process.stdin.resume();

async function run(stdin) {
  // Concatenate every plausible source of prompt text. Different providers
  // pass it different ways (codex uses stdin, claude has used `-p`, `--`,
  // or a positional arg over time). Searching the union of stdin + argv
  // means we don't need to special-case provider conventions.
  const haystack = `${stdin}\n${process.argv.slice(2).join("\n")}`;
  const targets = extractTargetPaths(haystack);

  const artifactsDir = join(fixture, "artifacts");
  if (existsSync(artifactsDir)) {
    for (const target of targets) {
      const src = join(artifactsDir, basename(target));
      if (existsSync(src)) {
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(src, target);
      }
    }
  }

  if (Number.isFinite(meta.delayMs) && meta.delayMs > 0) {
    await new Promise((r) => setTimeout(r, meta.delayMs));
  }

  const placeholders = buildPlaceholders(meta.placeholders);
  const rawPath = join(fixture, "raw.jsonl");
  if (existsSync(rawPath)) {
    let raw = readFileSync(rawPath, "utf8");
    for (const [key, value] of Object.entries(placeholders)) {
      raw = raw.split("${" + key + "}").join(value);
    }
    process.stdout.write(raw);
  }

  if (typeof meta.stderr === "string" && meta.stderr.length > 0) {
    process.stderr.write(meta.stderr);
  }

  process.exit(Number.isInteger(meta.exit) ? meta.exit : 0);
}

function resolveFixtureDir() {
  const counterFile = process.env.PDH_REPLAY_COUNT_FILE;
  if (counterFile) {
    let n = 0;
    if (existsSync(counterFile)) {
      const text = readFileSync(counterFile, "utf8").trim();
      if (text) n = Number(text);
    }
    n += 1;
    mkdirSync(dirname(counterFile), { recursive: true });
    writeFileSync(counterFile, String(n));
    const sequenced = join(fixtureRoot, `call-${n}`);
    if (existsSync(sequenced)) return sequenced;
  }
  return fixtureRoot;
}

function loadMeta(dir) {
  const path = join(dir, "meta.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    process.stderr.write(`replay-provider: invalid meta.json: ${err.message}\n`);
    return {};
  }
}

function writeArgsCaptureIfRequested(meta) {
  const target =
    process.env.FAKE_CLAUDE_ARGS_FILE ||
    process.env.FAKE_CODEX_ARGS_FILE ||
    process.env.FAKE_ARGS_FILE ||
    meta.argsFile ||
    null;
  if (!target) return;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, process.argv.slice(2).join("\n") + "\n");
}

function extractTargetPaths(text) {
  const patterns = [
    /Write valid JSON to `([^`]+)`/g,
    /Write JSON to `([^`]+)`/g
  ];
  const out = [];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      out.push(match[1]);
    }
  }
  return out;
}

function buildPlaceholders(custom = {}) {
  const out = {
    SESSION_ID: `replay-session-${randomBytes(4).toString("hex")}`,
    THREAD_ID: `replay-thread-${randomBytes(4).toString("hex")}`
  };
  for (const [k, v] of Object.entries(custom)) {
    out[k] = String(v);
  }
  return out;
}
