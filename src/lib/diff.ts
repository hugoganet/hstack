import fs from "fs-extra";
import { resolve, relative, join } from "node:path";
import { readdir, readFile } from "node:fs/promises";

/**
 * Walk a directory recursively, returning a Map of relative-path → absolute-path
 * for every regular file. Symlinks are NOT followed (they are reported as files
 * with their link content as "value" for symlink-to-symlink comparison).
 *
 * Used by update to diff template/ vs <consumer>/hstack/.
 */
export async function walkFiles(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!(await fs.pathExists(root))) return out;
  await walk(root, root, out);
  return out;
}

async function walk(
  base: string,
  dir: string,
  out: Map<string, string>,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(base, abs, out);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      out.set(relative(base, abs), abs);
    }
  }
}

/** True iff the two files have identical byte content. */
export async function filesEqual(a: string, b: string): Promise<boolean> {
  const [bufA, bufB] = await Promise.all([readFile(a), readFile(b)]);
  if (bufA.length !== bufB.length) return false;
  return bufA.equals(bufB);
}

export type FileDiff =
  | { kind: "add"; from: string; to: string; relpath: string }
  | { kind: "overwrite"; from: string; to: string; relpath: string }
  | { kind: "remove"; to: string; relpath: string };

/**
 * Diff the framework subtree of `template/` against `<consumer>/hstack/`.
 * Only paths under FRAMEWORK_PATHS are considered.
 *
 * `frameworkPaths` is the list of framework subpaths (relative to template root
 * and to consumer hstack root). Both top-level files (e.g., "CLAUDE.md") and
 * directories (e.g., "templates/") are supported.
 */
export async function diffFramework(
  templateDir: string,
  consumerHstackDir: string,
  frameworkPaths: readonly string[],
): Promise<FileDiff[]> {
  const diffs: FileDiff[] = [];

  for (const p of frameworkPaths) {
    const isDir = p.endsWith("/");
    const cleanPath = isDir ? p.slice(0, -1) : p;
    const templatePath = resolve(templateDir, cleanPath);
    const consumerPath = resolve(consumerHstackDir, cleanPath);

    if (isDir) {
      const templateFiles = await walkFiles(templatePath);
      const consumerFiles = await walkFiles(consumerPath);

      // ADD or OVERWRITE
      for (const [rel, tabs] of templateFiles) {
        const cabs = consumerFiles.get(rel);
        const fullRel = join(cleanPath, rel);
        if (!cabs) {
          diffs.push({
            kind: "add",
            from: tabs,
            to: resolve(consumerPath, rel),
            relpath: fullRel,
          });
        } else if (!(await filesEqual(tabs, cabs))) {
          diffs.push({
            kind: "overwrite",
            from: tabs,
            to: cabs,
            relpath: fullRel,
          });
        }
      }

      // REMOVE
      for (const [rel, cabs] of consumerFiles) {
        if (!templateFiles.has(rel)) {
          diffs.push({
            kind: "remove",
            to: cabs,
            relpath: join(cleanPath, rel),
          });
        }
      }
    } else {
      // Single file
      const tExists = await fs.pathExists(templatePath);
      const cExists = await fs.pathExists(consumerPath);
      if (tExists && !cExists) {
        diffs.push({
          kind: "add",
          from: templatePath,
          to: consumerPath,
          relpath: cleanPath,
        });
      } else if (tExists && cExists) {
        if (!(await filesEqual(templatePath, consumerPath))) {
          diffs.push({
            kind: "overwrite",
            from: templatePath,
            to: consumerPath,
            relpath: cleanPath,
          });
        }
      } else if (!tExists && cExists) {
        diffs.push({
          kind: "remove",
          to: consumerPath,
          relpath: cleanPath,
        });
      }
    }
  }

  return diffs;
}
