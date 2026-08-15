import pc from "picocolors";
import prompts from "prompts";
import fs from "fs-extra";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findGitRoot, isWorkingTreeClean } from "../lib/git.js";
import { packageTemplateDir, packageVersionFile } from "../lib/paths.js";
import {
  planUpdate,
  pruneNoopActions,
  planSummary,
  renderPlan,
  executePlan,
  type Action,
} from "../lib/wire.js";

export interface UpdateOptions {
  yes?: boolean;
  force?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

function readPackageVersion(): string {
  return readFileSync(packageVersionFile(), "utf8").trim();
}

export async function runUpdate(opts: UpdateOptions): Promise<number> {
  if (process.platform === "win32") {
    console.error(
      pc.red(
        "hstack update does not yet support Windows (symlinks need admin / developer mode). Tracked for v2.",
      ),
    );
    return 2;
  }

  // 1. Precondition: cwd inside a git repo
  const cwd = process.cwd();
  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    console.error(
      pc.red("Not inside a git repository. hstack update must run from a git repo."),
    );
    return 2;
  }

  // 2. Precondition: <consumer>/hstack/ exists (i.e. init has been run)
  const consumerHstack = resolve(gitRoot, "hstack");
  if (!(await fs.pathExists(consumerHstack))) {
    console.error(
      pc.red(`${consumerHstack} does not exist. Run \`npx hstack init\` first.`),
    );
    return 2;
  }

  // 3. Precondition: working tree clean (unless --force)
  if (!opts.force) {
    const clean = await isWorkingTreeClean(gitRoot);
    if (!clean) {
      console.error(
        pc.red(
          "Working tree is not clean. Commit or stash your changes, or re-run with --force.",
        ),
      );
      return 2;
    }
  }

  // 4. Compute plan, then prune actions that would be no-ops at execute time.
  const templateDir = packageTemplateDir();
  const newVersion = readPackageVersion();
  const rawActions = await planUpdate(gitRoot, templateDir, newVersion);
  const actions = await pruneNoopActions(rawActions, newVersion);

  // 5. Detect installed version (best-effort)
  const installedVersionFile = resolve(consumerHstack, "VERSION");
  const installedVersion = (await fs.pathExists(installedVersionFile))
    ? (await fs.readFile(installedVersionFile, "utf8")).trim()
    : "unknown";

  // 6. Short-circuit if nothing to do
  if (actions.length === 0) {
    console.log(
      pc.green(`Already up to date (v${newVersion}).`),
    );
    return 0;
  }

  // 7. Render plan
  const summary = planSummary(actions);
  console.log(
    pc.bold(`hstack update: v${installedVersion} -> v${newVersion}`),
  );
  console.log("");
  renderSummary(summary);
  console.log("");

  if (
    opts.verbose ||
    summary["remove-file"] ||
    summary["remove-symlink"] ||
    summary["migrate-kernel-filename"]
  ) {
    console.log(pc.dim("Detail:"));
    console.log(filterDetailedActions(actions, opts.verbose ?? false, gitRoot));
    console.log("");
  }

  if (opts.dryRun) {
    console.log(pc.dim("Dry run — no changes made."));
    return 0;
  }

  // 8. Confirm
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

  // 9. Execute
  try {
    await executePlan(actions);
  } catch (err) {
    console.error(
      pc.red(`update failed: ${err instanceof Error ? err.message : String(err)}`),
    );
    console.error(
      pc.dim(
        "Partial state may exist. Inspect with `git status`; revert with `git restore`.",
      ),
    );
    return 1;
  }

  console.log("");
  console.log(pc.green(`Updated to v${newVersion}.`));
  console.log("Review with " + pc.cyan("git diff") + " and commit when satisfied.");
  return 0;
}

function renderSummary(summary: Record<string, number>): void {
  const fmt = (label: string, n: number, color: (s: string) => string) =>
    n > 0 ? `  ${color(`${n} ${label}`)}` : null;

  const lines = [
    fmt(
      "kernel rename migration, CLAUDE.md -> KERNEL.md (ADR-0010)",
      summary["migrate-kernel-filename"] ?? 0,
      pc.cyan,
    ),
    fmt("framework file(s) added", summary["add-file"] ?? 0, pc.green),
    fmt("framework file(s) modified", summary["overwrite-file"] ?? 0, pc.yellow),
    fmt("framework file(s) removed", summary["remove-file"] ?? 0, pc.red),
    fmt("symlink(s) added", summary["symlink"] ?? 0, pc.green),
    fmt("symlink(s) removed", summary["remove-symlink"] ?? 0, pc.red),
  ].filter(Boolean);

  if (lines.length === 0) {
    console.log(pc.dim("  (no file-level changes; idempotent checks only)"));
  } else {
    for (const l of lines) console.log(l);
  }
}

function filterDetailedActions(
  actions: Action[],
  verbose: boolean,
  consumerRoot: string,
): string {
  const interesting = actions.filter((a) =>
    verbose
      ? true
      : a.kind === "remove-file" ||
        a.kind === "remove-symlink" ||
        a.kind === "migrate-kernel-filename",
  );
  return renderPlan(interesting, consumerRoot);
}
