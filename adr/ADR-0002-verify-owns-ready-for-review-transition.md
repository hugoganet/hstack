---
id: ADR-0002-verify-owns-ready-for-review-transition
type: adr
status: accepted
owner: hugoganet
decision-date: 2026-05-21
supersedes: null
superseded-by: null
related-change-specs:
  - 2026-05-knowledge-kg-ui-bucket-and-entity-rendering
related-modules: []
created: 2026-05-21
updated: 2026-05-21
schema-version: 1
---

## Title

`/hstack:verify` owns the change-spec `ready-for-implementation → ready-for-review` transition.

## Status

Accepted on 2026-05-21. No supersession. Extends ADR-0001's mechanical-operations catalog with the third (and previously omitted) change-spec phase-completion transition.

## Context

ADR-0001 established that mechanical frontmatter operations — status flips, reciprocal back-reference writes, Resolution Log appends — are performed by Skills directly in the main Claude Code session, not by invoking `spec-author`. Its enumerated catalog of change-spec mechanical advances included three transitions: `ready-to-plan → ready-for-implementation`, `ready-for-review → ready-to-ship`, and `ready-to-ship → shipped`. Of those, two have a Skill that owns them — `/hstack:adversarial-review` writes `ready-for-review → ready-to-ship` at step 107 of its SKILL.md, `/hstack:finalize` writes `ready-to-ship → shipped` at step 3 of its SKILL.md — and the third (`ready-to-plan → ready-for-implementation`) is explicitly deferred to a future `/hstack:advance` Skill in ADR-0001's "Out of scope" section.

The omission. ADR-0001's catalog does not list `ready-for-implementation → ready-for-review`. The kernel's Status lifecycle section says only that subagents write transitions at their own phase completion and Skills write mechanical transitions; neither rule names which Skill owns this specific change-spec advance. The downstream effect: after `/hstack:verify` lands `verification.md` at `status: passed`, the change-spec stays at `ready-for-implementation`. The next Skill in the chain, `/hstack:adversarial-review`, has a precondition (its SKILL.md line 61) that requires the change-spec to already be at `ready-for-review`. In practice that precondition has been tolerated — the most recent change (`2026-05-knowledge-kg-ui-bucket-and-entity-rendering`) shipped while its `spec.md` showed `status: ready-for-implementation` at the moment the adversarial-review ran. Adversarial-review of that change surfaced the gap as finding F-05.

The kernel's "no manual frontmatter edits" rule means there is no legal path for the engineer to fix the missed transition by hand. The gap can only be closed by giving a Skill ownership of the write.

Three resolutions were evaluated:

- **(A)** Extend `/hstack:verify` to write the change-spec advance after `verification.md` reaches `passed`. Mechanical write per ADR-0001.
- **(B)** Add a new `/hstack:ready-for-review <change-id>` Skill whose sole purpose is the transition, invoked between verify and adversarial-review.
- **(C)** Drop the `ready-for-review` intermediate status entirely. The compound condition (verification.md at `passed` AND adversarial-review.md not yet at `findings-resolved`) would substitute.

## Decision

`/hstack:verify` is extended to perform the mechanical change-spec advance `ready-for-implementation → ready-for-review` when, and only when, `verification.md` lands at `status: passed`. The write is performed by the Skill orchestrator in the main session via the `Edit` tool — not by the `verifier` subagent — following ADR-0001's pattern. The verifier subagent retains its mechanical-verification lane and continues to write only `verification.md`.

The boundary is the same one ADR-0001 set: *if the Skill knows the value to write before invoking, the Skill writes directly.* When the verifier returns with `verification.md` at `passed`, the change-spec advance is fully determined by that postcondition and the change-spec's current status. No interview is required. No engineer judgment is required beyond the original `/hstack:verify` invocation.

Concrete scope:

