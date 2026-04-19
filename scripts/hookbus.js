#!/usr/bin/env node
// hookbus — Claude Code hook event bus for tmux director workflows
// ================================================================
//
// ## 何をする
//
// tmux 上で複数の Claude Code worker を動かしているとき、それぞれの worker が
// アイドル (Stop / SubagentStop) や permission 要求 (Notification) になった瞬間を
// Claude Code hook から受け取り、`/tmp/claude-events-<socket_hash>/log.ndjson`
// に NDJSON で append する。Director 側は `pull --follow` で stream 消費することで、
// 15 秒の capture-pane polling を廃止して ms 単位で反応できる。
//
//   worker hook ──► hookbus event ──► log.ndjson ──► hookbus pull --follow ──► director
//
// ## セットアップ (プロジェクトの `.claude/settings.json` に追加)
//
//   {
//     "env": {
//       "CLAUDE_EVENT_DISABLE": "1"    // ← 配線直後は default で dormant、follow-up で外す
//     },
//     "hooks": {
//       "SessionStart":       [{"hooks":[{"type":"command","command":"scripts/hookbus.js event","timeout":5}]}],
//       "Stop":               [{"hooks":[{"type":"command","command":"scripts/hookbus.js event","timeout":5}]}],
//       "SubagentStop":       [{"hooks":[{"type":"command","command":"scripts/hookbus.js event","timeout":5}]}],
//       "Notification":       [{"matcher":"idle_prompt|permission_prompt",
//                                "hooks":[{"type":"command","command":"scripts/hookbus.js event","timeout":5}]}],
//       "UserPromptSubmit":   [{"hooks":[{"type":"command","command":"scripts/hookbus.js event","timeout":5}]}]
//     }
//   }
//
// UserPromptSubmit は director が tmux send-keys で Enter 送信した直後に worker pane で
// 入力が submit されたかを verify するために使う (Enter 取りこぼし検出)。director は
// send-keys 後 5-10 秒で該当 pane key の UserPromptSubmit event を待ち、来なければ
// 補助 Enter を送り直す。
//
// 上記は **hook が発火してもログはまだ書かない** 状態 (kill-switch ON)。tmux-director
// 側を hookbus 消費モードに切り替える時に `CLAUDE_EVENT_DISABLE` を env から外す。
//
// ## 制御 env
//
//   CLAUDE_EVENT_DISABLE=1     event サブコマンドを no-op exit。全 worker で事実上無効化。
//   CLAUDE_EVENT_ROLE=director  director 自身の hook を除外 (log 汚染防止)。
//                                director pane 起動時に export すること。
//                                子 subagent (Monitor 等) にも env 継承で自動伝播。
//
// ## サブコマンド
//
//   hookbus.js event
//     stdin の hook JSON を読み、`{key, ts, session_id, hook_event_name, last_message, ...}` を
//     log.ndjson に 1 行 atomic append。hook 側から呼ばれる想定。<100ms で exit。
//     key = <socket_hash>:<pane_id> (socket_hash は $TMUX から sha1 先頭 6 桁)。
//     $TMUX_PANE 未継承時は SessionStart registry か `session-<id>` fallback + warn。
//     stdin に `transcript_path` が含まれていれば、その JSONL の末尾 assistant text メッセージを
//     extract して `last_message: {text_snippet, text_full_length, uuid, timestamp}` を同梱する
//     (tmux capture-pane なしで director が直接内容を読めるように)。`HOOKBUS_LAST_MESSAGE_MAX`
//     env で snippet 長を設定可能 (default 2000、0 で抽出無効)。
//
//   hookbus.js pull [--include <key>]... [--cursor <key>] [--follow]
//     イベントを stdout に NDJSON で流す。
//     `--include <key>` (repeatable): allow-list。指定があれば該当 key の event のみ yield。
//       未指定なら全 event を yield (director 以外のセッションが全て興味対象の場合)。
//     `--cursor <key>`: consumer の read position 識別子 (default: whoami の key)。
//       同じ cursor key で再起動しても続きから再開される。per-consumer に
//       `<root>/consumers/<urlencoded_key>.cursor` に永続化。
//     `--follow`: 新規 append を `fs.watch` + polling で追跡。SIGTERM で cleanly 終了。
//
//     Director 側は通常 Monitor ツール (Claude Code の streaming notification) で
//     この出力を消費する。監視対象の worker key を明示的に --include で列挙する:
//
//       Monitor({
//         command: "env -u CLAUDE_EVENT_DISABLE scripts/hookbus.js pull --include <w1-key> --include <w2-key> --include <w3-key> --follow",
//         description: "tmux worker idle events",
//         persistent: true
//       })
//
//     1 event = 1 通知として会話に push される。director は他の作業をしつつ反応可能。
//     監視対象外の pane (例: 無関係な w4) の event は allow-list にないので自然に弾かれる。
//
//   hookbus.js whoami
//     `<socket_hash>:<pane_id>` を stdout 出力 ($TMUX_PANE 未設定時は `local-<pid>`)。
//     Director の cursor identity default (`pull` で --cursor を省略した時) にもなる。
//
//   hookbus.js cleanup [--older-than <days>] [--dry-run]
//     `/tmp/claude-events-*/` の古い root を削除 (default 7 日、log.ndjson mtime 基準)。
//
// ## ログ配置
//
//   /tmp/claude-events-<socket_hash>/      (mode 0o700)
//     ├── log.ndjson                        (mode 0o600、append-only)
//     ├── consumers/<urlencoded_key>.cursor (mode 0o600、per-consumer byte offset)
//     └── sessions/<session_id>.json        (mode 0o600、TMUX_PANE fallback registry)
//
// socket_hash で tmux server 毎に分離されるため、同一ホストで複数 tmux server を
// 動かしても衝突しない。Docker 跨ぎ等で `/tmp` が共有されないケースは対象外。
//
// ## このファイルの構成
//
//   1. Library     (pure-ish functions、テストや他モジュールから import 可)
//   2. CLI         (event / pull / whoami / cleanup の実装)
//   3. CLI entry   (`import.meta.url === file://${process.argv[1]}` の時だけ main)
//   4. In-source tests (`import.meta.vitest` ブロック、vitest の時だけ走る)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

