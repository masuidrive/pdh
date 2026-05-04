import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnyRecord } from "../types.ts";
import { CommandExecutionError, runCommandResult } from "../support/command.ts";

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
    status: result.ok ? "ok" : "fail",
    message: result.ok ? firstLine(result.stdout || result.stderr) : firstLine(new CommandExecutionError(result).message)
  };
}

function codexAuthCheck() {
  const result = run("codex", ["login", "status"]);
  return {
    name: "Codex auth",
    status: result.ok ? "ok" : "warn",
    message: result.ok ? firstLine(result.stdout || result.stderr || "logged in") : firstLine(new CommandExecutionError(result).message)
  };
}

function claudeAuthCheck() {
  const result = run("claude", ["auth", "status"]);
  if (!result.ok) {
    return { name: "Claude auth", status: "warn", message: firstLine(new CommandExecutionError(result).message) };
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
    status: result.ok ? "ok" : "fail",
    message: result.ok ? firstLine(result.stdout) : firstLine(new CommandExecutionError(result).message)
  };
}

function run(command: string, args: string[], options: AnyRecord = {}) {
  return runCommandResult(command, args, {
    cwd: options.cwd ?? process.cwd(),
    timeout: 5000
  });
}

function firstLine(text) {
  return String(text ?? "").trim().split(/\r?\n/)[0] || "(empty)";
}