- A new orchestration step is added to `/hstack:verify` SKILL.md, after the verifier's status-transition step (current step 7) and before the validator step (current step 8). The new step reads: when `verification.md` reaches `status: passed`, read `spec.md`; if its `status` is `ready-for-implementation`, advance it to `ready-for-review`, bump `updated:` to today, run `validate-spec.ts`, and commit with message `change-spec(<change-id>): ready-for-review`. Idempotent: re-running on a change-spec already at `ready-for-review` (or any downstream status) is a no-op for this step.
- A proposed-diff preview is printed before the change-spec edit lands, per the kernel's `## AI writes, humans confirm` mechanical-operations adaptation. Until `validate-spec.ts` ships as a real script, this preview is the v1 contract check.
- The auto-commit for the change-spec advance is a separate commit from the `verification(<change-id>): passed` commit — one commit per status transition, matching the finalize precedent's TDs-first ordering.
- The kernel's `## Status lifecycle` section is amended with one sentence naming `/hstack:verify` as the writer-of-record for this transition, mirroring the existing inline references to `test-strategist` and `security-reviewer` for their own artifacts.
- ADR-0001's enumerated catalog (Decision section, "Concrete scope") is left as-is — this ADR extends rather than amends the prior decision, and the catalog gap is closed by adding this ADR's transition to the kernel's Status lifecycle section.
- `/hstack:adversarial-review`'s SKILL.md precondition (line 61, "Verify the change-spec exists and is at `status: ready-for-review`") remains correct as-written. It is now consistently satisfied by the new `/hstack:verify` behavior.

Out of scope:

- Migration of `/hstack:adversarial-review` step 107 from its current inline-subagent-write pattern to the Skill-owned mechanical-write pattern this ADR establishes. The current implementation works; the migration would save ~25k subagent-context tokens per change and is a clean follow-up but adds noise to this ADR's blast radius.
- The `ready-to-plan → ready-for-implementation` transition, which remains deferred to the future `/hstack:advance` Skill per ADR-0001's "Out of scope" section. The trigger for that transition is engineer-initiated multi-gate composition ("all of test-plan, plan, security-review, data-review, ui-brief, figma-handoff at terminal"), which is fundamentally different from a Skill-coupled post-phase advance and does not fit the pattern this ADR codifies.
- Backfill of in-flight changes that shipped under the gap (the `2026-05-knowledge-kg-ui-bucket-and-entity-rendering` change). Per TD-03 the change-spec is already at a terminal status; reconstructing the missed transition retroactively is not worth the auditing complexity. The fix applies forward.

## Consequences

### Positive

