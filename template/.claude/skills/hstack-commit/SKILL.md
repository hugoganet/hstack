---
name: hstack-commit
description: "Use to commit: the one Commitizen format Hugo, Luke and the agents all write, so the git log reads the same whoever wrote the commit. Stages by named path, honours every hook, pushes only on confirmation."
---

## Purpose

One format for every commit in the repo — Hugo's, Luke's, an agent's. A reader scanning `git log` cannot tell which is which, because all three write `<type>(<scope>): <summary>`. It costs nothing per change, which is why it survived the pivot.

## When to invoke

Whenever there is something to commit: the end of a change (`/hstack-wrap` commits in this format), a typo fix, work in progress before stepping away.

## Inputs

Optional `--push`: push after committing — still subject to per-invocation confirmation.

## Steps

1. **Read `git status --short`** and show the file list with its status markers.

2. **Stage by named path.** Not `git add -A`, which sweeps in `.env`, credentials and large binaries. Propose the specific paths that belong to the change being committed; the engineer confirms. `git add -A` is available when every file is clearly part of one logical change and no filename matches a sensitive pattern (`.env`, `secret`, `credential`, `*.key`, `*.pem`) — with explicit confirmation. If a staged filename matches one of those patterns, halt and ask.

3. **Show the diff.** `git diff --cached --stat`, then the full `git diff --cached` when it is small enough to read. For a large one, the stat plus the most-changed files.

4. **Draft the message.**
   - `<type>(<scope>): <summary>`, where `<type>` is one of `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`, `ci`.
   - `<scope>` names the area actually touched — never an invented or aspirational one. When the change spans unrelated areas, no single honest scope exists: propose splitting it into several commits.
   - `<summary>` ≤ 72 characters, imperative present ("add", not "added"), no trailing period.
   - Body, when it earns its place: the why, not the what.
   - **Never "Generated with Claude Code" or any similar attribution.**
   - Footer: conventional-commits footers only (`BREAKING CHANGE:`, `Refs: <issue>`).

5. **Confirm, then commit.** Show the message; commit on confirmation. Every hook runs — `--no-verify`, `--no-gpg-sign` and every other bypass are forbidden, whatever the deadline.

6. **Verify it landed.** `git log -1 --format='%h %s'`, surfaced.

7. **Push only on explicit confirmation.** A push is visible to others and hard to reverse, so it is never automatic. Push to the current branch's tracked upstream, never with `--force`.

## Output

One commit on the current branch. Optionally one push, confirmed in the conversation.

## Stop conditions

Beyond the kernel's:

- Nothing to commit — the tree is clean.
- A staged filename matches the sensitive-pattern list.
- A pre-commit hook fails. Surface its output and fix the cause; never bypass. A gpg signing failure is the same case — fix the gpg configuration.
- The push would be forced, or `--amend` would rewrite a commit that is already pushed.
- `--push` was asked for and the branch has no upstream. Ask which remote and branch.
- The push is rejected as non-fast-forward. Rebase and retry; never propose `--force`.
