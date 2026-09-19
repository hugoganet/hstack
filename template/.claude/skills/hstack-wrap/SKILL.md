---
name: hstack-wrap
description: Use at the end of a change, before the PR — reads the diff against code-standards, runs /review and /security-review, audits test disclosure, updates the living docs the diff invalidated, writes the PR description.
---

## Purpose

`/hstack-wrap` closes a change. It is loaded fresh at the moment it runs, which is the point: the end-of-change rules do not have to survive two hundred turns of conversation in order to be applied. It is a checklist fired by an event, not a phase — nothing here is produced unless a change is actually ending.

## When to invoke

When the code and its tests are done and the next step is a pull request. Once per change; re-running it after a fix is normal and cheap.

Not on a change that is still moving, and never to merge — `/hstack-wrap` opens the PR and stops there.

## Inputs

None. The diff under review is everything that will land in the PR — committed, staged and unstaged — against the merge-base with the default branch.

## Steps

1. **Read `hstack/context/review-miss.md`** when it exists. A category a review has already missed once gets re-checked explicitly in the pass below; that is the whole reason the file exists.

2. **Read the diff against `hstack/context/code-standards.md`**, rule by rule, when the file exists. This is the pass the linter cannot make: a second implementation of something that already existed, a component talking to the network, an orchestrating function that also does the steps, a legacy path left wired, a returned error nobody reads. Fix what is found — the fix is usually the extraction or the deletion the rule names — and when a rule's `Seen here` line is empty and this diff is the first example, fill it in this PR. What survives on purpose is a tech-debt file, not silence.

3. **Run `/review`, then `/security-review`** on that diff. Fix what is fixable inside the announced perimeter. Everything else is declared in the PR description — the finding, and why it was not fixed. A finding is never dropped silently, and an empty result is reported as what it is: the reviewer found nothing.

4. **Audit test disclosure.** Diff the test files that already existed at the merge-base. Each one modified or deleted carries its tag — `behavior-change`, `refactor` or `obsolete` — in a commit body, and its plain-language line under a **Tests changed** heading in the PR description; writing that section is part of this step (kernel § Tests). An undisclosed edit is fixed here by disclosing it, not by halting. The one exception: if the honest tag would be *it was failing*, halt and fix the code instead.

5. **Ask each living doc whether this diff invalidated it**, and update it in this PR when it did (kernel § Context docs). When an entry point changed status — live, routable, off — the exposure column of the Module Map in `app-architecture.md` moves with it.

6. **Name the conscious shortcuts.** A shortcut that survives the merge becomes a file under `hstack/tech-debt/`, from the template, written in this PR and named in its description.

7. **Sensitive surface?** If the diff touches one (kernel § Review), the PR says so in its first line and asks for the deep pass in a fresh session — `/hstack-adversarial-review`.

8. **Write the PR description** from `references/pr-description.md`: intention, perimeter, decisions, shortcuts and tech-debt, the review findings split into what was fixed and what was declared, and the Notion feature it serves when there is one. When the consumer has a `.github/pull_request_template.md`, that rendered file is the one you fill — the reference file is the seed it was copied from, not a second authority.

9. **Run the fast lane locally, then commit, push and open the PR.** Typecheck, lint and the critical tests run here, on this machine, and are green before the commit — a red PR costs a paid CI round trip for something a local run would have caught in a minute. Lint is at `error`: fix the finding, never add a suppression or a disable comment to get past it (kernel § Stop conditions). If the repo names no fast-lane command, say so in the PR rather than inventing one. Commit in the `hstack-commit` format. Push and `gh pr create` only after explicit confirmation in the conversation.

## Output

One open PR against the default branch, carrying the code, the living-doc updates, any tech-debt file, and a description that says what the reviews found.

## Stop conditions

Beyond the kernel's:

- A pre-existing test was changed to turn a red suite green when the code is what is wrong.
- A hook or a check was bypassed to get here.
- A living doc is invalidated and you cannot update it. Say "stale" in the PR description; never invent the content.
