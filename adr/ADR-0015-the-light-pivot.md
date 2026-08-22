---
id: ADR-0015-the-light-pivot
type: adr
status: accepted
owner: hugoganet
decision-date: 2026-08-22
supersedes: null
superseded-by: null
related-change-specs: []
related-modules: []
promoted-from-kernel-fit: []
created: 2026-08-22
updated: 2026-08-22
schema-version: 2
---

## Title

The workflow built to make us ship well is what stopped us shipping. v0.17 removes every piece of hstack whose cost is paid on each change — the eleven-phase per-change flow, the artifact state machine, the subagent chain, the confirmation gates — and keeps what protects the work at no per-change cost: rules the agent reads once, CI, a review on every PR, and living docs. The tag `v0.16.0` is the complete version, frozen and waiting.

## Status

Accepted on 2026-08-22, ships as v0.17.0 on `main`. It follows the context-engineering sequence (ADR-0010 through ADR-0014) and is not a continuation of it: those five reduced what the models **read**, this one reduces what the humans and the models **do**.

## Context

Four months of hstack, and the MOSO MVP has not shipped. The framework is not the only reason, but it is a measurable one: a change that is an hour of work carries roughly ten times that in wall-clock — story, scaffold, spec interview, test-plan, plan, security review, data review, phase-by-phase implementation, verification, a fresh-session adversarial review, ship, finalize — each with its own subagent invocation and its own confirmation gate.

This is a different cost from the one the last five ADRs attacked. ADR-0009 instrumented tokens, ADR-0013 cut the kernel from 8,940 to 6,370 words, ADR-0014 replaced micro-prescriptions with judgment. All of them made every session cheaper. None of them made a single change faster, because the cost being paid is not tokens — it is the number of times a human has to answer, confirm, cut a session, and start another.

Three facts fix the trade-off:

- **We are pre-users.** First users land in two to three weeks. Before that, the dominant risk is never shipping, not shipping a bug. After that it changes, which is why the reactivation triggers below are named now rather than argued later.
- **There is no senior reviewer.** Hugo is a first-time technical co-founder and cannot play that role on his own PRs; Luke, the other co-founder, also codes through agents. A large part of hstack existed to compensate for that absence, and the compensation is worth keeping — just not once per phase. It becomes an agent review on *every* PR, plus a fresh-session deep pass on sensitive surfaces.
- **Ceremony has linear cost; rules do not.** A per-change artifact is paid every change forever. A rule in the kernel, a CI lane, a living doc that the agent updates in the PR that invalidated it — all are paid once, or paid by the machine.

## Decision

**v0.17 is a subtractive release on `main`. The tag `v0.16.0` is the complete version, frozen — we freeze a version, not the repository.** Consumers stay on the normal upgrade path; there is one source, one installer, and Luke is served by the same mechanism as Hugo.

The kernel goes from 6,370 words to about 1,690 as a subtractive diff: one section kept as written, fifteen condensed, nine removed. Where a rule survives, its v0.16 wording survives with it. Nothing is redesigned and nothing moves — living docs stay at `hstack/context/`, debt at `hstack/tech-debt/`, decisions at `hstack/adr/`.

**What survives.** Nine Skills: `adversarial-review` (no artifact, no status — findings go in the PR), `adr-new`, `commit`, `data-architecture`, `app-architecture`, `story` (a product tool that writes into Notion, never a gate on code), and three new ones the kernel names before they exist — `/wrap`, `/promote`, `/test-audit`. Six subagents: `adversarial-reviewer`, `test-strategist`, `data-architect`, `app-architect`, and — because `adr-new` and `story` invoke them — `spec-author` and `product-manager`, whose fate is decided in the second wave.

**What is removed**, by one mechanical criterion — *what artifact or status does this write, and does it still exist?* The per-change workflow family, the tech-debt status lifecycle, kernel-fit, coordination, telemetry, `init` / `scaffold` / `configure`, and the validator with its rule registry.

