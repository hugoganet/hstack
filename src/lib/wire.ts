import fs from "fs-extra";
import { resolve, relative, dirname } from "node:path";
import { readdir, symlink, readlink, lstat, unlink } from "node:fs/promises";
import { diffFramework } from "./diff.js";
import { FRAMEWORK_PATHS } from "../manifest.js";

export const KERNEL_IMPORT_LINE =
  "> **Engineering workflow:** all changes in this repo are governed by hstack. See @hstack/CLAUDE.md.";

export const GITIGNORE_TELEMETRY_LINE = "**/.telemetry/";

export type Action =
  | { kind: "copy-template"; from: string; to: string }
  | { kind: "add-file"; from: string; to: string; relpath: string }
  | { kind: "overwrite-file"; from: string; to: string; relpath: string }
  | { kind: "remove-file"; to: string; relpath: string }
  | { kind: "symlink"; from: string; to: string }
  | { kind: "remove-symlink"; to: string }
  | {
      kind: "append-line";
      file: string;
      line: string;
      createIfMissing: boolean;
      /**
       * Substring used for idempotency check. If the file already contains this
       * substring, the action is a no-op. If undefined, falls back to checking
       * for `line` itself. Use this for lines whose prose may legitimately vary
       * across consumers (e.g., the kernel-import line), where we want to detect
       * presence without requiring exact wording.
       */
      matchOn?: string;
    }
  | { kind: "write-version"; to: string; version: string };

/**
 * Compute the full plan for `hstack init` against `consumerRoot`,
 * using `templateDir` as the source of framework files.
 *
 * Pure function — does not touch disk except to read the skills directory.
 */
export async function planInit(
  consumerRoot: string,
  templateDir: string,
  packageVersion: string,
): Promise<Action[]> {
  const actions: Action[] = [];

  // 1. Copy the entire template/ tree into <consumer>/hstack/
  actions.push({
    kind: "copy-template",
    from: templateDir,
    to: resolve(consumerRoot, "hstack"),
  });

  // 2. Symlink <consumer>/.claude/agents -> hstack/.claude/agents
  actions.push({
    kind: "symlink",
    from: "../hstack/.claude/agents",
    to: resolve(consumerRoot, ".claude", "agents"),
  });

  // 3. Per-skill symlinks under <consumer>/.claude/skills/hstack-*
  const skillsDir = resolve(templateDir, ".claude", "skills");
  const skillEntries = await readdir(skillsDir);
  for (const name of skillEntries) {
    if (!name.startsWith("hstack-")) continue;
    actions.push({
      kind: "symlink",
      from: `../../hstack/.claude/skills/${name}`,
      to: resolve(consumerRoot, ".claude", "skills", name),
    });
  }

  // 4. Append kernel-import line to CLAUDE.md (create if missing)
  actions.push({
    kind: "append-line",
    file: resolve(consumerRoot, "CLAUDE.md"),
    line: KERNEL_IMPORT_LINE,
    createIfMissing: true,
    matchOn: "@hstack/CLAUDE.md",
  });

  // 5. Append telemetry gitignore line (create if missing)
  actions.push({
    kind: "append-line",
    file: resolve(consumerRoot, ".gitignore"),
    line: GITIGNORE_TELEMETRY_LINE,
    createIfMissing: true,
  });

  // 6. Stamp the installed-version marker so update can compare later.
  actions.push({
    kind: "write-version",
    to: resolve(consumerRoot, "hstack", "VERSION"),
    version: packageVersion,
  });

  return actions;
}

/**
 * Compute the full plan for `hstack update` against `consumerRoot`.
 * Diffs framework files in template/ vs the consumer's hstack/, plus
 * the .claude/ symlink delta, plus idempotent CLAUDE.md / .gitignore
 * line checks, plus the VERSION marker stamp.
 */
