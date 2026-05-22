import fs from "fs-extra";
import { resolve, relative, dirname } from "node:path";
import { readdir, symlink, readlink, lstat } from "node:fs/promises";

const KERNEL_IMPORT_LINE =
  "> **Engineering workflow:** all changes in this repo are governed by hstack. See @hstack/CLAUDE.md.";

const GITIGNORE_TELEMETRY_LINE = "**/.telemetry/";

export type Action =
  | { kind: "copy-template"; from: string; to: string }
  | { kind: "symlink"; from: string; to: string }
  | { kind: "append-line"; file: string; line: string; createIfMissing: boolean };

/**
 * Compute the full plan for `hstack init` against `consumerRoot`,
 * using `templateDir` as the source of framework files.
 *
 * Pure function — does not touch disk except to read the skills directory.
 */
export async function planInit(
  consumerRoot: string,
  templateDir: string,
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
    from: "hstack/.claude/agents",
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
  });

  // 5. Append telemetry gitignore line (create if missing)
  actions.push({
    kind: "append-line",
    file: resolve(consumerRoot, ".gitignore"),
    line: GITIGNORE_TELEMETRY_LINE,
    createIfMissing: true,
  });

  return actions;
}

/** Render an action plan as human-readable bullets. */
export function renderPlan(actions: Action[], consumerRoot: string): string {
  return actions
    .map((a) => {
      switch (a.kind) {
        case "copy-template":
          return `  copy   ${rel(a.to, consumerRoot)}/  (framework files)`;
        case "symlink":
          return `  link   ${rel(a.to, consumerRoot)} -> ${a.from}`;
        case "append-line":
          return `  edit   ${rel(a.file, consumerRoot)}  (append kernel/gitignore line)`;
      }
    })
    .join("\n");
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
    if (a.kind === "copy-template") {
      await fs.copy(a.from, a.to, { dereference: false });
    } else if (a.kind === "symlink") {
      // Skip if already-correct symlink (idempotent)
      const stat = await lstat(a.to).catch(() => null);
      if (stat?.isSymbolicLink()) {
        const target = await readlink(a.to);
        if (target === a.from) continue;
      }
      await fs.ensureDir(dirname(a.to));
      await symlink(a.from, a.to);
    } else if (a.kind === "append-line") {
      await appendLineIdempotent(a.file, a.line, a.createIfMissing);
    }
  }
}

async function appendLineIdempotent(
  file: string,
  line: string,
  createIfMissing: boolean,
): Promise<void> {
  const exists = await fs.pathExists(file);
  if (!exists && !createIfMissing) return;
  const existing = exists ? await fs.readFile(file, "utf8") : "";
  if (existing.includes(line)) return;
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await fs.writeFile(file, existing + sep + line + "\n");
}
