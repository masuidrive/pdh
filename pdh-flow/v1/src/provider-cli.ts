#!/usr/bin/env node
import { runProviderCli } from "./cli/provider-cli.ts";

try {
  await runProviderCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
