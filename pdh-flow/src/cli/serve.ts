// `pdh-flow serve` — launch the Web UI HTTP server against a worktree.
//
// Reads engine state from `<worktree>/.pdh-flow/runs/` and serves both the
// JSON API and the static frontend (web/index.html etc.).

import { resolve } from "node:path";
import { parseSubcommandArgs } from "./index.ts";
import { startWebServer } from "../web/server.ts";

export async function cmdServe(argv: string[]): Promise<void> {
  const { values } = parseSubcommandArgs(argv, {
    worktree: { type: "string" },
    port: { type: "string" },
    "static-dir": { type: "string" },
  });

  const worktreePath = (values.worktree as string | undefined)
    ? resolve(values.worktree as string)
    : process.cwd();

  const portRaw = values.port as string | undefined;
  const port = portRaw ? Number(portRaw) : 5170;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`--port must be a valid TCP port; got ${portRaw}`);
  }

  startWebServer({
    worktreePath,
    port,
    staticDir: values["static-dir"]
      ? resolve(values["static-dir"] as string)
      : undefined,
  });

  // Keep the process alive until the server is stopped.
  await new Promise<void>(() => {});
}
