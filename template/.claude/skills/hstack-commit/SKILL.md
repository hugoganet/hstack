---
name: hstack-commit
description: Use to commit hand-made edits in the same Commitizen format hstack subagents use for their auto-commits. For work outside a subagent flow only — subagents auto-commit at status transitions on their own.
tools:
  - Bash
  - Read
  - Grep
---

## Purpose

`hstack-commit` is the human-driven commit Skill that matches the Commitizen format hstack subagents use for their auto-commits. The point is uniform git history: a reader scanning the log cannot tell whether a given commit was a subagent auto-commit or a human-typed one, because both follow `<type>(<scope>): <summary>`. It does not replace the kernel's auto-commit-at-status-transition rule — subagents still auto-commit on their own. The Skill is for everything else: typo fixes, ad-hoc cleanups, edits between hstack invocations, the occasional manual touch.

## When to invoke

Invoke when:
- You've made an edit by hand (outside a hstack subagent flow) and want to commit it.
- You want to commit work-in-progress before stepping away.
- A subagent auto-commit didn't fire (rare, but possible if a Skill halted mid-phase) and you need to capture state manually.

Do NOT invoke inside an hstack subagent flow — the subagents auto-commit on status transitions per the kernel.

## Inputs

- No positional arguments. The Skill drives entirely from `git status` and conversation.
- Optional `--push` flag: if set, push after committing (still subject to explicit per-invocation confirmation; the system never force-pushes).

## Preconditions

Before any work:

- Verify the working directory is a git repository.
- Read `hstack/config.yaml` if present, to namespace the commit scope when committing inside an hstack-governed repo. Absent config is fine — the Skill works on any repo, hstack-installed or not.
- Verify there are changes to commit. If working tree is clean, halt with "nothing to commit."

## Orchestration steps

1. **Read git status.** Run `git status --short` and show the file list with their status markers. Categorize: modified, untracked, deleted, renamed.

2. **Stage with intent.** Default to staging by named path, NOT `git add -A`. The latter sweeps in `.env`, credentials, large binaries, and other unintended files. The Skill proposes the specific files to stage based on the change being committed, the engineer confirms.
   - Exception: if every file is clearly part of one logical change AND none of the file names match common sensitive patterns (`.env`, `secret`, `credential`, `*.key`, `*.pem`), the Skill may propose `git add -A` with the engineer's explicit confirmation.
   - Sensitive-file guardrail: if any staged file's name matches the sensitive-pattern list, halt and ask before committing.

3. **Show the diff.** Run `git diff --cached --stat` for a summary, then `git diff --cached` for the full diff if the diff is reasonably small. For large diffs, show stat plus a sample of the most-changed files.

4. **Draft a Commitizen-format commit message.** Following the format codified for hstack:
   - Format: `<type>(<scope>): <summary>`
   - `<type>` is one of: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`, `ci`
   - `<scope>` names the area actually touched — never an invented or aspirational one. For commits inside hstack-governed code, prefer the change-id, the area, the Skill name, or the artifact type (e.g., `change-plan`, `billing`, `implement`, `data-review`). For non-hstack commits in the same repo, use the natural area (e.g., `auth`, `orchestrator`, `webhooks`). When the change spans several unrelated areas, no single honest scope exists — propose splitting into multiple commits.
   - `<summary>` ≤ 72 characters, imperative present tense ("add" not "added"), no trailing period.
   - Body (optional): the "why" rather than the "what". For commits inside hstack workflow, name the related change-id or artifact. For status transitions, name the transition explicitly.
   - **Never add "Generated with Claude Code" or similar attribution.** The user's global rule.
   - Footer: only conventional-commits footers (`BREAKING CHANGE:`, `Refs: <issue>`) when applicable.

5. **Confirm and commit.** Show the proposed commit message to the engineer. On confirmation, run `git commit -m "<subject>" -m "<body>"` (HEREDOC for multi-line bodies). Honor every git hook — `--no-verify`, `--no-gpg-sign`, and other bypass flags are forbidden.

6. **Kernel rules still apply.** Committing by hand does not relax the kernel's database-workflow or forbidden-tools rules. A `service_role` key, a `supabase db push` against a remote project, or any other kernel-forbidden artifact is forbidden on this path exactly as it is on the subagent path.

7. **Verify the commit landed.** Run `git log -1 --format='%h %s'` and surface the result.

8. **Push (only with explicit confirmation).** Push is hard-to-reverse and visible to others — never auto-push. If `--push` was provided, ask for confirmation in the conversation; if not provided, end without pushing. When pushing, use the current branch's tracked upstream (no `--force`, no force-with-lease without per-invocation authorization, no push to `main` if the current branch is `main` without explicit confirmation).

## Outputs

- One git commit on the current branch.
- Optionally, a `git push` to the current branch's upstream — but only with explicit per-invocation confirmation.
- No artifact writes. No subagent invocations.

## Auto-commit triggers

None. This Skill IS the commit — there is nothing else for it to auto-commit. Subagents have their own auto-commit logic governed by the kernel.

## Idempotency contract

Not idempotent in the strict sense — a commit is a one-shot operation. Re-running the Skill on a clean working tree halts with "nothing to commit," which is the natural idempotency boundary.

## Stop conditions

Beyond the kernel's general stop conditions:

- Working tree is clean. Nothing to commit.
- A staged file's name matches the sensitive-pattern list (`.env`, `*secret*`, `*credential*`, `*.key`, `*.pem`). Halt and ask.
- A pre-commit hook fails. Investigate and fix the underlying issue — do NOT bypass with `--no-verify`. If the fix requires out-of-scope edits (when committing inside an hstack-governed change), halt and surface as a scope-amendment situation.
- The proposed commit message exceeds 72 characters on the summary line. Re-draft.
- A destructive push operation is requested (`--force`, force-with-lease, push to `main`) without explicit per-invocation authorization in the current conversation. Halt and confirm.
- `git commit --amend` would rewrite a commit that has already been pushed. Halt and confirm per-invocation; amending published history is not a default.
- The engineer requested `--push` but the current branch has no upstream. Halt and ask which remote / branch to push to.

## Failure modes

- **Pre-commit hook fails.** Investigate; surface the hook's output; propose a fix. Re-run the commit attempt with the fix in place. Never bypass.
- **`gpg-sign` configured but signing key unavailable.** Surface the gpg error; do NOT bypass with `--no-gpg-sign`. Engineer fixes their gpg config and re-runs.
- **`git push` rejected (non-fast-forward).** Surface the rejection; recommend `git pull --rebase` then re-attempt; never propose `--force` without explicit authorization.
- **Empty commit attempted.** If `git add` left the index empty (e.g., every staged change was already committed), halt with the empty-commit message; do not use `--allow-empty` without engineer confirmation.