// =====================================================================
// 1. Library
// =====================================================================

const ROOT_PREFIX = 'claude-events-';
const ROOT_MODE = 0o700;
const FILE_MODE = 0o600;
const POLL_INTERVAL_MS = 250;

function currentTmpDir() {
  return process.env.TMPDIR ?? os.tmpdir();
}

function ensureDirMode(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  fs.chmodSync(dirPath, ROOT_MODE);
}

function ensureParentDir(filePath) {
  ensureDirMode(path.dirname(filePath));
}

function ensureFileMode(filePath) {
  fs.chmodSync(filePath, FILE_MODE);
}

function statOrNull(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error instanceof SyntaxError)) {
      return null;
    }
    throw error;
  }
}

function atomicWriteFile(filePath, contents) {
  const tempPath = `${filePath}.tmp`;
  const fd = fs.openSync(tempPath, 'w', FILE_MODE);
  try {
    fs.writeSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tempPath, filePath);
  ensureFileMode(filePath);
}

export function computeSocketHash(tmuxEnv) {
  if (!tmuxEnv) {
    return 'local';
  }

  const socketPath = String(tmuxEnv).split(',', 1)[0];
  if (!socketPath) {
    return 'local';
  }

  return createHash('sha1').update(socketPath).digest('hex').slice(0, 6);
}

export function resolveSocketHash(event, env = process.env) {
  if (env.TMUX) {
    return computeSocketHash(env.TMUX);
  }

  if (event?.session_id) {
    const fallbackRoot = eventsRoot('local');
    const localRegistry = readSessionRegistry(fallbackRoot, event.session_id);
    if (localRegistry?.socket) {
      return computeSocketHash(localRegistry.socket);
    }

    for (const root of listEventRoots()) {
      const registry = readSessionRegistry(root, event.session_id);
      if (registry?.socket) {
        return computeSocketHash(registry.socket);
      }
    }
  }

  return 'local';
}

export function eventsRoot(socketHash) {
  return path.join(currentTmpDir(), `${ROOT_PREFIX}${socketHash}`);
}

export function logPath(root) {
  return path.join(root, 'log.ndjson');
}

export function cursorPath(root, key) {
  return path.join(root, 'consumers', `${encodeURIComponent(key)}.cursor`);
}

export function sessionRegistryPath(root, sessionId) {
  return path.join(root, 'sessions', `${sessionId}.json`);
}

export function computeKey(env = process.env) {
  const socketHash = computeSocketHash(env.TMUX);
  if (env.TMUX_PANE) {
    return `${socketHash}:${env.TMUX_PANE}`;
  }

  return `local-${env.PID ?? process.pid}`;
}

export function readSessionRegistry(root, sessionId) {
  return readJsonFile(sessionRegistryPath(root, sessionId));
}

export function writeSessionRegistry(root, sessionId, data) {
  const registryFile = sessionRegistryPath(root, sessionId);
  ensureDirMode(root);
  ensureParentDir(registryFile);
  atomicWriteFile(registryFile, `${JSON.stringify(data)}\n`);
}

export function resolveKey(event, env = process.env, warn = () => {}) {
  const socketHash = resolveSocketHash(event, env);
  if (env.TMUX_PANE) {
    return `${socketHash}:${env.TMUX_PANE}`;
  }

  if (event?.session_id) {
    const root = eventsRoot(socketHash);
    const registry = readSessionRegistry(root, event.session_id);
    if (registry?.tmux_pane) {
      return `${socketHash}:${registry.tmux_pane}`;
    }

    const fallbackKey = `${socketHash}:session-${event.session_id}`;
    warn(
      `TMUX_PANE unavailable and no SessionStart registry for session_id=${event.session_id}; using key=${fallbackKey}`,
    );
    return fallbackKey;
  }

  const fallbackKey = `${socketHash}:session-unknown`;
  warn(`TMUX_PANE unavailable and session_id missing; using key=${fallbackKey}`);
  return fallbackKey;
}

export function appendEvent(root, event) {
  ensureDirMode(root);
  const logFile = logPath(root);
  ensureParentDir(logFile);

  const payloadBuffer = Buffer.from(`${JSON.stringify(event)}\n`, 'utf8');
  const fd = fs.openSync(logFile, 'a', FILE_MODE);
  try {
    fs.writeSync(fd, payloadBuffer);
  } finally {
    fs.closeSync(fd);
  }

  ensureFileMode(logFile);
}

export function readCursor(root, key) {
  const filePath = cursorPath(root, key);
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (raw === '') {
      return 0;
    }

    const offset = Number.parseInt(raw, 10);
    return Number.isFinite(offset) && offset >= 0 ? offset : 0;
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error instanceof SyntaxError)) {
      return 0;
    }
    throw error;
  }
}

export function writeCursor(root, key, offset) {
  const filePath = cursorPath(root, key);
  ensureDirMode(root);
  ensureParentDir(filePath);
  atomicWriteFile(filePath, `${offset}\n`);
}

function createAbortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function safeFileSize(filePath) {
  return statOrNull(filePath)?.size ?? 0;
}

