---
id: ADR-0003-category-b-enables-field
type: adr
status: accepted
owner: hugoganet
decision-date: 2026-05-22
supersedes: null
superseded-by: null
related-change-specs: []
related-modules: []
created: 2026-05-22
updated: 2026-05-22
schema-version: 1
---

## Title

Split the `internal-tooling` no-story carve-out into two categories: keep `internal-tooling: true` for engineering-only code (Category A), add `enables: [<downstream-change-spec-id>]` for foundational prerequisites (Category B). Add the reciprocal `enabled-by` and validator rules SP-13 (mutual exclusion) and SP-14 (reciprocity).

## Status

Accepted on 2026-05-22.

## Context

Until now the kernel offered a single carve-out for change-specs that have no driving user story: `internal-tooling: true`. SP-09 (and its ship-time mirror GT-08) reads: *`user-stories` non-empty UNLESS `internal-tooling: true`*. The flag was load-bearing because the alternative (refusing to advance any spec without a story) would block legitimate engineering-only work — CI scripts, dev dashboards, internal tooling that genuinely has no user on the other end.

The conflation surfaced during real workflow use. The `internal-tooling: true` escape was being applied to two semantically distinct categories of change:

- **Category A — True internal tooling.** Engineering-only code that NEVER ships on a user path. Scripts under `scripts/`, CI workflows, dev-only dashboards, seed-data generators, validators that run in `hstack/scripts/`. Honestly has no user-facing surface; no story will ever be written because no user is on the path.
- **Category B — Foundational prerequisite.** Production code that DOES ship on a user path, but this specific change has no user-observable behavior because the user-facing consumer hasn't been wired yet. Schema migrations that precede UI rendering, taxonomy plumbing that enables a downstream `compose_component` change, an RPC that a future UI will call. User value lands in a named downstream change-spec, not this one.

Both categories legitimately have "no driving user story for THIS specific change," but they're not the same thing. Conflating them under one flag has three concrete costs:

1. **Audit fidelity.** When someone asks "what's the user value of this change?", Category A's honest answer is "none, it's internal." Category B's honest answer is "look at the downstream change-spec that consumes this." The single flag erases that distinction, so the audit query collapses to "no user value" for both cases — wrong for B.
2. **Engineer ergonomics.** Engineers know intuitively that Category-B work is "for users, eventually" while Category-A work is "for engineers." Forcing both under the same flag pushes engineers to either (a) lie by setting `internal-tooling: true` on production code they know will ship to users, or (b) invent a placeholder story to dodge the flag — both bad.
3. **Workflow gaps.** Category B genuinely benefits from a typed link to its downstream realizer. That link enables `/hstack:help` to render the chain ("this change enables → that change → realizes user value here"), enables `/hstack:telemetry` to compute foundational-vs-direct change ratios, and enables an adversarial reviewer asked to evaluate a Category-B change to read the downstream spec rather than guessing at the user-value story.

The trigger for filing this ADR was a real Category-B change in a consuming repo (taxonomy plumbing teeing up `compose_component`). The engineer realized mid-spec-authoring that setting `internal-tooling: true` was technically permitted by the kernel but semantically wrong — the change WAS production code on a user path, just deferred.

## Decision

Add `enables: []` and `enabled-by: []` to the change-spec frontmatter. Keep `internal-tooling: true` as Category A's flag with its scope narrowed: it now means "engineering-only, never on a user path" (the original intent, made explicit). Introduce `enables` as Category B's flag: a non-empty array of downstream change-spec ids that realize user value from this change. Make the two flags mutually exclusive.

The story precondition expands from a one-clause predicate to a three-clause one:

- **Old SP-09**: `user-stories` non-empty UNLESS `internal-tooling: true`.
- **New SP-09**: `user-stories` non-empty UNLESS `internal-tooling: true` UNLESS `enables` non-empty.

Two new validator rules accompany the schema change:

- **SP-13 (mutual exclusion)**: `internal-tooling: true` AND `enables` non-empty is forbidden. A change is Category A or Category B or neither (in which case `user-stories` is required), never both.
- **SP-14 (reciprocity)**: `change-spec.enables ↔ change-spec.enabled-by`. When upstream A lists downstream B in `enables`, downstream B lists upstream A in `enabled-by`. Both halves land in a single atomic commit, matching the kernel's other reciprocal-pair rules (TD-01, TD-04, ADR-supersession, `parent-change ↔ children`).

GT-08 (the ship-time gate) mirrors the new SP-09. A new GT-12 covers both SP-13 and SP-14 at ship time.

Forward references are permitted at authoring time. An engineer may set `enables: [future-id]` before the downstream spec exists; `/hstack:change-new` reconciles the reciprocal `enabled-by` when the downstream is later scaffolded. This is the practical compromise — Category B's value comes from being able to declare intent early, even when the downstream is still notional. By ship time, however, GT-12 hardens: the downstream must exist on disk and must list this change-id in its `enabled-by` array. Forward references that never get reconciled fail ship.

