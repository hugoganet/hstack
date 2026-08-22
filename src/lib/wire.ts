import fs from "fs-extra";
import { resolve, relative, dirname, join } from "node:path";
import { readdir, symlink, readlink, lstat, unlink } from "node:fs/promises";
import { diffFramework } from "./diff.js";
import { gitMove } from "./git.js";
import {
  FRAMEWORK_PATHS,
  LEGACY_FRAMEWORK_PATHS,
  LEGACY_SCRIPTS_DIR,
} from "../manifest.js";

/**
 * ADR-0010: the consumer-side kernel lives at `hstack/KERNEL.md`, not
 * `hstack/CLAUDE.md`. Claude Code loads a file named `CLAUDE.md` twice — once
 * via the `@`-import in the consumer's root `CLAUDE.md` (at launch) and again
 * via nested-`CLAUDE.md` discovery (on the first read of any file under
 * `hstack/`). Discovery keys on the literal filename, so renaming the file
 * leaves the import as the single load path. Filename only — nothing about the
 * kernel's authority, content, or precedence changes.
 */
export const KERNEL_FILENAME = "KERNEL.md";
/** Pre-ADR-0010 filename. Retained for the `update` migration and `doctor`. */
export const LEGACY_KERNEL_FILENAME = "CLAUDE.md";

export const KERNEL_IMPORT_LINE =
  "> **Engineering workflow:** all changes in this repo are governed by hstack. See @hstack/KERNEL.md.";

/** Idempotency probe for the kernel-import line in the consumer's root CLAUDE.md. */
export const KERNEL_IMPORT_PROBE = "@hstack/KERNEL.md";
/**
 * The pre-ADR-0010 import, and the only form `update` rewrites in place: an
 * unambiguous `@`-import of the old path, replaced substring-for-substring so
 * the rest of an engineer-owned file survives verbatim.
 */
export const LEGACY_KERNEL_IMPORT_PROBE = "@hstack/CLAUDE.md";
/**
 * Any surviving mention of the old kernel path. Deliberately wider than what
 * `update` rewrites: a hand-edited line (backticked, `@` dropped, a relative
 * prefix) is never rewritten, so `doctor` has to keep flagging it.
 */
export const LEGACY_KERNEL_PATH_PROBE = "hstack/CLAUDE.md";

/**
 * The coord-notification hooks (ADR-0007) the installer wired into consumers
 * before v0.17 — a coord scan at SessionStart and on every UserPromptSubmit.
 * The machinery they called is gone, so `hstack update` removes them.
 *
 * This probe is the ownership boundary, and it is deliberately narrow: hstack
 * removes a hook entry only when its command names hstack's own coord script.
 * Everything else in `.claude/settings.json` belongs to the engineer.
 */
export const COORD_HOOK_PROBE = "scripts/coord/coord_scan.py";

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
  | { kind: "write-version"; to: string; version: string }
  | {
      /**
       * v0.17: remove the coord-notification hook entries (ADR-0007) the
       * installer put in the consumer's .claude/settings.json. Removal-only,
       * and only for entries whose command names hstack's coord script;
       * engineer-owned keys are preserved verbatim. An unparseable file is
       * surfaced and skipped, never rewritten.
       */
      kind: "remove-coord-hooks";
      file: string;
    }
  | {
      /**
       * v0.17: remove the pre-v0.17 framework paths listed in
       * LEGACY_FRAMEWORK_PATHS, then `hstack/scripts/` itself if nothing else
       * is left in it. Carries the concrete paths found on disk, so the plan
       * shows what will go and the action is a no-op by construction once it
       * has run.
       */
      kind: "remove-legacy-paths";
      consumerRoot: string;
      relpaths: string[];
    }
  | {
      /**
       * ADR-0010 migration for a consumer installed before the rename:
       * `git mv hstack/CLAUDE.md hstack/KERNEL.md` plus a probe-matched
       * rewrite of the import line in the consumer's root CLAUDE.md. Only
       * planned when the legacy state is actually on disk, so it is a no-op
       * by construction on an already-migrated repo.
       */
      kind: "migrate-kernel-filename";
      consumerRoot: string;
    };

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
    matchOn: KERNEL_IMPORT_PROBE,
  });

  // 5. Stamp the installed-version marker so update can compare later.
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
 * the .claude/ symlink delta, plus the idempotent CLAUDE.md
 * line checks, plus the VERSION marker stamp.
 */