export async function* tailLog(
  root,
  fromOffset = 0,
  {
    follow = false,
    signal,
    watchFactory = fs.watch,
    statSync = fs.statSync,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = {},
) {
  const logFile = logPath(root);
  let offset = fromOffset;
  let remainder = '';
  let watcher = null;
  let pollingTimer = null;
  let notifyResolver = null;
  let pendingNotify = false;
  let lastKnownSize = safeFileSize(logFile);
  let aborted = false;

  const cleanup = () => {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    if (pollingTimer) {
      clearIntervalFn(pollingTimer);
      pollingTimer = null;
    }
  };

  const notify = () => {
    pendingNotify = true;
    if (notifyResolver) {
      const resolve = notifyResolver;
      notifyResolver = null;
      pendingNotify = false;
      resolve();
    }
  };

  const startPolling = () => {
    if (pollingTimer) {
      return;
    }

    pollingTimer = setIntervalFn(() => {
      const size = safeFileSize(logFile);
      if (size !== lastKnownSize) {
        lastKnownSize = size;
        notify();
      }
    }, POLL_INTERVAL_MS);
  };

  const onAbort = () => {
    aborted = true;
    cleanup();
    notify();
  };

  if (signal) {
    if (signal.aborted) {
      throw createAbortError();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  if (follow) {
    ensureDirMode(root);
    try {
      watcher = watchFactory(root, () => {
        lastKnownSize = safeFileSize(logFile);
        notify();
      });

      if (typeof watcher?.on === 'function') {
        watcher.on('error', () => {
          cleanup();
          startPolling();
          notify();
        });
        watcher.on('close', () => {
          cleanup();
          startPolling();
          notify();
        });
      }
    } catch {
      startPolling();
    }
  }

  try {
    while (true) {
      if (aborted) {
        throw createAbortError();
      }

      const size = (() => {
        try {
          return statSync(logFile).size;
        } catch (error) {
          if (error && error.code === 'ENOENT') {
            return 0;
          }
          throw error;
        }
      })();

      if (size < offset) {
        offset = 0;
        remainder = '';
      }

      if (size > offset) {
        const bytesToRead = size - offset;
        const readOffset = offset;
        const fd = fs.openSync(logFile, 'r');
        let chunk;
        try {
          chunk = Buffer.alloc(bytesToRead);
          const bytesRead = fs.readSync(fd, chunk, 0, bytesToRead, offset);
          offset += bytesRead;
          lastKnownSize = offset;
          remainder += chunk.subarray(0, bytesRead).toString('utf8');
        } finally {
          fs.closeSync(fd);
        }

        const lines = remainder.split('\n');
        remainder = lines.pop() ?? '';
        let lineOffset = readOffset;
        for (const line of lines) {
          lineOffset += Buffer.byteLength(`${line}\n`, 'utf8');
          if (line === '') {
            continue;
          }
          yield { line, offset: lineOffset };
        }
        continue;
      }

      if (!follow) {
        break;
      }

      if (pendingNotify) {
        pendingNotify = false;
        continue;
      }

      await new Promise((resolve) => {
        notifyResolver = resolve;
      });
    }
  } finally {
    cleanup();
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

export function listEventRoots(tmpDir = currentTmpDir()) {
  return fs
    .readdirSync(tmpDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(ROOT_PREFIX))
    .map((entry) => path.join(tmpDir, entry.name));
}

function maxMtimeMsRecursive(targetPath) {
  const stat = statOrNull(targetPath);
  if (!stat) {
    return 0;
  }

  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  let latest = 0;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    latest = Math.max(latest, maxMtimeMsRecursive(path.join(targetPath, entry.name)));
  }
  return latest;
}

const DEFAULT_LAST_MESSAGE_MAX_CHARS = 2000;

export function extractLastAssistantMessage(transcriptPath, { maxChars = DEFAULT_LAST_MESSAGE_MAX_CHARS } = {}) {
  if (!transcriptPath || maxChars <= 0) {
    return null;
  }

  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry?.type !== 'assistant') {
      continue;
    }

    const content = entry.message?.content;
    let text;
    if (Array.isArray(content)) {
      text = content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
        .trim();
    } else if (typeof content === 'string') {
      text = content.trim();
    } else {
      text = '';
    }

    if (!text) {
      continue;
    }

    return {
      role: 'assistant',
      uuid: entry.uuid ?? null,
      timestamp: entry.timestamp ?? null,
      text_full_length: text.length,
      text_snippet: text.length > maxChars ? `${text.slice(0, maxChars)}...[truncated]` : text,
    };
  }

  return null;
}

export function latestActivityMtimeMs(root) {
  const logFile = logPath(root);
  const logStat = statOrNull(logFile);
  if (logStat) {
    return logStat.mtimeMs;
  }

  return maxMtimeMsRecursive(root);
}

// =====================================================================
// 2. CLI
// =====================================================================

async function readStdinJson() {
  const chunks = [];
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    chunks.push(chunk);
  });
  await finished(process.stdin);
  const raw = chunks.join('').trim();
  if (raw === '') {
    throw new Error('stdin JSON is required');
  }
  return JSON.parse(raw);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  return { command, rest };
}

function parsePullArgs(argv) {
  const includes = [];
  let cursorKey = null;
  let follow = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--include') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--include requires a value');
      }
      includes.push(value);
      index += 1;
      continue;
    }
    if (arg === '--cursor') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--cursor requires a value');
      }
      cursorKey = value;
      index += 1;
      continue;
    }
    if (arg === '--follow') {
      follow = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return { includes, cursorKey, follow };
}

function parseCleanupArgs(argv) {
  let olderThanDays = 7;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--older-than') {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`invalid --older-than value: ${argv[index + 1]}`);
      }
      olderThanDays = value;
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return { olderThanDays, dryRun };
}

async function eventCommand() {
  if (process.env.CLAUDE_EVENT_ROLE === 'director' || process.env.CLAUDE_EVENT_DISABLE === '1') {
    return;
  }

  const input = await readStdinJson();
  const socketHash = resolveSocketHash(input, process.env);
  const root = eventsRoot(socketHash);

  if (input.hook_event_name === 'SessionStart' && input.session_id) {
    writeSessionRegistry(root, input.session_id, {
      session_id: input.session_id,
      tmux_pane: process.env.TMUX_PANE ?? null,
      socket: process.env.TMUX ? String(process.env.TMUX).split(',', 1)[0] : null,
      started_at: new Date().toISOString(),
    });
    return;
  }

  const key = resolveKey(input, process.env, (message) => {
    process.stderr.write(`${message}\n`);
  });

  const maxCharsRaw = process.env.HOOKBUS_LAST_MESSAGE_MAX;
  const parsedMaxChars = maxCharsRaw !== undefined ? Number.parseInt(maxCharsRaw, 10) : DEFAULT_LAST_MESSAGE_MAX_CHARS;
  const maxChars = Number.isFinite(parsedMaxChars) ? parsedMaxChars : DEFAULT_LAST_MESSAGE_MAX_CHARS;
  const lastMessage = input.transcript_path
    ? extractLastAssistantMessage(input.transcript_path, { maxChars })
    : null;

  appendEvent(root, {
    key,
    ts: new Date().toISOString(),
    ...input,
    session_id: input.session_id ?? null,
    last_message: lastMessage,
  });
}

