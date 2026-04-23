import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REDACTED = "[REDACTED]";
const SECRET_NAME = /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_?KEY)$/i;
const SECRET_ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_?KEY))\s*=\s*("([^"]*)"|'([^']*)'|[^\s]+)/gi;
const KEY_PATTERNS = [
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g
];

export function createRedactor({ repoPath = process.cwd(), env = process.env } = {}) {
  const exactSecrets = collectExactSecrets({ repoPath, env });
  return (value) => redactSecrets(value, { exactSecrets });
}

export function redactSecrets(value, { exactSecrets = [] } = {}) {
  let text = String(value ?? "");
  for (const secret of exactSecrets) {
    text = text.split(secret).join(REDACTED);
  }
  text = text.replace(SECRET_ASSIGNMENT, (_match, name, rawValue) => {
    const quote = rawValue.startsWith("\"") ? "\"" : rawValue.startsWith("'") ? "'" : "";
    return `${name}=${quote}${REDACTED}${quote}`;
  });
  for (const pattern of KEY_PATTERNS) {
    text = text.replace(pattern, REDACTED);
  }
  return text;
}

function collectExactSecrets({ repoPath, env }) {
  const values = new Set();
  for (const [key, value] of Object.entries(env ?? {})) {
    if (SECRET_NAME.test(key)) {
      addSecret(values, value);
    }
  }
  const envPath = join(repoPath, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (parsed && SECRET_NAME.test(parsed.key)) {
        addSecret(values, parsed.value);
      }
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const eq = trimmed.indexOf("=");
  if (eq <= 0) {
    return null;
  }
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function addSecret(values, value) {
  const secret = String(value ?? "").trim();
  if (secret.length >= 8) {
    values.add(secret);
  }
}