export async function planUpdate(
  consumerRoot: string,
  templateDir: string,
  packageVersion: string,
): Promise<Action[]> {
  const actions: Action[] = [];
  const consumerHstack = resolve(consumerRoot, "hstack");

  // 0. ADR-0010 kernel rename. Planned first on purpose: it rewrites the
  //    import line the append-line check below probes for, so running it
  //    afterwards would leave the repo with two import lines.
  if (kernelFilenameNeedsMigration(await kernelFilenameState(consumerRoot))) {
    actions.push({ kind: "migrate-kernel-filename", consumerRoot });
  }

  // 0b. v0.17 legacy paths. Planned before the file diff for the same reason
  //     the rename is: these paths left FRAMEWORK_PATHS, so the diff below is
  //     blind to them and only this action can take them back.
  const legacyRelpaths = await legacyPathsPresent(consumerRoot);
  if (legacyRelpaths.length > 0) {
    actions.push({ kind: "remove-legacy-paths", consumerRoot, relpaths: legacyRelpaths });
  }

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
    matchOn: KERNEL_IMPORT_PROBE,
  });

  // 5. Coord-notification hooks — removed, not merged (v0.17).
  //    Nothing is added to a consumer's .gitignore any more: the `**/.telemetry/`,
  //    `hstack/kernel-fit/flags/` and `hstack/.session-state/` lines the installer
  //    used to write are gone with the machinery that produced those directories.
  //    Lines already in a consumer's .gitignore stay — hstack never edits an
  //    engineer's file to unsay something it once said.
  actions.push({
    kind: "remove-coord-hooks",
    file: resolve(consumerRoot, ".claude", "settings.json"),
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
 * Where a consumer stands relative to the ADR-0010 kernel rename.
 */
export interface KernelFilenameState {
  /** `hstack/CLAUDE.md` is still on disk — nested discovery still matches it. */
  legacyKernelFile: boolean;
  /** The root CLAUDE.md still carries the rewritable `@hstack/CLAUDE.md` import. */
  legacyImport: boolean;
  /**
   * The root CLAUDE.md mentions the old kernel path in a form the migration
   * refuses to rewrite (hand-edited: no `@`, a relative prefix, prose). Never
   * touched by `update`; surfaced by `doctor` for the engineer to fix by hand.
   */
  legacyImportUnrewritable: boolean;
}

export async function kernelFilenameState(
  consumerRoot: string,
): Promise<KernelFilenameState> {
  const legacyKernelFile = await fs.pathExists(
    resolve(consumerRoot, "hstack", LEGACY_KERNEL_FILENAME),
  );
  const rootClaudeMd = resolve(consumerRoot, "CLAUDE.md");
  const content = (await fs.pathExists(rootClaudeMd))
    ? await fs.readFile(rootClaudeMd, "utf8")
    : "";
  const legacyImport = content.includes(LEGACY_KERNEL_IMPORT_PROBE);
  return {
    legacyKernelFile,
    legacyImport,
    legacyImportUnrewritable:
      !legacyImport && content.includes(LEGACY_KERNEL_PATH_PROBE),
  };
}

/** True when `update` has migration work it can actually perform. */
export function kernelFilenameNeedsMigration(s: KernelFilenameState): boolean {
  return s.legacyKernelFile || s.legacyImport;
}

/**
 * Move the kernel to its ADR-0010 name and repoint the consumer's import line.
 * Both halves are deliberately in one action so they land in one commit: a repo
 * with the file renamed but the import still pointing at the old path has no
 * kernel in context at all.
 */
async function migrateKernelFilename(consumerRoot: string): Promise<void> {
  const legacyRel = join("hstack", LEGACY_KERNEL_FILENAME);
  const kernelRel = join("hstack", KERNEL_FILENAME);
  const legacyAbs = resolve(consumerRoot, legacyRel);
  const kernelAbs = resolve(consumerRoot, kernelRel);

  if (await fs.pathExists(legacyAbs)) {
    if (await fs.pathExists(kernelAbs)) {
      // Half-migrated repo. KERNEL.md is authoritative and installer-owned
      // (update overwrites it from the template either way), so the stale copy
      // goes — leaving it in place would keep the double-load bug alive.
      await fs.remove(legacyAbs);
      console.error(
        `hstack: removed stale ${legacyRel} — ${kernelRel} is already present and is the kernel (ADR-0010).`,
      );
    } else {
      const renamed = await gitMove(consumerRoot, legacyRel, kernelRel);
      console.error(
        `hstack: ${renamed ? "git mv" : "moved"} ${legacyRel} -> ${kernelRel} (ADR-0010).`,
      );
    }
  }

  const rootClaudeMd = resolve(consumerRoot, "CLAUDE.md");
  if (!(await fs.pathExists(rootClaudeMd))) return;
  const content = await fs.readFile(rootClaudeMd, "utf8");
  if (content.includes(LEGACY_KERNEL_IMPORT_PROBE)) {
    // Substring swap, not a line rewrite: everything the engineer wrote around
    // the import — their own prose, their own ordering — survives verbatim.
    await fs.writeFile(
      rootClaudeMd,
      content.split(LEGACY_KERNEL_IMPORT_PROBE).join(KERNEL_IMPORT_PROBE),
    );
    console.error(
      `hstack: rewrote the kernel import in CLAUDE.md -> ${KERNEL_IMPORT_PROBE} (ADR-0010).`,
    );
  } else if (content.includes(LEGACY_KERNEL_PATH_PROBE)) {
    console.error(
      `hstack: CLAUDE.md mentions ${LEGACY_KERNEL_PATH_PROBE} but not as an \`${LEGACY_KERNEL_IMPORT_PROBE}\` import — left untouched. ` +
        `hstack never rewrites a hand-edited import. Point it at \`${KERNEL_IMPORT_PROBE}\` yourself; \`hstack doctor\` will keep flagging it until you do.`,
    );
  }
}

/**
 * Which of the pre-v0.17 framework paths are still on disk in this consumer.
 * Returns paths relative to `<consumer>/hstack/`, in manifest order.
 */
export async function legacyPathsPresent(consumerRoot: string): Promise<string[]> {
  const hstackDir = resolve(consumerRoot, "hstack");
  const present: string[] = [];
  for (const rel of LEGACY_FRAMEWORK_PATHS) {
    if (await fs.pathExists(resolve(hstackDir, rel))) present.push(rel);
  }
  return present;
}

/**
 * Remove the pre-v0.17 paths, then `hstack/scripts/` if it came out empty.
 *
 * `fs.remove` is a no-op on a path that is already gone, so a re-run after a
 * partial failure finishes the job rather than erroring.
 */
async function removeLegacyPaths(
  consumerRoot: string,
  relpaths: string[],
): Promise<void> {
  const hstackDir = resolve(consumerRoot, "hstack");
  for (const rel of relpaths) {
    await fs.remove(resolve(hstackDir, rel));
  }
  const scriptsDir = resolve(hstackDir, LEGACY_SCRIPTS_DIR);
  if (await fs.pathExists(scriptsDir)) {
    const left = await readdir(scriptsDir).catch(() => null);
    if (left !== null && left.length === 0) await fs.remove(scriptsDir);
  }
}

/**
 * Where the coord hook entries stand in a consumer's .claude/settings.json.
 * - "present": at least one hstack-owned coord hook entry is still wired.
 * - "absent": file missing, or parseable with no hstack coord hook left.
 * - "invalid": file exists but is not a JSON object, or a hooks key has an
 *   unexpected shape. Never written to — surfaced instead, because silently
 *   rewriting an engineer's malformed settings file is how configuration
 *   gets lost.
 */
export type CoordHooksState = "present" | "absent" | "invalid";

/** True when this hook command is one hstack installed and therefore owns. */
function isCoordHookCommand(h: unknown): boolean {
  const command = (h as { command?: unknown } | null)?.command;
  return typeof command === "string" && command.includes(COORD_HOOK_PROBE);
}

function matcherHasCoordHook(matcher: unknown): boolean {
  const inner = (matcher as { hooks?: unknown } | null)?.hooks;
  return Array.isArray(inner) && inner.some(isCoordHookCommand);
}

/** Parse the settings file, or say why it cannot be touched. */
async function readSettings(
  file: string,
): Promise<{ ok: true; settings: Record<string, unknown> } | { ok: false }> {
  if (!(await fs.pathExists(file))) return { ok: true, settings: {} };
  let parsed: unknown;
  try {
    const raw = await fs.readFile(file, "utf8");
    parsed = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false };
  }
  const hooks = (parsed as Record<string, unknown>).hooks;
  if (
    hooks !== undefined &&
    (typeof hooks !== "object" || hooks === null || Array.isArray(hooks))
  ) {
    return { ok: false };
  }
  return { ok: true, settings: parsed as Record<string, unknown> };
}

export async function coordHooksState(file: string): Promise<CoordHooksState> {
  const read = await readSettings(file);
  if (!read.ok) return "invalid";
  const hooks = read.settings.hooks as Record<string, unknown> | undefined;
  if (!hooks) return "absent";
  for (const matchers of Object.values(hooks)) {
    if (!Array.isArray(matchers)) return "invalid";
    if (matchers.some(matcherHasCoordHook)) return "present";
  }
  return "absent";
}

/**
 * Take back the coord hook entries hstack installed (ADR-0007), and nothing
 * else. A matcher is dropped only once its own `hooks` array is empty, an event
 * only once it has no matchers left, and the `hooks` key only once it is empty
 * — an engineer's SessionStart hook sitting next to hstack's survives all
 * three. Everything outside `hooks` is untouched.
 */
async function removeCoordHooks(file: string): Promise<void> {
  const read = await readSettings(file);
  if (!read.ok) {
    // Never rewrite an unparseable engineer-owned file, and never abort the
    // rest of the plan over it — warn and let `hstack doctor` keep flagging it.
    console.error(
      `hstack: left the coord notification hooks in place — ${file} is not a parseable JSON settings object. Remove the \`${COORD_HOOK_PROBE}\` entries by hand.`,
    );
    return;
  }
  const settings = read.settings;
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks) return;

  let removed = 0;
  for (const [event, matchers] of Object.entries(hooks)) {
    if (!Array.isArray(matchers)) continue;
    const keptMatchers: unknown[] = [];
    for (const matcher of matchers) {
      if (!matcherHasCoordHook(matcher)) {
        keptMatchers.push(matcher);
        continue;
      }
      const inner = (matcher as { hooks: unknown[] }).hooks;
      const keptInner = inner.filter((h) => !isCoordHookCommand(h));
      removed += inner.length - keptInner.length;
      if (keptInner.length > 0) {
        keptMatchers.push({ ...(matcher as object), hooks: keptInner });
      }
    }
    if (keptMatchers.length > 0) hooks[event] = keptMatchers;
    else delete hooks[event];
  }
  if (removed === 0) return;
  if (Object.keys(hooks).length === 0) delete settings.hooks;

  await fs.ensureDir(dirname(file));
  await fs.writeFile(file, JSON.stringify(settings, null, 2) + "\n");
  console.error(
    `hstack: removed ${removed} coord notification hook ${removed === 1 ? "entry" : "entries"} from ${file} (ADR-0007 machinery removed in v0.17).`,
  );
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
  // The ADR-0010 migration rewrites the import line before the append-line
  // action runs, so a legacy import is "already wired" for pruning purposes —
  // without this, update would list a phantom CLAUDE.md append and doctor would
  // report a wiring error on top of the kernel-filename finding.
  const migrating = actions.some((a) => a.kind === "migrate-kernel-filename");
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
        if (
          migrating &&
          probe === KERNEL_IMPORT_PROBE &&
          content.includes(LEGACY_KERNEL_IMPORT_PROBE)
        ) {
          continue;
        }
      }
    } else if (a.kind === "write-version") {
      const exists = await fs.pathExists(a.to);
      if (exists) {
        const cur = (await fs.readFile(a.to, "utf8")).trim();
        if (cur === packageVersion) continue;
      }
    } else if (a.kind === "remove-coord-hooks") {
      // "invalid" is kept so doctor can surface it.
      if ((await coordHooksState(a.file)) === "absent") continue;
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
        case "remove-coord-hooks":
          return `  hooks  ${rel(a.file, consumerRoot)}  (remove the coord notification hooks, ADR-0007)`;
        case "remove-legacy-paths":
          return a.relpaths
            .map((r) => `  rm     hstack/${r}  (removed in v0.17)`)
            .join("\n");
        case "migrate-kernel-filename":
          return `  move   hstack/${LEGACY_KERNEL_FILENAME} -> hstack/${KERNEL_FILENAME} + CLAUDE.md import line  (ADR-0010)`;
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
    if (a.kind === "remove-coord-hooks") {
      if ((await coordHooksState(a.file)) === "invalid") {
        blockers.push(
          `${a.file} exists but is not a parseable JSON settings object (or its hooks key has an unexpected shape). ` +
            `Fix it manually, then re-run — hstack never rewrites an unparseable settings file.`,
        );
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
        // Removing every SKILL.md under a deleted skill leaves the skill's
        // directory behind, and an empty `hstack/.claude/skills/hstack-ship/`
        // reads as a skill that is still installed. `relpath` is a suffix of
        // `to`, so what precedes it is the consumer's hstack root — the
        // boundary the prune must not walk past.
        await pruneEmptyDirs(
          dirname(a.to),
          a.to.slice(0, a.to.length - a.relpath.length),
        );
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
      case "remove-coord-hooks":
        await removeCoordHooks(a.file);
        break;
      case "remove-legacy-paths":
        await removeLegacyPaths(a.consumerRoot, a.relpaths);
        break;
      case "migrate-kernel-filename":
        await migrateKernelFilename(a.consumerRoot);
        break;
      case "write-version":
        await fs.ensureDir(dirname(a.to));
        await fs.writeFile(a.to, a.version + "\n");
        break;
    }
  }
}

/**
 * Walk up from `dir`, removing directories that came out empty, and stop at
 * `stopAt` (exclusive) or at the first directory that still holds something.
 * A directory the engineer dropped a file into is never touched.
 */
async function pruneEmptyDirs(dir: string, stopAt: string): Promise<void> {
  const boundary = resolve(stopAt);
  let current = resolve(dir);
  while (current !== boundary && current.startsWith(boundary)) {
    const entries = await readdir(current).catch(() => null);
    if (entries === null || entries.length > 0) return;
    await fs.remove(current);
    current = dirname(current);
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
