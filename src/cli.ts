#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import pc from "picocolors";
import { runInit } from "./commands/init.js";
import { runUpdate } from "./commands/update.js";
import { runDoctor } from "./commands/doctor.js";
import { packageVersionFile } from "./lib/paths.js";

function readVersion(): string {
  try {
    return readFileSync(packageVersionFile(), "utf8").trim();
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
  .description("Install hstack into the current repo")
  .option("-y, --yes", "skip the confirmation prompt")
  .option("--force", "proceed even if the working tree is dirty")
  .option("--dry-run", "print the plan without making changes")
  .action(async (opts: { yes?: boolean; force?: boolean; dryRun?: boolean }) => {
    const code = await runInit(opts);
    process.exit(code);
  });

program
  .command("update")
  .description("Sync framework files to the latest version, preserving user content")
  .option("-y, --yes", "skip the confirmation prompt")
  .option("--force", "proceed even if the working tree is dirty")
  .option("--dry-run", "print the plan without making changes")
  .option("--verbose", "list every file action in the plan")
  .action(async (opts: {
    yes?: boolean;
    force?: boolean;
    dryRun?: boolean;
    verbose?: boolean;
  }) => {
    const code = await runUpdate(opts);
    process.exit(code);
  });

program
  .command("doctor")
  .description("Verify hstack installation health (read-only)")
  .option("--verbose", "list every affected file in the report")
  .action(async (opts: { verbose?: boolean }) => {
    const code = await runDoctor(opts);
    process.exit(code);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(pc.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
