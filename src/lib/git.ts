import { execa } from "execa";
import { resolve, dirname } from "node:path";
import fs from "fs-extra";

/** Walk up from `start` to find the repo root containing `.git`. Returns null if not in a git repo. */
export async function findGitRoot(start: string): Promise<string | null> {
  let dir = resolve(start);
  while (true) {
    if (await fs.pathExists(resolve(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** True if working tree has no uncommitted changes (staged or unstaged). */
export async function isWorkingTreeClean(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execa("git", ["status", "--porcelain"], { cwd });
    return stdout.trim() === "";
  } catch {
    return false;
  }
}