async function pullCommand(argv) {
  const { includes, cursorKey, follow } = parsePullArgs(argv);
  const cursor = cursorKey ?? computeKey(process.env);
  const socketHash = cursor.includes(':') ? cursor.split(':', 1)[0] : computeSocketHash(process.env.TMUX);
  const root = eventsRoot(socketHash);
  const logFile = logPath(root);
  const allowSet = includes.length > 0 ? new Set(includes) : null;

  if (!fs.existsSync(logFile) && !follow) {
    writeCursor(root, cursor, 0);
    return;
  }

  const abortController = new AbortController();
  const stop = () => abortController.abort();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  let lastOffset = readCursor(root, cursor);
  try {
    for await (const { line, offset } of tailLog(root, lastOffset, {
      follow,
      signal: abortController.signal,
    })) {
      lastOffset = offset;
      let event;
      try {
        event = JSON.parse(line);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        process.stderr.write(`warning: skipping invalid log line at offset ${offset}: ${reason}\n`);
        writeCursor(root, cursor, lastOffset);
        continue;
      }

      if (!allowSet || allowSet.has(event.key)) {
        process.stdout.write(`${line}\n`);
      }

      writeCursor(root, cursor, lastOffset);
    }

    writeCursor(root, cursor, lastOffset);
  } catch (error) {
    if (error?.name !== 'AbortError') {
      throw error;
    }
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
}

async function whoamiCommand() {
  process.stdout.write(`${computeKey(process.env)}\n`);
}

async function cleanupCommand(argv) {
  const { olderThanDays, dryRun } = parseCleanupArgs(argv);
  const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  const targets = listEventRoots().filter((root) => latestActivityMtimeMs(root) < cutoffMs);
  for (const root of targets) {
    process.stdout.write(`${root}\n`);
    if (!dryRun) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

async function main() {
  const { command, rest } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'event':
      await eventCommand();
      break;
    case 'pull':
      await pullCommand(rest);
      break;
    case 'whoami':
      await whoamiCommand();
      break;
    case 'cleanup':
      await cleanupCommand(rest);
      break;
    default:
      throw new Error(`unknown subcommand: ${command ?? '(missing)'}`);
  }
}

// =====================================================================
// 3. CLI entry — only runs main() when invoked as a script.
// Importing as a module (e.g. from tests or child_process workers) skips it.
// =====================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

// =====================================================================
// 4. In-source tests — executed only under vitest.
// `import.meta.vitest` is undefined in normal Node execution, so this block
// is a no-op for production.
// =====================================================================

if (import.meta.vitest) {
  const { afterEach, describe, expect, test } = import.meta.vitest;

  const __filename = fileURLToPath(import.meta.url);
  const scriptsDir = path.dirname(__filename);
  const repoRoot = path.resolve(scriptsDir, '..');
  const cmdPath = __filename;

  const cleanupPaths = new Set();
  const originalTmpdir = process.env.TMPDIR;

  function markForCleanup(targetPath) {
    cleanupPaths.add(targetPath);
    return targetPath;
  }

  function makeTempDir(prefix) {
    const baseTmpdir = originalTmpdir ?? process.env.TMPDIR ?? '/tmp';
    return markForCleanup(fs.mkdtempSync(path.join(baseTmpdir, prefix)));
  }

  function setTmpdir(tmpdir) {
    process.env.TMPDIR = tmpdir;
    return tmpdir;
  }

  function restoreTmpdir() {
    if (originalTmpdir === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = originalTmpdir;
    }
  }

  function modeOf(targetPath) {
    return fs.statSync(targetPath).mode & 0o777;
  }

  function runCmd(args, { env = {}, input = '', cwd = repoRoot } = {}) {
    const mergedEnv = { ...process.env, ...env };
    for (const [key, value] of Object.entries(mergedEnv)) {
      if (value === undefined) {
        delete mergedEnv[key];
      }
    }

    return spawnSync(process.execPath, [cmdPath, ...args], {
      cwd,
      env: mergedEnv,
      input,
      encoding: 'utf8',
    });
  }

  function expectedHash(socketPath) {
    return createHash('sha1').update(socketPath).digest('hex').slice(0, 6);
  }

  async function waitForCondition(check, { timeoutMs = 2000, intervalMs = 25 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (check()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`condition not met within ${timeoutMs}ms`);
  }

  afterEach(() => {
    restoreTmpdir();
    for (const targetPath of cleanupPaths) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    cleanupPaths.clear();
  });

  describe('claude events primitives', () => {
    test('computes socket hashes and whoami keys', () => {
      const socketPath = '/tmp/tmux-test/default';
      expect(computeSocketHash(`${socketPath},123,0`)).toBe(expectedHash(socketPath));
      expect(computeSocketHash('')).toBe('local');
      expect(computeKey({ TMUX: `${socketPath},123,0`, TMUX_PANE: '%9', PID: '777' })).toBe(
        `${expectedHash(socketPath)}:%9`,
      );
      expect(computeKey({ PID: '777' })).toBe('local-777');
    });

    test('resolves keys via env pane, registry, then session fallback with warn', () => {
      const tmpdir = setTmpdir(makeTempDir('claude-events-resolve-'));
      const socketPath = '/tmp/tmux-registry/default';
      const socketHash = expectedHash(socketPath);
      const root = eventsRoot(socketHash);

      writeSessionRegistry(root, 'session-1', {
        session_id: 'session-1',
        tmux_pane: '%44',
        socket: socketPath,
        started_at: '2026-04-17T00:00:00.000Z',
      });

      expect(resolveSocketHash({ session_id: 'session-1' }, { TMUX: '', TMUX_PANE: '' })).toBe(socketHash);
      expect(resolveKey({ session_id: 'session-1' }, { TMUX: '', TMUX_PANE: '' })).toBe(`${socketHash}:%44`);
      expect(resolveKey({ session_id: 'session-1' }, { TMUX: `${socketPath},1,0`, TMUX_PANE: '%45' })).toBe(
        `${socketHash}:%45`,
      );

      const warnings = [];
      expect(
        resolveKey(
          { session_id: 'missing-session' },
          { TMUX: `${socketPath},1,0`, TMUX_PANE: '' },
          (message) => warnings.push(message),
        ),
      ).toBe(`${socketHash}:session-missing-session`);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('missing-session');

      expect(tmpdir).toContain('claude-events-resolve-');
    });

    test('appendEvent, cursor, registry keep required permissions regardless of umask', () => {
      const tmpdir = setTmpdir(makeTempDir('claude-events-perms-'));
      const socketHash = expectedHash('/tmp/tmux-perms/default');
      const root = eventsRoot(socketHash);
      const logFile = logPath(root);
      const consumerKey = `${socketHash}:%2`;
      const cursorFile = cursorPath(root, consumerKey);
      const registryFile = sessionRegistryPath(root, 'session-2');
      const previousUmask = process.umask(0o077);

      try {
        writeCursor(root, consumerKey, 13);
        writeSessionRegistry(root, 'session-2', {
          session_id: 'session-2',
          tmux_pane: '%2',
          socket: '/tmp/tmux-perms/default',
          started_at: '2026-04-17T00:00:00.000Z',
        });
        appendEvent(root, {
          key: consumerKey,
          ts: '2026-04-17T00:00:00.000Z',
          hook_event_name: 'Stop',
          session_id: 'session-2',
        });
      } finally {
        process.umask(previousUmask);
      }

      expect(modeOf(root)).toBe(0o700);
      expect(modeOf(logFile)).toBe(0o600);
      expect(modeOf(cursorFile)).toBe(0o600);
      expect(modeOf(registryFile)).toBe(0o600);
      expect(readCursor(root, consumerKey)).toBe(13);
      expect(tmpdir).toContain('claude-events-perms-');
    });

    test('tailLog returns per-line offsets and falls back to polling when watch fails', async () => {
      const tmpdir = setTmpdir(makeTempDir('claude-events-tail-'));
      const root = eventsRoot('tail');
      appendEvent(root, {
        key: 'tail:%1',
        ts: '2026-04-17T00:00:00.000Z',
        hook_event_name: 'Stop',
        session_id: 'session-tail-1',
      });

      const initial = [];
      for await (const entry of tailLog(root, 0)) {
        initial.push(JSON.parse(entry.line));
      }
      expect(initial).toHaveLength(1);
      expect(initial[0].session_id).toBe('session-tail-1');

      const abortController = new AbortController();
      const yielded = [];
      const iterator = (async () => {
        try {
          for await (const entry of tailLog(root, 0, {
            follow: true,
            signal: abortController.signal,
            watchFactory() {
              throw new Error('watch failed');
            },
          })) {
            yielded.push({
              event: JSON.parse(entry.line),
              offset: entry.offset,
            });
            if (yielded.length === 2) {
              abortController.abort();
            }
          }
        } catch (error) {
          if (error?.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      appendEvent(root, {
        key: 'tail:%2',
        ts: '2026-04-17T00:00:01.000Z',
        hook_event_name: 'Notification',
        session_id: 'session-tail-2',
      });
      await waitForCondition(() => yielded.length >= 2);
      appendEvent(root, {
        key: 'tail:%3',
        ts: '2026-04-17T00:00:02.000Z',
        hook_event_name: 'SubagentStop',
        session_id: 'session-tail-3',
      });

      await iterator;

      expect(yielded.map((entry) => entry.event.session_id)).toEqual([
        'session-tail-1',
        'session-tail-2',
      ]);
      expect(yielded[0].offset).toBeLessThan(yielded[1].offset);
      expect(yielded[0].offset).toBeLessThan(fs.statSync(logPath(root)).size);
      expect(tmpdir).toContain('claude-events-tail-');
    });

    test('tailLog resets offset after log truncate and continues yielding', async () => {
      const tmpdir = setTmpdir(makeTempDir('claude-events-rotate-'));
      const root = eventsRoot('rotate');
      appendEvent(root, {
        key: 'rotate:%1',
        ts: '2026-04-17T00:00:00.000Z',
        hook_event_name: 'Stop',
        session_id: 'rotate-initial',
      });

      const initialSize = fs.statSync(logPath(root)).size;
      const abortController = new AbortController();
      const yielded = [];
      let sawTruncate = false;
      const iterator = (async () => {
        try {
          for await (const entry of tailLog(root, initialSize, {
            follow: true,
            signal: abortController.signal,
            watchFactory() {
              throw new Error('watch failed');
            },
            statSync(filePath) {
              const stat = fs.statSync(filePath);
              if (stat.size < initialSize) {
                sawTruncate = true;
              }
              return stat;
            },
            setIntervalFn(handler) {
              return setInterval(handler, 10);
            },
            clearIntervalFn(timer) {
              clearInterval(timer);
            },
          })) {
            yielded.push(JSON.parse(entry.line));
            abortController.abort();
          }
        } catch (error) {
          if (error?.name !== 'AbortError') {
            throw error;
          }
        }
      })();

      fs.truncateSync(logPath(root), 0);
      await waitForCondition(() => sawTruncate);
      appendEvent(root, {
        key: 'rotate:%2',
        ts: '2026-04-17T00:00:01.000Z',
        hook_event_name: 'Notification',
        session_id: 'rotate-after-truncate',
      });

      await waitForCondition(() => yielded.length === 1);
      await iterator;

      expect(yielded[0].session_id).toBe('rotate-after-truncate');
      expect(tmpdir).toContain('claude-events-rotate-');
    });

    test('readCursor and readSessionRegistry silently fall back on malformed files', () => {
      const tmpdir = setTmpdir(makeTempDir('claude-events-malformed-'));
      const root = eventsRoot('malformed');
      const key = 'malformed:%1';

      fs.mkdirSync(path.dirname(cursorPath(root, key)), { recursive: true });
      fs.mkdirSync(path.dirname(sessionRegistryPath(root, 'session-bad')), { recursive: true });
      fs.writeFileSync(cursorPath(root, key), 'not-a-number\n');
      fs.writeFileSync(sessionRegistryPath(root, 'session-bad'), '{bad json\n');

      expect(readCursor(root, key)).toBe(0);
      expect(readSessionRegistry(root, 'session-bad')).toBeNull();
      expect(tmpdir).toContain('claude-events-malformed-');
    });

    test('latestActivityMtimeMs uses log file mtime and falls back to nested files', () => {
      const tmpdir = setTmpdir(makeTempDir('claude-events-activity-'));
      const root = eventsRoot('activity');
      appendEvent(root, {
        key: 'activity:%1',
        ts: '2026-04-17T00:00:00.000Z',
        hook_event_name: 'Stop',
        session_id: 'activity-session',
      });

      const logFile = logPath(root);
      const oldMs = Date.now() - 5 * 24 * 60 * 60 * 1000;
      fs.utimesSync(logFile, oldMs / 1000, oldMs / 1000);
      fs.utimesSync(root, Date.now() / 1000, Date.now() / 1000);
      expect(latestActivityMtimeMs(root)).toBeCloseTo(oldMs, -2);

      fs.rmSync(logFile);
      const nestedFile = path.join(root, 'sessions', 'nested.json');
      fs.mkdirSync(path.dirname(nestedFile), { recursive: true });
      fs.writeFileSync(nestedFile, '{}\n');
      const newerMs = Date.now() - 2 * 24 * 60 * 60 * 1000;
      fs.utimesSync(nestedFile, newerMs / 1000, newerMs / 1000);
      expect(latestActivityMtimeMs(root)).toBeCloseTo(newerMs, -2);
      expect(tmpdir).toContain('claude-events-activity-');
    });

    test('extractLastAssistantMessage skips tool_use-only and thinking-only entries, preserves newlines, truncates long text', () => {
      const tmpdir = setTmpdir(makeTempDir('claude-events-extract-'));
      const transcriptPath = path.join(tmpdir, 'transcript.jsonl');
      const longText = 'a'.repeat(3000);
      const entries = [
        { type: 'user', message: { role: 'user', content: 'hi' }, uuid: 'u1' },
        {
          type: 'assistant',
          uuid: 'a1',
          timestamp: '2026-04-17T10:00:00.000Z',
          message: { role: 'assistant', content: [{ type: 'thinking', thinking: '...' }] },
        },
        {
          type: 'assistant',
          uuid: 'a2',
          timestamp: '2026-04-17T10:00:01.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'line1\nline2\nline3' }] },
        },
        {
          type: 'assistant',
          uuid: 'a3',
          timestamp: '2026-04-17T10:00:02.000Z',
          message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'X', input: {} }] },
        },
        {
          type: 'assistant',
          uuid: 'a4',
          timestamp: '2026-04-17T10:00:03.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: longText }] },
        },
      ];
      fs.writeFileSync(transcriptPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

      const result = extractLastAssistantMessage(transcriptPath, { maxChars: 50 });
      expect(result).not.toBeNull();
      expect(result.uuid).toBe('a4');
      expect(result.text_full_length).toBe(3000);
      expect(result.text_snippet.endsWith('...[truncated]')).toBe(true);
      expect(result.text_snippet.length).toBe(50 + '...[truncated]'.length);

      // Remove the last (tool_use_only after text a4) so extractor must skip a3 and land on a2
      const truncated = entries.slice(0, 4);
      fs.writeFileSync(transcriptPath, truncated.map((e) => JSON.stringify(e)).join('\n') + '\n');
      const skipped = extractLastAssistantMessage(transcriptPath);
      expect(skipped.uuid).toBe('a2');
      expect(skipped.text_snippet).toBe('line1\nline2\nline3');  // newlines preserved
      expect(skipped.text_full_length).toBe('line1\nline2\nline3'.length);

      // Missing file → null
      expect(extractLastAssistantMessage('/no/such/path.jsonl')).toBeNull();
      // maxChars=0 disables
      expect(extractLastAssistantMessage(transcriptPath, { maxChars: 0 })).toBeNull();

      expect(tmpdir).toContain('claude-events-extract-');
    });
  });

  describe('hookbus.js integration', () => {
    test('event command respects director and disable no-op guards', () => {
      const tmpdir = setTmpdir(makeTempDir('claude-events-guards-'));
      const socketPath = '/tmp/tmux-guards/default';
      const env = {
        TMPDIR: tmpdir,
        TMUX: `${socketPath},1,0`,
        TMUX_PANE: '%1',
        CLAUDE_EVENT_DISABLE: '1',
      };
      const input = JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'guard-session',
        transcript_path: '/tmp/transcript',
        cwd: '/workspace',
      });

      const disabled = runCmd(['event'], { env, input });
      expect(disabled.status).toBe(0);
      expect(fs.existsSync(logPath(eventsRoot(expectedHash(socketPath))))).toBe(false);

      const director = runCmd(['event'], {
        env: {
          TMPDIR: tmpdir,
          TMUX: `${socketPath},1,0`,
          TMUX_PANE: '%1',
          CLAUDE_EVENT_DISABLE: undefined,
          CLAUDE_EVENT_ROLE: 'director',
        },
        input,
      });
      expect(director.status).toBe(0);
      expect(fs.existsSync(logPath(eventsRoot(expectedHash(socketPath))))).toBe(false);
    });

    test('whoami prints socket hash and local pid fallback', () => {
      const socketPath = '/tmp/tmux-whoami/default';
      const withPane = runCmd(['whoami'], {
        env: {
          TMUX: `${socketPath},1,0`,
          TMUX_PANE: '%7',
        },
      });
      expect(withPane.stdout.trim()).toBe(`${expectedHash(socketPath)}:%7`);

      const local = runCmd(['whoami'], {
        env: {
          TMUX: '',
          TMUX_PANE: '',
        },
      });
      expect(local.stdout.trim()).toMatch(/^local-\d+$/);
    });

    test('event writes parseable NDJSON, SessionStart registry fallback works, and missing registry warns', () => {
      const tmpdir = setTmpdir(makeTempDir('claude-events-event-'));
      const socketPathA = '/tmp/tmux-a/default';
      const socketPathB = '/tmp/tmux-b/default';
      const hashA = expectedHash(socketPathA);
      const hashB = expectedHash(socketPathB);

      const sessionStart = runCmd(['event'], {
        env: {
          TMPDIR: tmpdir,
          TMUX: `${socketPathA},1,0`,
          TMUX_PANE: '%11',
          CLAUDE_EVENT_DISABLE: undefined,
        },
        input: JSON.stringify({
          hook_event_name: 'SessionStart',
          session_id: 'session-registry',
          cwd: '/workspace',
        }),
      });
      expect(sessionStart.status).toBe(0);

      const stopViaRegistry = runCmd(['event'], {
        env: {
          TMPDIR: tmpdir,
          TMUX: '',
          TMUX_PANE: '',
          CLAUDE_EVENT_DISABLE: undefined,
        },
        input: JSON.stringify({
          hook_event_name: 'Stop',
          session_id: 'session-registry',
          transcript_path: '/tmp/transcript-a',
          cwd: '/workspace',
        }),
      });
      expect(stopViaRegistry.status).toBe(0);

      const fallbackStop = runCmd(['event'], {
        env: {
          TMPDIR: tmpdir,
          TMUX: `${socketPathB},2,0`,
          TMUX_PANE: '',
          CLAUDE_EVENT_DISABLE: undefined,
        },
        input: JSON.stringify({
          hook_event_name: 'Stop',
          session_id: 'session-missing',
          transcript_path: '/tmp/transcript-b',
          cwd: '/workspace',
        }),
      });
      expect(fallbackStop.status).toBe(0);
      expect(fallbackStop.stderr).toContain('session-missing');

      const logA = fs
        .readFileSync(logPath(eventsRoot(hashA)), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(logA).toHaveLength(1);
      expect(logA[0]).toMatchObject({
        key: `${hashA}:%11`,
        hook_event_name: 'Stop',
        session_id: 'session-registry',
      });

      const logB = fs
        .readFileSync(logPath(eventsRoot(hashB)), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(logB[0]).toMatchObject({
        key: `${hashB}:session-session-missing`,
        hook_event_name: 'Stop',
        session_id: 'session-missing',
      });
    });

    test('event embeds last_message from transcript_path, honors HOOKBUS_LAST_MESSAGE_MAX', () => {
      const tmpdir = setTmpdir(makeTempDir('claude-events-lastmsg-'));
      const socketPath = '/tmp/tmux-lastmsg/default';
      const hash = expectedHash(socketPath);
      const transcriptPath = path.join(tmpdir, 'transcript.jsonl');
      const messageText = 'hello\nmulti-line\nmessage';
      fs.writeFileSync(
        transcriptPath,
        [
          { type: 'user', message: { role: 'user', content: 'q' }, uuid: 'u1' },
          {
            type: 'assistant',
            uuid: 'a-final',
            timestamp: '2026-04-17T12:00:00.000Z',
            message: { role: 'assistant', content: [{ type: 'text', text: messageText }] },
          },
        ].map((e) => JSON.stringify(e)).join('\n') + '\n',
      );

      const result = runCmd(['event'], {
        env: {
          TMPDIR: tmpdir,
          TMUX: `${socketPath},1,0`,
          TMUX_PANE: '%5',
          CLAUDE_EVENT_DISABLE: undefined,
        },
        input: JSON.stringify({
          hook_event_name: 'Stop',
          session_id: 'lastmsg-session',
          transcript_path: transcriptPath,
          cwd: '/workspace',
        }),
      });
      expect(result.status).toBe(0);

      const logLines = fs
        .readFileSync(logPath(eventsRoot(hash)), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(logLines).toHaveLength(1);
      expect(logLines[0].last_message).toMatchObject({
        role: 'assistant',
        uuid: 'a-final',
        text_full_length: messageText.length,
        text_snippet: messageText,  // newlines preserved via JSON escape round-trip
      });

      // HOOKBUS_LAST_MESSAGE_MAX=0 disables extraction
      const disabled = runCmd(['event'], {
        env: {
          TMPDIR: tmpdir,
          TMUX: `${socketPath},1,0`,
          TMUX_PANE: '%6',
          CLAUDE_EVENT_DISABLE: undefined,
          HOOKBUS_LAST_MESSAGE_MAX: '0',
        },
        input: JSON.stringify({
          hook_event_name: 'Stop',
          session_id: 'lastmsg-session-2',
          transcript_path: transcriptPath,
          cwd: '/workspace',
        }),
      });
      expect(disabled.status).toBe(0);
      const lines2 = fs.readFileSync(logPath(eventsRoot(hash)), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      expect(lines2).toHaveLength(2);
      expect(lines2[1].last_message).toBeNull();
    });

    test('pull filters to include allow-list, skips malformed lines without replay, and keeps sockets isolated', () => {
      const tmpdir = setTmpdir(makeTempDir('claude-events-pull-'));
      const socketPathA = '/tmp/tmux-pull-a/default';
      const socketPathB = '/tmp/tmux-pull-b/default';
      const hashA = expectedHash(socketPathA);
      const hashB = expectedHash(socketPathB);
      const rootA = eventsRoot(hashA);
      const rootB = eventsRoot(hashB);

      appendEvent(rootA, {
        key: `${hashA}:%1`,
        ts: '2026-04-17T00:00:00.000Z',
        hook_event_name: 'Stop',
        session_id: 'self-session',
      });
      appendEvent(rootA, {
        key: `${hashA}:%2`,
        ts: '2026-04-17T00:00:01.000Z',
        hook_event_name: 'Notification',
        session_id: 'other-session',
      });
      fs.appendFileSync(logPath(rootA), '{not json}\n');
      appendEvent(rootB, {
        key: `${hashB}:%2`,
        ts: '2026-04-17T00:00:02.000Z',
        hook_event_name: 'Notification',
        session_id: 'other-socket-session',
      });

      const firstPull = runCmd(['pull', '--include', `${hashA}:%2`, '--cursor', `${hashA}:%1`], {
        env: {
          TMPDIR: tmpdir,
        },
      });
      expect(firstPull.status).toBe(0);
      expect(firstPull.stderr).toContain('warning: skipping invalid log line');
      const firstOutput = firstPull.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
      expect(firstOutput).toHaveLength(1);
      expect(firstOutput[0].session_id).toBe('other-session');
      expect(readCursor(rootA, `${hashA}:%1`)).toBe(fs.statSync(logPath(rootA)).size);

      const secondPull = runCmd(['pull', '--include', `${hashA}:%2`, '--cursor', `${hashA}:%1`], {
        env: {
          TMPDIR: tmpdir,
        },
      });
      expect(secondPull.status).toBe(0);
      expect(secondPull.stdout.trim()).toBe('');
      expect(secondPull.stderr.trim()).toBe('');
      expect(fs.readFileSync(logPath(rootB), 'utf8')).toContain('other-socket-session');
    });

    test('pull --follow streams new events until SIGTERM', async () => {
      const tmpdir = setTmpdir(makeTempDir('claude-events-follow-'));
      const socketPath = '/tmp/tmux-follow/default';
      const hash = expectedHash(socketPath);
      const root = eventsRoot(hash);

      appendEvent(root, {
        key: `${hash}:%1`,
        ts: '2026-04-17T00:00:00.000Z',
        hook_event_name: 'Stop',
        session_id: 'self-follow',
      });

      const child = spawn(process.execPath, [cmdPath, 'pull', '--include', `${hash}:%2`, '--cursor', `${hash}:%1`, '--follow'], {
        cwd: repoRoot,
        env: (() => {
          const nextEnv = { ...process.env, TMPDIR: tmpdir };
          delete nextEnv.CLAUDE_EVENT_DISABLE;
          return nextEnv;
        })(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });

      appendEvent(root, {
        key: `${hash}:%2`,
        ts: '2026-04-17T00:00:01.000Z',
        hook_event_name: 'Notification',
        session_id: 'other-follow',
      });
      await waitForCondition(() => stdout.includes('other-follow'));
      child.kill('SIGTERM');

      const exitCode = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', resolve);
      });

      expect(exitCode).toBe(0);
      const lines = stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
      expect(lines).toHaveLength(1);
      expect(lines[0].session_id).toBe('other-follow');
    });

    test('cleanup uses log mtime, supports dry-run, and deletes matching roots', () => {
      const tmpdir = setTmpdir(makeTempDir('claude-events-cleanup-'));
      const oldRoot = eventsRoot('old');
      const freshRoot = eventsRoot('fresh');

      appendEvent(oldRoot, {
        key: 'old:%1',
        ts: '2026-04-17T00:00:00.000Z',
        hook_event_name: 'Stop',
        session_id: 'old-session',
      });
      appendEvent(freshRoot, {
        key: 'fresh:%1',
        ts: '2026-04-17T00:00:00.000Z',
        hook_event_name: 'Stop',
        session_id: 'fresh-session',
      });

      const oldMs = Date.now() - 5 * 24 * 60 * 60 * 1000;
      fs.utimesSync(logPath(oldRoot), oldMs / 1000, oldMs / 1000);
      fs.utimesSync(oldRoot, Date.now() / 1000, Date.now() / 1000);

      const dryRun = runCmd(['cleanup', '--older-than', '3', '--dry-run'], {
        env: { TMPDIR: tmpdir },
      });
      expect(dryRun.status).toBe(0);
      expect(dryRun.stdout).toContain(oldRoot);
      expect(dryRun.stdout).not.toContain(freshRoot);
      expect(fs.existsSync(oldRoot)).toBe(true);

      const cleanup = runCmd(['cleanup', '--older-than', '3'], {
        env: { TMPDIR: tmpdir },
      });
      expect(cleanup.status).toBe(0);
      expect(cleanup.stdout).toContain(oldRoot);
      expect(fs.existsSync(oldRoot)).toBe(false);
      expect(fs.existsSync(freshRoot)).toBe(true);
    });

    test('append remains parseable across concurrent large writes', async () => {
      const tmpdir = setTmpdir(makeTempDir('claude-events-atomic-'));
      const socketPath = '/tmp/tmux-atomic/default';
      const hash = expectedHash(socketPath);
      const root = eventsRoot(hash);
      const payload = 'x'.repeat(6000);
      const workers = [];

      for (let index = 0; index < 24; index += 1) {
        const script = `
          import { appendEvent } from ${JSON.stringify(cmdPath)};
          appendEvent(${JSON.stringify(root)}, {
            key: ${JSON.stringify(`${hash}:%${index % 2 === 0 ? 1 : 2}`)},
            ts: new Date().toISOString(),
            hook_event_name: 'Stop',
            session_id: ${JSON.stringify(`atomic-${index}`)},
            payload: ${JSON.stringify(payload)}
          });
        `;
        workers.push(
          new Promise((resolve, reject) => {
            const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
              cwd: repoRoot,
              env: {
                ...process.env,
                TMPDIR: tmpdir,
              },
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            child.on('error', reject);
            child.on('exit', (code) => {
              if (code === 0) {
                resolve();
                return;
              }
              reject(new Error(`worker exited with code ${code}`));
            });
          }),
        );
      }

      await Promise.all(workers);

      const lines = fs.readFileSync(logPath(root), 'utf8').trim().split('\n');
      expect(lines).toHaveLength(24);
      expect(lines.every((line) => JSON.parse(line).payload === payload)).toBe(true);
    });
  });
}