Concrete scope:

- **Kernel** (`template/CLAUDE.md`): new paragraph in the Frontmatter contract section naming Categories A and B, the mutual-exclusion rule (SP-13), and the audit-chain query semantics.
- **Template** (`template/templates/change-spec.md`): add `enables: []` and `enabled-by: []` to the frontmatter floor with one-line comments naming their categories.
- **Skill `hstack-change-new`**: scaffold the new fields with empty arrays; add a forward-reference reconciliation step that greps existing specs' `enables` arrays for the new id and writes the reciprocal `enabled-by` atomically with the scaffold commit.
- **Skill `hstack-story-draft`**: extend the skip condition from "Category A only" to "Category A OR Category B". The Category-B halt message redirects the engineer to draft a story against the downstream spec named in `enables`.
- **Skill `hstack-implement`**: update both precondition mentions to the new SP-09 predicate; surface SP-13 as a hard halt.
- **Skill `hstack-ship`**: update GT-08 wording; add GT-12 covering SP-13 and SP-14; rename the scorecard count from eleven to twelve.
- **Skill `hstack-help`**: read the new fields, render Category-A and Category-B annotations next to in-flight changes, render the `enables → ...` chain for Category B, render the reverse `enabled-by ← ...` chain for downstream realizers, and flag SP-13 violations explicitly.
- **Subagent `spec-author`**: extend the reciprocity rules with the new `enables ↔ enabled-by` pair; add the no-story interview branch that asks the engineer to classify as A, B, or "actually has a story"; update the output expectations to enforce SP-09 / SP-13.
- **No schema-version bump.** Existing change-specs without the new fields are tolerated by readers — the predicate is backwards-compatible (an empty `enables` array doesn't change SP-09 behavior; missing entirely is treated as empty). Consuming repos with existing specs do not need a migration.

Out of scope:

- The `parent-change ↔ children` multi-module-split pair stays as-is. It is semantically distinct from `enables ↔ enabled-by`: parent/children is one coordinated change split across modules for execution; enables/enabled-by is sequential changes where one is a prerequisite for the other. Trying to unify the two would harm readability.
- Transitive validation. GT-12 verifies one-hop reciprocity (this spec ↔ direct neighbors) but does not chase the chain to verify that some downstream spec eventually has `user-stories` non-empty. Each spec ships independently; each spec's GT-08 runs at its own ship time. Chasing the chain would create cross-spec ship coupling, which the kernel deliberately avoids.
- Auto-detection of Category B at scaffold time. The Skill cannot infer category from the change description; the engineer classifies via the `spec-author` interview. Auto-detection would be wrong often enough to erode trust.
- `validate-spec.ts` implementation for SP-13 / SP-14. Like every other validator rule, these are enforced via Skill preconditions and the proposed-diff preview until `validate-spec.ts` ships as a real script (tracked as the blocker-priority follow-up from ADR-0001).

## Consequences

### Positive

- **Audit fidelity restored.** The query "what's the user value of this change?" now has a typed path: follow `enables` until reaching a spec with `user-stories` non-empty, or terminate at Category A ("none, internal"). Before, both cases collapsed to "no story" with no way to distinguish.
- **No engineer pressure to lie.** Engineers with legitimately deferred-user-value production code now have a correct flag to set instead of being pushed toward `internal-tooling: true` (semantically wrong) or inventing a placeholder story (worse).
- **Chain visibility in `/hstack:help`.** A cofounder opening the repo cold can now see "change A enables → change B realizes user value via story S" without grepping. This is the same kind of audit-trail value that the kernel's other reciprocal pairs deliver.
- **Backwards-compatible.** No schema-version bump means existing specs continue to validate; the only behavioral change for old specs is that `/hstack:help` may now render an empty `[Realizes ← ...]` annotation for them (a no-op render).
- **Sets a precedent for typed audit links.** If a future kernel change needs to capture another category of cross-spec dependency (e.g., "this change rolls back change X" beyond the existing `revisits-change`), the `enables ↔ enabled-by` pattern is the template: declare both halves, reciprocity-enforce, atomic-commit, surface in `/hstack:help`.

### Negative

- **Two flags where there was one.** Engineers now have to classify between A and B at scaffold/spec-author time rather than reaching for a single escape hatch. The `spec-author` no-story interview branch is the mitigation, but the cognitive cost is real for engineers who would have just typed "internal-tooling" without thinking.
- **Forward-reference reconciliation adds complexity to `hstack-change-new`.** The grep-existing-specs step is mechanical, but it's a new responsibility for a Skill that was previously pure-scaffold. If the grep finds an upstream spec, the Skill must write a reciprocal field on the new spec atomically with the scaffold commit. This is the third Skill (after `hstack-tech-debt-new` and the resolution Skills) to perform atomic reciprocal writes; the duplication of the four-step write sequence noted in ADR-0001 grows by one.
- **Forward references can rot.** An engineer sets `enables: [future-id]` and then never scaffolds the downstream. The audit chain becomes a dangling pointer. `/hstack:help` flags this as informational only (not a blocker), which means the rot is visible but not enforced — engineers can ship a Category-B change whose downstream never materializes, and the spec stays at `shipped` with a dangling forward reference. GT-12 catches the case where the downstream existed when ship ran but didn't list this id reciprocally; it doesn't catch the case where the downstream never gets created at all. The mitigation is the surfacing in `/hstack:help` and (post-promotion) `/hstack:telemetry`; the structural fix would require ship-time chain validation, which is out of scope per the cross-spec-coupling concern above.
- **Skill update surface is broad.** Six Skills, one subagent, the kernel, the template, and a new ADR all change in one PR. The blast radius is intentional (the predicate change must propagate consistently), but the review burden is non-trivial.

### Neutral

- The kernel's existing reciprocity discipline (TD-01, TD-04, ADR-supersession, `parent-change ↔ children`) gains a fifth member. The pattern is well-established; SP-14 fits without surprise.
- The `validate-spec.ts` placeholder grows by two rules (SP-13, SP-14). Like every other rule in the validator's TODO surface, these are enforced by Skill preconditions until the script ships.
- The audit-chain query (`/hstack:telemetry` § future-promotion) becomes computable. v1 surfaces it in `/hstack:help`; v2 substrate may promote it to a dashboard metric ("share of in-flight changes that are Category B / Category A / has-story"). No work for that promotion is in this ADR.

### Challenge prompt — name two consequences that look bad

1. **The new flag pair will be misused as a workaround.** An engineer who finds the `/hstack:story-draft` interview tedious will be tempted to set `enables: [some-id]` to skip it, even when a story is actually warranted. The downstream id might be a real future spec or might be invented. Forward references are permitted at authoring time precisely to support legitimate teeing-up, but they're also a backdoor around SP-09. The mitigation is the spec-author no-story interview branch's audit-query test ("if someone asks what's the user value, is the honest answer (A) none, (B) downstream, or (C) actually has a story?"), but a determined engineer can still answer dishonestly. The structural fix would be to require the downstream spec to exist at the time `enables` is written — which would break the legitimate forward-reference case. The trade-off is real; the v1 mitigation is honor-system.
2. **`/hstack:help`'s chain rendering will produce visually noisy output for changes with multiple `enables` or `enabled-by` entries.** The kernel encourages atomic, single-responsibility change-specs, but a foundational change like a schema migration could legitimately enable many downstream changes. The annotation `[Category B — enables → 2026-06-foo, 2026-06-bar, 2026-06-baz, 2026-07-quux, ...]` quickly becomes unreadable in the situation report. The mitigation is to truncate at three downstreams with a "(+N more)" suffix, but this is a presentation concern not handled in this ADR. If chains routinely exceed three entries, the rendering rules need a follow-up.

## Alternatives Considered

**Repurpose `parent-change` / `children` for the same purpose.** The existing multi-module-split pair already establishes parent/children relationships between change-specs. We could overload `children` to mean "downstream change-specs that consume this output." **Rejected.** The semantics are different. `parent-change ↔ children` describes ONE conceptual change split across modules for execution; the children share the parent's user-value story and the parent itself is a coordination record with no plan, no security-review, no implementer. `enables ↔ enabled-by` describes SEPARATE changes where one is a prerequisite for the other; each has its own full workflow, its own plan, its own implementer. Overloading the existing pair would create a "parent-change is sometimes a sibling and sometimes a coordinator" ambiguity that downstream Skills would have to disambiguate constantly. The cleaner answer is a new pair with its own name.

**Rename `internal-tooling` to a discriminated-union field like `no-story-reason: internal-tooling | foundational-prerequisite`.** Single field, mutually-exclusive values by construction. **Rejected** for two reasons: (a) backwards-incompatible — every existing change-spec with `internal-tooling: true` would need migration, requiring a schema-version bump; (b) loses the typed downstream linkage. `no-story-reason: foundational-prerequisite` is a label; `enables: [<id>...]` is a typed pointer that the validator and `/hstack:help` can act on. The boolean-plus-array shape is uglier but more useful.

**Make `enables` available to Category A changes as well, removing the mutual exclusion.** An internal tool could theoretically "enable" another internal tool. **Rejected.** The audit semantics break down: if Category A means "no user on the path," then enabling a downstream change-spec that also has no user on the path produces a chain that never terminates at a user-value story. The cases where one piece of internal tooling depends on another are rare and better captured as comments in the change-spec's Context section or as ADRs, not as typed kernel-level links. Mutual exclusion keeps the audit-chain query well-formed.

**Defer to v2.** Wait until the validator ships and the telemetry substrate is real, then add the typed link with full enforcement. **Rejected.** The gap is real now, and the v1 mitigation (Skill preconditions + proposed-diff preview) is exactly the pattern the kernel already uses for every other validator rule. Deferring leaves engineers in the conflated state for the duration of v1, which could be months. The honest move is to land the schema change now with v1-grade enforcement and let v2 harden it.
