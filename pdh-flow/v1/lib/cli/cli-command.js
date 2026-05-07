import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(dirname(here));
const sourceCliPath = resolve(root, "src/cli.ts");
const sourceCliIndexPath = resolve(root, "src/cli/index.ts");
const publicCliName = "pdh-flow";
export function runtimeCliCommand() {
    const override = process.env.PDH_FLOW_CLI?.trim();
    if (override) {
        return override;
    }
    if (isSourceCheckoutEntry(process.argv[1])) {
        return `${shellQuote(process.execPath)} ${shellQuote(resolve(process.argv[1]))}`;
    }
    return publicCliName;
}
export function publicRuntimeCliName() {
    return publicCliName;
}
function isSourceCheckoutEntry(entryPath) {
    if (!entryPath) {
        return false;
    }
    if (!existsSync(join(root, ".git"))) {
        return false;
    }
    const resolvedEntry = resolve(entryPath);
    return resolvedEntry === sourceCliPath || resolvedEntry === sourceCliIndexPath;
}
function shellQuote(value) {
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
        return value;
    }
    return `'${value.replaceAll("'", "'\\''")}'`;
}