export async function planUpdate(
  consumerRoot: string,
  templateDir: string,
  packageVersion: string,
): Promise<Action[]> {
  const actions: Action[] = [];
  const consumerHstack = resolve(consumerRoot, "hstack");

  // 1. File-level diff for framework paths.
  const fileDiffs = await diffFramework(
    templateDir,
    consumerHstack,
    FRAMEWORK_PATHS,
  );
  for (const d of fileDiffs) {
    if (d.kind === "add") {
      actions.push({ kind: "add-file", from: d.from, to: d.to, relpath: d.relpath });
    } else if (d.kind === "overwrite") {
      actions.push({ kind: "overwrite-file", from: d.from, to: d.to, relpath: d.relpath });
    } else if (d.kind === "remove") {
      actions.push({ kind: "remove-file", to: d.to, relpath: d.relpath });
    }
  }

  // 2. Symlink delta for .claude/skills/hstack-*
  const templateSkills = new Set(await listTemplateSkills(templateDir));
  const consumerLinks = new Set(await listConsumerSkillLinks(consumerRoot));
  for (const name of templateSkills) {
    if (!consumerLinks.has(name)) {
      actions.push({
        kind: "symlink",
        from: `../../hstack/.claude/skills/${name}`,
        to: resolve(consumerRoot, ".claude", "skills", name),
      });
    }
  }
  for (const name of consumerLinks) {
    if (!templateSkills.has(name)) {
      actions.push({
        kind: "remove-symlink",
        to: resolve(consumerRoot, ".claude", "skills", name),
      });
    }
  }

  // 3. Agents dir symlink — idempotent (symlink action skips if already correct).
  actions.push({
    kind: "symlink",
    from: "../hstack/.claude/agents",
    to: resolve(consumerRoot, ".claude", "agents"),
  });

  // 4. CLAUDE.md import line — idempotent re-check.
  actions.push({
    kind: "append-line",
    file: resolve(consumerRoot, "CLAUDE.md"),
    line: KERNEL_IMPORT_LINE,
    createIfMissing: true,
    matchOn: "@hstack/CLAUDE.md",
  });

  // 5. .gitignore telemetry line — idempotent re-check.
  actions.push({
    kind: "append-line",
    file: resolve(consumerRoot, ".gitignore"),
    line: GITIGNORE_TELEMETRY_LINE,
    createIfMissing: true,
  });

  // 6. VERSION marker.
  actions.push({
    kind: "write-version",
    to: resolve(consumerRoot, "hstack", "VERSION"),
    version: packageVersion,
  });

  return actions;
}

/**
 * Filter out actions that would be no-ops at execute time (e.g., a symlink
 * action whose target is already present and correct). Returns a new array
 * containing only actions that will produce a visible change.
 *
 * Used by `hstack update` so plan output, summary counts, and the confirm
 * prompt reflect only real work — not idempotent re-checks.
 */
export async function pruneNoopActions(
  actions: Action[],
  packageVersion: string,
): Promise<Action[]> {
  const out: Action[] = [];
  for (const a of actions) {
    if (a.kind === "symlink") {
      const stat = await lstat(a.to).catch(() => null);
      if (stat?.isSymbolicLink()) {
        const target = await readlink(a.to);
        if (target === a.from) continue;
      }
    } else if (a.kind === "append-line") {
      const exists = await fs.pathExists(a.file);
      if (exists) {
        const content = await fs.readFile(a.file, "utf8");
        const probe = a.matchOn ?? a.line;
        if (content.includes(probe)) continue;
      }
    } else if (a.kind === "write-version") {
      const exists = await fs.pathExists(a.to);
      if (exists) {
        const cur = (await fs.readFile(a.to, "utf8")).trim();
        if (cur === packageVersion) continue;
      }
    }
    out.push(a);
  }
  return out;
}

/**
 * Enumerate the skill names (relative dir names) under `templateDir/.claude/skills`
 * that match the hstack-* prefix.
 */
export async function listTemplateSkills(
  templateDir: string,
): Promise<string[]> {
  const skillsDir = resolve(templateDir, ".claude", "skills");
  if (!(await fs.pathExists(skillsDir))) return [];
  const entries = await readdir(skillsDir);
  return entries.filter((n) => n.startsWith("hstack-")).sort();
}

/**
 * Enumerate the hstack-* skill symlinks currently present under
 * `<consumer>/.claude/skills`.
 */
export async function listConsumerSkillLinks(
  consumerRoot: string,
): Promise<string[]> {
  const dir = resolve(consumerRoot, ".claude", "skills");
  if (!(await fs.pathExists(dir))) return [];
  const entries = await readdir(dir);
  return entries.filter((n) => n.startsWith("hstack-")).sort();
}

