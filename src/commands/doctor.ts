import pc from "picocolors";
import fs from "fs-extra";
import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { findGitRoot } from "../lib/git.js";
import { packageTemplateDir, packageVersionFile } from "../lib/paths.js";
import { planUpdate, pruneNoopActions, type Action } from "../lib/wire.js";

export interface DoctorOptions {
  verbose?: boolean;
}

interface Finding {
  level: "warn" | "error";
  category: string;
  message: string;
  detail?: string;
}

function readPackageVersion(): string {
  return readFileSync(packageVersionFile(), "utf8").trim();
}

export async function runDoctor(opts: DoctorOptions): Promise<number> {
  const cwd = process.cwd();
  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    console.error(
      pc.red("Not inside a git repository. hstack doctor must run from a git repo."),
    );
    return 2;
  }

  const consumerHstack = resolve(gitRoot, "hstack");
  if (!(await fs.pathExists(consumerHstack))) {
    console.log(
      pc.yellow("hstack is not installed in this repo.") +
        " Run " +
        pc.cyan("npx hstack init") +
        " to install.",
    );
    return 1;
  }

  const templateDir = packageTemplateDir();
  const packageVersion = readPackageVersion();

  // Detect installed version
  const installedVersionFile = resolve(consumerHstack, "VERSION");
  const installedVersion = (await fs.pathExists(installedVersionFile))
    ? (await fs.readFile(installedVersionFile, "utf8")).trim()
    : null;

  // Reuse planUpdate + pruneNoopActions to discover drift
  const rawActions = await planUpdate(gitRoot, templateDir, packageVersion);
  const actions = await pruneNoopActions(rawActions, packageVersion);

  // Classify actions into findings
  const findings: Finding[] = [];

  // Version
  if (installedVersion === null) {
    findings.push({
      level: "warn",
      category: "version",
      message: `hstack/VERSION marker is missing (installed-version unknown; package is v${packageVersion})`,
    });
  } else if (installedVersion !== packageVersion) {
    findings.push({
      level: "warn",
      category: "version",
      message: `installed v${installedVersion}, package v${packageVersion} — run \`npx hstack update\``,
    });
  }

  const overwrites = actions.filter((a) => a.kind === "overwrite-file");
  if (overwrites.length > 0) {
    findings.push({
      level: "warn",
      category: "framework-drift",
      message: `${overwrites.length} framework file(s) differ from template`,
      detail: opts.verbose
        ? overwrites.map((a) => `    ${(a as Extract<Action, { kind: "overwrite-file" }>).relpath}`).join("\n")
        : undefined,
    });
  }

  const adds = actions.filter((a) => a.kind === "add-file");
  if (adds.length > 0) {
    findings.push({
      level: "warn",
      category: "framework-missing",
      message: `${adds.length} framework file(s) missing from hstack/`,
      detail: opts.verbose
        ? adds.map((a) => `    ${(a as Extract<Action, { kind: "add-file" }>).relpath}`).join("\n")
        : undefined,
    });
  }

  const stragglers = actions.filter((a) => a.kind === "remove-file");
  if (stragglers.length > 0) {
    findings.push({
      level: "warn",
      category: "framework-stale",
      message: `${stragglers.length} file(s) under hstack/ are not part of the framework`,
      detail: opts.verbose
        ? stragglers.map((a) => `    ${(a as Extract<Action, { kind: "remove-file" }>).relpath}`).join("\n")
        : undefined,
    });
  }

  const newLinks = actions.filter((a) => a.kind === "symlink");
  if (newLinks.length > 0) {
    findings.push({
      level: "error",
      category: "symlinks-missing",
      message: `${newLinks.length} skill/agents symlink(s) missing or pointing at wrong target`,
      detail: opts.verbose
        ? newLinks
            .map((a) => `    ${basename((a as Extract<Action, { kind: "symlink" }>).to)}`)
            .join("\n")
        : undefined,
    });
  }

  const orphanLinks = actions.filter((a) => a.kind === "remove-symlink");
  if (orphanLinks.length > 0) {
    findings.push({
      level: "warn",
      category: "symlinks-orphan",
      message: `${orphanLinks.length} symlink(s) point at skills not present in the framework`,
      detail: opts.verbose
        ? orphanLinks
            .map((a) => `    ${basename((a as Extract<Action, { kind: "remove-symlink" }>).to)}`)
            .join("\n")
        : undefined,
    });
  }

  const missingLines = actions.filter((a) => a.kind === "append-line");
  for (const a of missingLines) {
    const m = a as Extract<Action, { kind: "append-line" }>;
    const file = basename(m.file);
    findings.push({
      level: "error",
      category: "wiring",
      message: `${file} is missing the required hstack line`,
    });
  }

  // Render
  console.log(pc.bold(`hstack doctor — ${gitRoot}`));
  console.log("");
  console.log(`  package:     v${packageVersion}`);
  console.log(`  installed:   v${installedVersion ?? pc.dim("unknown")}`);
  console.log("");

  if (findings.length === 0) {
    console.log(pc.green("✓ All checks passed."));
    return 0;
  }

  console.log(pc.bold(`${findings.length} finding(s):`));
  for (const f of findings) {
    const tag =
      f.level === "error" ? pc.red("✗") : pc.yellow("!");
    console.log(`  ${tag} [${f.category}] ${f.message}`);
    if (f.detail) console.log(pc.dim(f.detail));
  }
  console.log("");
  const hasErrors = findings.some((f) => f.level === "error");
  if (hasErrors) {
    console.log(
      pc.dim(
        "Run " +
          pc.cyan("npx hstack update") +
          " to repair wiring and sync framework files.",
      ),
    );
  } else {
    console.log(
      pc.dim(
        "Run " +
          pc.cyan("npx hstack update") +
          " to sync. Re-run " +
          pc.cyan("hstack doctor --verbose") +
          " for the detailed file list.",
      ),
    );
  }
  return 1;
}
