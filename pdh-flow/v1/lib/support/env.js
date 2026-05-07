import { readFileSync, existsSync } from "node:fs";
export function loadDotEnv(path = ".env") {
    if (!existsSync(path)) {
        return [];
    }
    const loaded = [];
    const text = readFileSync(path, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
            continue;
        }
        const eq = line.indexOf("=");
        if (eq <= 0) {
            continue;
        }
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) {
            process.env[key] = value;
            loaded.push(key);
        }
    }
    return loaded;
}
