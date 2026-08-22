---
name: hstack-adversarial-review
description: "Use in a fresh session — never the one that wrote the change — to review a PR that touches a sensitive surface. Findings land as a PR comment; the author is the one who fixes them."
---

## Purpose

`/hstack-adversarial-review <pr-number>` reads an open PR cold and reports what is wrong, missing,
drifted or weakened. It orchestrates the `adversarial-reviewer` subagent and posts the findings on
the PR. It writes no file and changes no code.

Reviews are judgments, not evidence (kernel § Review). An empty findings list means the reviewer
found nothing, not that nothing is there — which is why an empty result is defended rather than
returned.

## When to invoke

On a PR touching one of the sensitive surfaces the kernel § Review names. Every PR already gets
`/review` and `/security-review` through `/wrap`; this is the deep pass on top, and its whole value
is that the session running it never saw the change being written.

**In a fresh session.** State it in one sentence before starting — "this session has not seen the
implementation conversation" — and if that is not true, stop and open a new one. This is
honor-system, as the kernel says; a sentence is the whole protocol.

## Steps

1. **Load the change.** `gh pr view <n>` for the description, `gh pr diff <n>` for the diff, plus
   the base commit so pre-existing files can be diffed. Read the living docs the diff touches,
   `hstack/context/invariants.md`, and the frozen `threat-model.md`. Do not load, ask for, or
   reconstruct the conversation that produced the change.
2. **Invoke `adversarial-reviewer`** with that material. The subagent sweeps six lenses and returns
   findings; it does not resolve them and does not touch the code.
3. **The test-immutability audit is mandatory** and is not subject to anyone's judgment about
   whether it is worth filing. Every test file that existed at the base is diffed; a modification
   or deletion without its canonical authorization echo — `Ok to change test <name>` /
   `Ok to delete test <name>`, in a commit message or the PR description — is a finding at `high`
   minimum. A bulk snapshot update is `critical`.
4. **Post the findings** with `gh pr comment <n>`, or as a GitHub review when they are anchored to
   lines. Each finding carries a severity, a category, the evidence in the diff, and what would
   resolve it.
5. **Resolution belongs to the author**: a corrective commit on the branch, or a tech-debt file
   written in the same PR (kernel § Tech-debt). The reviewer never pushes the fix.

## Output

One PR comment. No artifact, no status, no file in the repo.

## Stop conditions

Beyond the kernel's:

- The session has seen the implementation conversation. Halt and ask for a fresh one.
- The PR cannot be read, or its diff is unavailable.
- A living doc the review depends on is missing or stale. Say so in the findings; never invent its
  content (kernel § Context docs).
- The sweep came back empty and the defence cannot be written honestly. Halt and surface it — a
  defence nobody believes is worse than an open review.
- A high-severity finding is waved away without a fix or a tech-debt file. Do not silently retract:
  restate it with the evidence, and leave it in the comment.
