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

/**
 * Move a repo-relative path with `git mv`, falling back to a plain rename when
 * git refuses (file untracked, or no git available). Returns true when git
 * recorded the rename — which is what keeps `git log --follow` working across
 * the ADR-0010 kernel rename and lands the move already staged.
 */
export async function gitMove(
  cwd: string,
  from: string,
  to: string,
): Promise<boolean> {
  try {
    await execa("git", ["mv", from, to], { cwd });
    return true;
  } catch {
    await fs.move(resolve(cwd, from), resolve(cwd, to));
    return false;
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