/** Render an action plan as human-readable bullets. */
export function renderPlan(actions: Action[], consumerRoot: string): string {
  return actions
    .map((a) => {
      switch (a.kind) {
        case "copy-template":
          return `  copy   ${rel(a.to, consumerRoot)}/  (framework files)`;
        case "add-file":
          return `  add    hstack/${a.relpath}`;
        case "overwrite-file":
          return `  edit   hstack/${a.relpath}`;
        case "remove-file":
          return `  rm     hstack/${a.relpath}`;
        case "symlink":
          return `  link   ${rel(a.to, consumerRoot)} -> ${a.from}`;
        case "remove-symlink":
          return `  unlink ${rel(a.to, consumerRoot)}`;
        case "append-line":
          return `  check  ${rel(a.file, consumerRoot)}  (idempotent append)`;
        case "write-version":
          return `  write  ${rel(a.to, consumerRoot)}  (${a.version})`;
      }
    })
    .join("\n");
}

/** Group a plan by action kind, returning {kind: count}. Useful for summaries. */
export function planSummary(actions: Action[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of actions) out[a.kind] = (out[a.kind] ?? 0) + 1;
  return out;
}

function rel(p: string, root: string): string {
  const r = relative(root, p);
  return r === "" ? "." : r;
}

/** Validate that every action is safe to execute. Returns array of blocker messages; empty = ok. */
export async function validatePlan(actions: Action[]): Promise<string[]> {
  const blockers: string[] = [];
  for (const a of actions) {
    if (a.kind === "copy-template") {
      if (await fs.pathExists(a.to)) {
        blockers.push(
          `${a.to} already exists. Run \`hstack update\` instead, or remove the directory.`,
        );
      }
    }
    if (a.kind === "symlink") {
      if (await fs.pathExists(a.to)) {
        const stat = await lstat(a.to).catch(() => null);
        if (stat?.isSymbolicLink()) {
          const target = await readlink(a.to);
          if (target !== a.from) {
            blockers.push(
              `${a.to} is a symlink pointing at ${target}, expected ${a.from}. Remove it or use --force.`,
            );
          }
          // matching symlink — skip silently at execute time
        } else {
          blockers.push(
            `${a.to} exists and is not a symlink. Remove it manually before init.`,
          );
        }
      }
    }
    // append-line is always safe (idempotent at execute time)
  }
  return blockers;
}

/** Execute the plan. Aborts on first error; does not roll back. */
export async function executePlan(actions: Action[]): Promise<void> {
  for (const a of actions) {
    switch (a.kind) {
      case "copy-template":
        await fs.copy(a.from, a.to, { dereference: false });
        break;
      case "add-file":
      case "overwrite-file":
        await fs.ensureDir(dirname(a.to));
        await fs.copy(a.from, a.to, { dereference: false, overwrite: true });
        break;
      case "remove-file":
        await fs.remove(a.to);
        break;
      case "symlink": {
        const stat = await lstat(a.to).catch(() => null);
        if (stat?.isSymbolicLink()) {
          const target = await readlink(a.to);
          if (target === a.from) break;
          await unlink(a.to);
        }
        await fs.ensureDir(dirname(a.to));
        await symlink(a.from, a.to);
        break;
      }
      case "remove-symlink": {
        const stat = await lstat(a.to).catch(() => null);
        if (stat?.isSymbolicLink()) await unlink(a.to);
        break;
      }
      case "append-line":
        await appendLineIdempotent(a.file, a.line, a.createIfMissing, a.matchOn);
        break;
      case "write-version":
        await fs.ensureDir(dirname(a.to));
        await fs.writeFile(a.to, a.version + "\n");
        break;
    }
  }
}

async function appendLineIdempotent(
  file: string,
  line: string,
  createIfMissing: boolean,
  matchOn?: string,
): Promise<void> {
  const exists = await fs.pathExists(file);
  if (!exists && !createIfMissing) return;
  const existing = exists ? await fs.readFile(file, "utf8") : "";
  const probe = matchOn ?? line;
  if (existing.includes(probe)) return;
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await fs.writeFile(file, existing + sep + line + "\n");
}