**Two pieces are added**, both on observed evidence rather than anticipation: the **exposure map** (an entry-point column of the Module Map — agents were repeatedly wrong about what a user can actually reach) and **user stories** as a product tool. Both are bounded: the exposure map grades product severity and never security severity, and no rule ever requires a change to reference a story.

**The two-occurrence rule governs hstack itself.** A piece of process comes back when a real problem has occurred twice, and the kernel says who may put it back. The v0.17 work is timeboxed in days, not weeks: an overrun is the symptom of the relapse this ADR exists to end, and the response is to ship the state reached and go back to the product.

## Consequences

### Positive

- The cheapest change is now a change. No artifact is produced by shipping a normal fix, so the workflow stops charging rent on small work.
- The kernel is about 2.1k tokens per session instead of 9.5k, and it is read by a human in five minutes — which matters more, because Luke has to read it too.
- Two written artifacts remain: PR descriptions and rare ADRs. Both are read by someone.
- The improvement contract in § How this file changes is a ratchet: agents propose, Hugo alone edits, and `review-miss.md` plus `tech-debt/` make "twice" countable rather than rhetorical.

### Negative

- **The traceability hole is permanent.** Changes shipped between this pivot and any reactivation have git history and PR descriptions and nothing else. No later decision recovers them, and if a compliance requirement arrives, this window is simply not auditable.
- **We removed one of the two mechanical judges.** The validator enforced artifact contracts deterministically; CI is now the only check that is not an LLM judgment. The kernel says so out loud, which is honesty, not mitigation.
- **The exposure map and `invariants.md` are hand-maintained.** The kernel asserts drift is detectable by diffing real routes against the map — nothing in v0.17 actually detects it, so the first drift will be found by a human or not at all.
- **We are dropping the instrument that could have judged this decision.** Telemetry is frozen, so the ×10 that motivates this ADR stays a judgment, and so will "it worked". This is the fourth consecutive bet with no measurement between any two of them, and it is the largest.
- **The kernel names three Skills that do not exist yet.** For the days between this release and the second wave, part of the contract has no implementation.

### Neutral

- Parallel Conductor sessions are unaffected: parallelism came from git worktrees, not from hstack's coordination layer.
- The 295 existing tech-debt files stay valid and grep-able. Nothing validates them any more; nothing needs to.

## Alternatives Considered

**Option A — keep v0.16 and use it selectively.** Rejected: a workflow followed when convenient is not followed. It was already happening informally, which produced the worst of both — the cost of maintaining the framework, without the guarantees it was supposed to buy.

**Option B — write a fresh light `CLAUDE.md` in the product repo and freeze the hstack repo.** The original plan. Rejected on a ground fact: moso-app runs hstack 0.7.1, nine minor versions behind, so "light" would have been written from scratch against a stale base — the opposite of a subtractive diff. Keeping the kernel here preserves one source, a diff reviewable *as a diff*, the installer path, and the rhizome framing where hstack is the engineering module.

**Option C — keep the artifacts, drop the gates.** Rejected: the cost is in producing the artifacts, not in reading them at a gate. This removes the protection and keeps the bill.

**Option D — archive the repository.** Rejected: a tag freezes a version perfectly well, and the repo is where the v2 process comes back from.

## Forecloses / Enables

**Enables.** The 0.7.1 → 0.17 upgrade, which *is* the unwiring of the old install. `/wrap`, `/promote` and `/test-audit`, whose contract this kernel states. And a return path with named triggers: a collaborator beyond Luke or a real rhizome module brings coordination back; a first paying user or a first incident brings the security hardening back; a compliance requirement brings the audit substrate back.

**Forecloses.** Any post-hoc audit of the window this pivot opens. The kernel-fit loop, which has no artifacts left to measure. And anything downstream that reads change-spec frontmatter — that state machine is gone, and reintroducing it is a new decision, not a revert.
