import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export function runDoctor({ repoPath }) {
  const checks = [
    commandCheck("node", ["--version"], "Node.js"),
    commandCheck("git", ["--version"], "git"),
    commandCheck("uv", ["--version"], "uv"),
    commandCheck("codex", ["--version"], "Codex CLI"),
    commandCheck("claude", ["--version"], "Claude Code"),
    codexAuthCheck(),
    claudeAuthCheck(),
    envCheck(repoPath),
    gitRepoCheck(repoPath)
  ];
  const status = checks.some((check) => check.status === "fail") ? "fail" : checks.some((check) => check.status === "warn") ? "warn" : "ok";
  return { status, checks };
}

export function formatDoctor(result) {
  return [
    `Doctor: ${result.status}`,
    ...result.checks.map((check) => `[${check.status}] ${check.name}: ${check.message}`)
  ].join("\n");
}

function commandCheck(command, args, name) {
  const result = run(command, args);
  return {
    name,
    status: result.status === 0 ? "ok" : "fail",
    message: result.status === 0 ? firstLine(result.stdout || result.stderr) : firstLine(result.stderr || result.stdout || result.error?.message || `${command} not available`)
  };
}

function codexAuthCheck() {
  const result = run("codex", ["login", "status"]);
  return {
    name: "Codex auth",
    status: result.status === 0 ? "ok" : "warn",
    message: result.status === 0 ? firstLine(result.stdout || result.stderr || "logged in") : firstLine(result.stderr || result.stdout || "not logged in")
  };
}

function claudeAuthCheck() {
  const result = run("claude", ["auth", "status"]);
  if (result.status !== 0) {
    return { name: "Claude auth", status: "warn", message: firstLine(result.stderr || result.stdout || "auth status unavailable") };
  }
  try {
    const auth = JSON.parse(result.stdout);
    return {
      name: "Claude auth",
      status: auth.loggedIn ? "ok" : "warn",
      message: `loggedIn=${Boolean(auth.loggedIn)} authMethod=${auth.authMethod ?? "unknown"} apiProvider=${auth.apiProvider ?? "unknown"} subscription=${auth.subscriptionType ?? "unknown"}`
    };
  } catch {
    return { name: "Claude auth", status: "ok", message: firstLine(result.stdout) };
  }
}

function envCheck(repoPath) {
  const path = join(repoPath, ".env");
  if (!existsSync(path)) {
    return { name: ".env OPENAI_API_KEY", status: "warn", message: ".env not found" };
  }
  const text = readFileSync(path, "utf8");
  const found = /^OPENAI_API_KEY=.+/m.test(text);
  return { name: ".env OPENAI_API_KEY", status: found ? "ok" : "warn", message: found ? "present" : "missing" };
}

function gitRepoCheck(repoPath) {
  const result = run("git", ["rev-parse", "--show-toplevel"], { cwd: repoPath });
  return {
    name: "git repository",
    status: result.status === 0 ? "ok" : "fail",
    message: result.status === 0 ? firstLine(result.stdout) : firstLine(result.stderr || "not a git repository")
  };
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    text: true,
    encoding: "utf8",
    timeout: 5000
  });
}

function firstLine(text) {
  return String(text ?? "").trim().split(/\r?\n/)[0] || "(empty)";
}
