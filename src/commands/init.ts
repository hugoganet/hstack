import pc from "picocolors";
import prompts from "prompts";
import { readFileSync } from "node:fs";
import { findGitRoot, isWorkingTreeClean } from "../lib/git.js";
import { packageTemplateDir, packageVersionFile } from "../lib/paths.js";
import {
  planInit,
  renderPlan,
  validatePlan,
  executePlan,
} from "../lib/wire.js";

function readPackageVersion(): string {
  return readFileSync(packageVersionFile(), "utf8").trim();
}

export interface InitOptions {
  yes?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

export async function runInit(opts: InitOptions): Promise<number> {
  if (process.platform === "win32") {
    console.error(
      pc.red(
        "hstack init does not yet support Windows (symlinks need admin / developer mode). Tracked for v2.",
      ),
    );
    return 2;
  }

  // 1. Precondition: cwd is inside a git repo
  const cwd = process.cwd();
  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    console.error(
      pc.red(
        `Not inside a git repository. hstack init must run from the root of a git repo.`,
      ),
    );
    return 2;
  }
  if (gitRoot !== cwd) {
    console.error(
      pc.yellow(
        `Warning: running from ${cwd} but git root is ${gitRoot}. hstack will install at ${gitRoot}/hstack.`,
      ),
    );
  }

  // 2. Precondition: working tree is clean
  if (!opts.force) {
    const clean = await isWorkingTreeClean(gitRoot);
    if (!clean) {
      console.error(
        pc.red(
          `Working tree is not clean. Commit or stash your changes, or re-run with --force.`,
        ),
      );
      return 2;
    }
  }

  // 3. Compute plan
  const templateDir = packageTemplateDir();
  const version = readPackageVersion();
  const actions = await planInit(gitRoot, templateDir, version);

  // 4. Validate
  const blockers = await validatePlan(actions);
  if (blockers.length > 0) {
    console.error(pc.red("hstack init cannot proceed:"));
    for (const b of blockers) console.error(pc.red(`  - ${b}`));
    return 2;
  }

  // 5. Show plan
  console.log(pc.bold("hstack init will:"));
  console.log(renderPlan(actions, gitRoot));
  console.log("");

  if (opts.dryRun) {
    console.log(pc.dim("Dry run — no changes made."));
    return 0;
  }

  // 6. Confirm
  if (!opts.yes) {
    const { ok } = await prompts({
      type: "confirm",
      name: "ok",
      message: "Proceed?",
      initial: true,
    });
    if (!ok) {
      console.log(pc.dim("Cancelled."));
      return 2;
    }
  }

  // 7. Execute
  try {
    await executePlan(actions);
  } catch (err) {
    console.error(
      pc.red(
        `init failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    console.error(
      pc.dim(
        "Partial state may exist. Inspect with `git status`; revert with `git restore` and `rm -rf hstack/`.",
      ),
    );
    return 1;
  }

  // 8. Next steps
  console.log("");
  console.log(pc.green("hstack installed."));
  console.log("");
  console.log("Next steps:");
  console.log("  1. Review the changes: " + pc.cyan("git status"));
  console.log("  2. Commit:             " + pc.cyan("git add . && git commit -m 'chore: install hstack'"));
  console.log(
    "  3. Open Claude Code in this repo and run " +
      pc.cyan("/hstack:init") +
      " to populate hstack/context/.",
  );
  return 0;
}
