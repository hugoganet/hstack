import pc from "picocolors";
import fs from "fs-extra";
import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { findGitRoot } from "../lib/git.js";
import { packageTemplateDir, packageVersionFile } from "../lib/paths.js";
import {
  planUpdate,
  pruneNoopActions,
  coordHooksState,
  kernelFilenameState,
  KERNEL_IMPORT_PROBE,
  LEGACY_KERNEL_IMPORT_PROBE,
  LEGACY_KERNEL_PATH_PROBE,
  type Action,
} from "../lib/wire.js";
import {
  descriptionsOverBudget,
  WORD_BUDGET,
  CHAR_BUDGET,
} from "../lib/descriptions.js";

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

  // Kernel filename (ADR-0010). An `hstack/CLAUDE.md` left on disk is loaded a
  // second time by nested-CLAUDE.md discovery on the first read of anything
  // under hstack/ (~15k tokens); an import line still pointing at the old path
  // means the kernel may not be loaded at all once the file is renamed. Both
  // are errors, not drift.
  const kernelFile = await kernelFilenameState(gitRoot);
  if (kernelFile.legacyKernelFile || kernelFile.legacyImport) {
    const parts: string[] = [];
    if (kernelFile.legacyKernelFile) {
      parts.push(
        "hstack/CLAUDE.md is still present — nested-CLAUDE.md discovery injects a second full copy of the kernel",
      );
    }
    if (kernelFile.legacyImport) {
      parts.push(
        `the root CLAUDE.md import still points at ${LEGACY_KERNEL_IMPORT_PROBE}`,
      );
    }
    findings.push({
      level: "error",
      category: "kernel-filename",
      message: `${parts.join("; ")} (ADR-0010) — fix: \`npx hstack update\``,
    });
  } else if (kernelFile.legacyImportUnrewritable) {
    findings.push({
      level: "error",
      category: "kernel-filename",
      message:
        `CLAUDE.md references the old kernel path \`${LEGACY_KERNEL_PATH_PROBE}\` in a form hstack will not rewrite (ADR-0010) — ` +
        `fix by hand: the import must read \`${KERNEL_IMPORT_PROBE}\``,
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

  // Description budget (ADR-0011, Option F). Descriptions are the always-loaded
  // routing index — ~3k tokens at 40 words each, ~29.7k before the rewrite —
  // paid at turn zero of every session in every consuming repo, including
  // sessions that invoke nothing. The rule shipped with the rewrite; this
  // finding is what stops it regressing. Measured against the package template,
  // because the consumer's copies are framework files `framework-drift` already
  // covers.
  const overBudget = descriptionsOverBudget(templateDir);
  if (overBudget.length > 0) {
    findings.push({
      level: "warn",
      category: "description-budget",
      message:
        `${overBudget.length} skill/agent description(s) over the ${WORD_BUDGET}-word budget ` +
        `(ADR-0011) — a description names the trigger, the body carries the rest`,
      detail: overBudget
        .map(
          (d) =>
            `    ${d.name} — ${d.words} words, ${d.chars} chars` +
            (d.chars > CHAR_BUDGET && d.words <= WORD_BUDGET ? " (over the character ceiling)" : "") +
            `  [${d.relpath}]`,
        )
        .join("\n"),
    });
  }

  // merge-hooks actions survive pruneNoopActions when the coord notification
  // hooks are missing from .claude/settings.json, or when that file is
  // unparseable (which update refuses to touch).
  const hookActions = actions.filter((a) => a.kind === "merge-hooks");
  for (const a of hookActions) {
    const m = a as Extract<Action, { kind: "merge-hooks" }>;
    const state = await coordHooksState(m.file);
    findings.push({
      level: "error",
      category: "hooks",
      message:
        state === "invalid"
          ? `.claude/settings.json is not a parseable JSON settings object — coord notification hooks cannot be wired (ADR-0007)`
          : `.claude/settings.json is missing the coord notification hooks (ADR-0007)`,
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
