#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pc from "picocolors";

const __dirname = dirname(fileURLToPath(import.meta.url));

// VERSION ships at the package root, one level up from dist/
function readVersion(): string {
  try {
    return readFileSync(resolve(__dirname, "..", "VERSION"), "utf8").trim();
  } catch {
    return "unknown";
  }
}

const program = new Command();

program
  .name("hstack")
  .description(
    "Spec-driven engineering workflow for Claude Code. See https://github.com/hugoganet/hstack",
  )
  .version(readVersion(), "-v, --version", "print hstack version");

program
  .command("init")
  .description("Install hstack into the current repo (forthcoming)")
  .action(() => {
    console.error(pc.yellow("hstack init is not yet implemented."));
    console.error(
      pc.dim(
        "Tracked in CHANGELOG. For now, vendor the framework manually — see README.md.",
      ),
    );
    process.exit(2);
  });

program
  .command("update")
  .description("Sync framework files to the latest version (forthcoming)")
  .action(() => {
    console.error(pc.yellow("hstack update is not yet implemented."));
    process.exit(2);
  });

program
  .command("doctor")
  .description("Verify installation health (forthcoming)")
  .action(() => {
    console.error(pc.yellow("hstack doctor is not yet implemented."));
    process.exit(2);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(pc.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
