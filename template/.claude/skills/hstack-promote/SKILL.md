---
name: hstack-promote
description: Use after a PR merges, to release it — pending production migrations, a smoke test on the unpromoted production build, then promotion. The concrete commands live in infrastructure.md § Deploy Pipeline.
---

## Purpose

`/hstack-promote` is the only deploy step hstack carries. The **sequence** lives here; the **commands** live in `hstack/context/infrastructure.md` § Deploy Pipeline. That split is deliberate: the sequence is the same whoever hosts the product, and a provider hardcoded here would be wrong for the next one.

## When to invoke

After a PR merges. Short trains — promote every two or three days rather than letting merges pile up, and let a change on a sensitive surface travel alone.

One promoter at a time. Say you are promoting before you start, because two overlapping promotions cannot be untangled afterwards.

A hotfix takes the same PR and the same fast lane. It skips the preview and the train, never the checks.

## Preconditions

- The PR is merged and the fast lane is green on what is about to ship.
- `hstack/context/infrastructure.md` has a § Deploy Pipeline naming the six commands this sequence needs: apply a pending migration to production, list deployments and their state, smoke-test a specific deployment URL, read production logs, promote a deployment, roll back to the previous one.

**If that section is missing, or does not name them, halt.** Guessing a production command from a provider's documentation is how the wrong project gets migrated.

## Steps

1. **Confirm the preconditions.** Merged; fast lane green.

2. **List the pending production migrations** and show them to the human. Ask: *migrations OK?* Apply them only on an explicit yes, then verify they applied.

3. **Wait for the production build** of the merge commit to reach a ready state.

4. **Smoke-test the unpromoted build** at its own URL — the deployment that carries the new code against the new schema, before any user can reach it. Check its health and its error logs, then hand the URL to the human, who tests the behaviour. This step is the entire reason the pipeline is staged.

5. **Check the exposure map.** If this release changes what a user can reach, the Module Map column in `app-architecture.md` is updated before the promotion, not after.

6. **Ask: staging OK, do we promote?** Promote on an explicit yes. Nothing else is an authorization.

7. **Watch production for five minutes** — error logs, then the error tracker. A release nobody looked at is not a release that worked.

8. **If it screams, roll back** by re-promoting the previous deployment. The migrations stay: they are additive by default, so the previous code runs against the new schema. Contraction ships in a later PR (kernel § Security checklist).

## Output

One production deployment promoted, or one rolled back — and, when the exposure map moved, the commit that moved it.

## Stop conditions

Beyond the kernel's:

- The fast lane is not green on what is about to be promoted.
- `infrastructure.md` has no § Deploy Pipeline, or it does not name the six commands.
- Someone else is already mid-promotion.

The kernel forbids a write-capable MCP against production outside this skill. This sequence is where that exception is spent — on the migration in step 2, with the human's yes. Enable it for that step; disable it afterwards.
