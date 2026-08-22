---
name: hstack-adr-new
description: Use when a decision is a one-way door — not fixable in one PR — to draft its ADR at hstack/adr/ADR-NNNN-<slug>.md, in the same PR that implements the decision.
---

## Purpose

An ADR is one page about a door that opens only one way. The kernel's entry test comes first and disqualifies most candidates: **fixable in one PR? Then there is no ADR** — the decision belongs in the PR description, and this skill says so and stops. What survives the test is worth the page, because in six months the reasoning is gone and only the record is left.

## When to invoke

When a decision cannot be walked back inside one PR: a datastore, a tenancy model, a protocol, a constraint accepted from outside. Drafted by the agent in the PR that implements the decision — not before it in a separate ceremony, and not after it from memory.

## Inputs

`<slug>`, kebab-case, optional. Absent, propose one from the decision and have it confirmed.

## Steps

1. **Apply the entry test.** Fixable in one PR? Say so and stop. Nothing else happens.

2. **Compute the id.** Read the files under `hstack/adr/`, take the highest `ADR-NNNN`, add one, zero-pad to four digits. The file is `hstack/adr/ADR-NNNN-<slug>.md`, from `hstack/templates/adr.md`.

3. **Walk the sections with the human**, one at a time, writing each as it is confirmed. One page in total — the constraint is real, and a section that wants three pages is describing several decisions.
   - **Title** — a short noun phrase.
   - **Status** — accepted, on today's date. A supersession is one line of prose here: `Supersedes ADR-NNNN`. The superseded ADR is not edited; `git grep -n "Supersedes ADR-0007" hstack/adr/` is how its replacement is found. That is the accepted cost of having no frontmatter to keep in sync.
   - **Context** — the forces and the constraints, not the decision.
   - **Decision** — one paragraph, an active sentence.
   - **Consequences** — positive, negative, neutral, and the trade-off actually accepted. The challenge is mandatory, and it is the part of this skill that earns its cost: **name two consequences that look bad. If you can't, what alternative would have made them visible?** An ADR whose consequences are all good is an advertisement.
   - **Alternatives Considered** — one paragraph each, with why it lost.
   - **Forecloses / Enables** — against `hstack/context/roadmap.md`: one line for what this makes more expensive, one for what it makes cheaper. "None" is a real answer; a missing or stale roadmap gives `n/a — roadmap stale/missing`. Advisory, never a gate.

4. **Leave it in the diff.** The ADR ships in the PR that implements the decision, and that PR's description names it (kernel § Workflow).

## Output

One file — `hstack/adr/ADR-NNNN-<slug>.md`, one page — in the implementing PR.

## Stop conditions

Beyond the kernel's:

- The decision is repairable in one PR. This is the common case, not a failure.
- The slug is already used by an existing ADR.
- The challenge prompt yields no two bad-looking consequences after a real attempt. Either think harder, or accept that this may not be ADR-worthy.
- Editing an accepted ADR is what is actually being asked. Agents do not rewrite one (kernel § How this file changes); a revision is a new ADR that supersedes it.