- The change-spec lifecycle catalog becomes complete: three of three terminal-artifact Skills own the corresponding change-spec advance (`/hstack:verify` for `ready-for-implementation → ready-for-review`, `/hstack:adversarial-review` for `ready-for-review → ready-to-ship`, `/hstack:finalize` for `ready-to-ship → shipped`). The catalog reads consistently for the first time.
- Finding F-05 from the `2026-05-knowledge-kg-ui-bucket-and-entity-rendering` adversarial-review is closed structurally rather than by ad-hoc remediation. Future changes do not strand their `spec.md` at `ready-for-implementation` after verification passes.
- Adversarial-review's precondition that the change-spec be at `ready-for-review` is now consistently satisfied without engineer intervention. The Skill's "tolerated this and didn't flip it" workaround is no longer needed.
- The decision sets an explicit precedent: *the Skill that produces a terminal phase artifact also writes the corresponding change-spec phase-completion advance.* When the future `/hstack:advance` Skill is built, the boundary between its scope (engineer-initiated multi-gate advances) and per-Skill post-phase advances (this ADR's pattern) is already clear in the kernel.
- Zero new Skill surface for engineers to remember. The fix is invisible to the daily workflow — `/hstack:verify` now does the right thing automatically.

### Negative

- Mechanical-write logic duplicates further. ADR-0001 already noted that each Skill carries its own four-step write sequence (flip status + bump `updated` + run validator + commit); this ADR adds a fourth Skill to that list (`/hstack:verify` joins `/hstack:finalize`, `/hstack:tech-debt-resolve`, `/hstack:tech-debt-wontfix`, `/hstack:tech-debt-stale`, and the reciprocal-write half of `/hstack:tech-debt-new`). The deferred mitigation (a shared `hstack/scripts/transitions.ts` utility, ADR-0001 Option D) becomes incrementally more attractive but remains out of scope until duplication is painful enough to maintain.
- The `/hstack:verify` Skill grows beyond its mechanical-verification lane. Before this ADR, verify produced `verification.md` and stopped; the only artifact it touched was its own. After this ADR, verify also writes the change-spec. The verifier *subagent* remains mechanical-verification-only — the cross-artifact write is performed by the Skill orchestrator — but the Skill's responsibility surface grows. A future engineer reading SKILL.md will see a longer "Outputs" section and must understand that the change-spec edit is the Skill's, not the subagent's.
- The `/hstack:adversarial-review` step 107 pattern (inline subagent-driven change-spec write) and the new `/hstack:verify` pattern (Skill-driven change-spec write) now disagree on who-writes-the-cross-artifact-advance. Both work, but the inconsistency is real. The follow-up to migrate step 107 to the Skill-owned pattern is captured in the Decision's "Out of scope" — until it lands, two patterns coexist for the same kind of transition.

### Neutral

- No change to the audit trail's commit-message granularity. The same auto-commits land at the same status transitions; the new commit (`change-spec(<change-id>): ready-for-review`) is one additional commit per change between the existing `verification(<change-id>): passed` and the start of `/hstack:adversarial-review` work.
- No change to validator behavior. `validate-spec.ts` runs post-write either way; until it ships, the proposed-diff preview is the v1 contract check per the kernel's Mechanical operations adaptation.
- The `verifier` subagent's contract and tool surface are unchanged. Only the orchestrating Skill grows.

### Challenge prompt — name two consequences that look bad

1. **The fix entrenches the gap between adversarial-review's inline-subagent write (step 107) and the rest of the kernel's Skill-owned mechanical-write pattern.** Before this ADR, both transitions (`ready-for-implementation → ready-for-review` and `ready-for-review → ready-to-ship`) had no consistent owner — one was missing entirely, the other was written by a subagent. After this ADR, one is owned by a Skill (the new way) and the other by a subagent (the old way). A reader of the kernel could conclude that the two transitions are deliberately patterned differently — they are not, and the inconsistency is technical debt this ADR creates by half-fixing the problem. The mitigation would have been to migrate adversarial-review's step 107 to the Skill-owned pattern in the same change; the cost of doing so would have been substantially broader blast radius and a delayed F-05 close, which is why it was scoped out.
2. **The `/hstack:verify` Skill is the first Skill that writes a non-its-own-artifact status transition without an explicit engineer trigger between the production-of-postcondition and the cross-artifact-write.** `/hstack:finalize` requires the engineer to invoke it after merge; `/hstack:tech-debt-resolve` requires the engineer to pick the TD. `/hstack:verify` will perform the change-spec advance silently as part of its run. The engineer's invocation of `/hstack:verify` is the implicit confirmation, and the proposed-diff preview is the explicit one, but the conceptual model — "verify produces verification.md and stops" — no longer holds. A reasonable engineer expecting verify to be inert beyond its own artifact will be mildly surprised. The mitigation is the proposed-diff preview before the change-spec edit lands.

## Alternatives Considered

**Option B — New `/hstack:ready-for-review <change-id>` Skill.** A new Skill whose sole purpose is the transition, invoked between `/hstack:verify` and `/hstack:adversarial-review`. **Rejected** because it is pure ceremony. The precondition for the transition (`verification.md` at `passed`) is exactly the postcondition of `/hstack:verify`. There is no separate engineer judgment, no asynchronous trigger, no information that is not already in the calling Skill's hand. Adding a Skill the engineer must always run immediately after verify is a friction tax with zero engineering value, and it contradicts ADR-0001's central insight that *if the Skill knows the value to write before invoking, the Skill writes directly.* The Skill would also foreshadow the future `/hstack:advance` Skill incorrectly — `/hstack:advance`'s purpose is to handle engineer-initiated multi-gate composition for the `ready-to-plan → ready-for-implementation` transition (where the trigger is fundamentally engineer judgment), not to handle Skill-coupled post-phase advances.

**Option C — Drop the `ready-for-review` intermediate status entirely.** Treat it as redundant with the compound condition "verification.md at `passed` AND adversarial-review.md not yet at `findings-resolved`." Have adversarial-review write `ready-for-implementation → ready-to-ship` when it terminates cleanly. **Rejected** because (a) the status carries honest audit signal — "verified but not adversarially reviewed" is a distinct operational state from "reviewed but not merged," and removing it loses that signal in the git log and in `/hstack:help` output; (b) the kernel-deep blast radius is disproportionate to the problem — propagates to the change-spec lifecycle catalog, the `/hstack:adversarial-review` step 107 write, the `/hstack:ship` precondition gate that reads `ready-to-ship`, the validator's status enum, and the audit-trail expectations; (c) the asymmetric jump `ready-for-implementation → ready-to-ship` skipping all human review states reads badly in commit history. The simplification is real but not worth the architectural cost.

**Option D — Have the `verifier` subagent perform the change-spec write inline, matching adversarial-review's step 107 pattern.** **Rejected** because it contradicts ADR-0001 and pays the ~25k-token subagent-context cost for what is a 2-character frontmatter change. The verifier should stay in its mechanical-verification lane and write only `verification.md`. The cleaner pattern, established by `/hstack:finalize`, is the Skill orchestrator performing the cross-artifact write directly after the subagent returns. This ADR adopts that pattern; a follow-up could migrate adversarial-review's step 107 to match.
