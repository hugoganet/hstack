# Telemetry sidecar — schema and discipline

This document describes the JSON sidecar files three hstack Skills emit alongside their canonical artifact writes, to make per-change telemetry attribution cheap. Sidecars are **derivative** of git + frontmatter — re-runnable from source, never authoritative. The kernel's "no parallel tracker" rule is preserved by this derivative property.

## Where sidecars live

```
hstack/specs/changes/<change-id>/.telemetry/
  test-plan.json                # one per test-plan terminal status
  implement-<phase-id>.json     # one per implement phase
  verify.json                   # one per verify pass
  adversarial-review.json       # one per adversarial-review terminal status
  finalize.json                 # one per ship
```

The `.telemetry/` directory is **git-ignored** at the consuming-repo level. Sidecars are transient; the canonical truth lives in the artifact frontmatter and git history.

## When sidecars are written

| Skill | Trigger | File |
| --- | --- | --- |
| `hstack-test-plan` | At the test-plan terminal-status commit (`passed` or `concerns-acknowledged`) | `test-plan.json` |
| `hstack-implement` | At each phase-completion auto-commit (the same `git add && git commit` that lands `plan.steps-completed`) | `implement-<phase-id>.json` |
| `hstack-verify` | At the change-spec advance commit when `verification.md` lands at `status: passed` (per ADR-0002); on `ran`/`failed`, piggybacks on the verification status commit | `verify.json` |
| `hstack-adversarial-review` | At the change-spec advance commit when `adversarial-review.md` lands at `findings-resolved` (per ADR-0002 follow-up); on `findings-open`/`in-progress`, piggybacks on the transition commit | `adversarial-review.json` |
| `hstack-finalize` | At the change-spec advance commit when status moves `ready-to-ship → shipped` | `finalize.json` |

The other 22 Skills do **not** emit sidecars in v1. Their data is reconstructible from git + frontmatter + transcripts; the five emissions above target the highest-signal events across the change lifecycle: test discipline up front (`test-plan`), per-phase scope-locked execution (`implement`), promised-vs-observed (`verify`), gate-firing critique (`adversarial-review`), lifecycle close (`finalize`).

## Schema — `test-plan.json`

```json
{
  "schema_version": 1,
  "skill": "hstack-test-plan",
  "change_id": "2026-05-billing-overage-warning",
  "completed_at": "2026-05-22T11:14:00Z",
  "status": "passed",
  "coverage_layers": {"unit": "addressed", "integration": "addressed", "e2e": "not-applicable"},
  "tenant_isolation_tests_count": 0,
  "tenant_isolation_required": false,
  "performance_budgets_required": false,
  "performance_budgets_count": 0,
  "challenge_prompts_answered": 3,
  "invariants_mapped_count": 4,
  "invariants_declared_count": 4,
  "edge_cases_count": 5,
  "test_files_named_count": 7,
  "fixture_strategy_declared": true,
  "halt_reasons": []
}
```

Field rules:

- `tenant_isolation_tests_count` paired with `tenant_isolation_required` is the rubber-stamp tell. `required: true` with `count: 0` at terminal status is a TS-03 contract violation that should have halted the Skill — its presence in a `passed` sidecar is a high-severity signal.
- `challenge_prompts_answered` must be exactly `3` for `passed`. Lower values at `passed` indicate either a validator gap or a Skill bypass.
- `invariants_mapped_count` lower than `invariants_declared_count` at `passed` is a TS-06 violation. Same signal-handling as above.

## Schema — `implement-<phase-id>.json`

```json
{
  "schema_version": 1,
  "skill": "hstack-implement",
  "change_id": "2026-05-billing-overage-warning",
  "phase_id": "phase-3-component",
  "started_at": "2026-05-22T14:00:00Z",
  "completed_at": "2026-05-22T14:18:42Z",
  "files_touched_count": 4,
  "tests_written_count": 2,
  "scope_amendment_emitted": false,
  "halt_reasons": [],
  "test_immutability_authorizations": []
}
```

Field rules:

- `started_at`, `completed_at` — ISO-8601. The implementer records them from session timestamps.
- `files_touched_count` — count of distinct files modified by the phase's commit. Computed mechanically; not a judgment.
- `tests_written_count` — count of test files newly created in the phase (kernel test-immutability rule allows new tests without authorization).
- `scope_amendment_emitted` — `true` only when the implementer halted and surfaced a scope-amendment request during this phase.
- `halt_reasons` — array of enum values from the kernel halt sentinel (see KERNEL.md § Halt sentinel).
- `test_immutability_authorizations` — array of canonical authorization phrases echoed during this phase (e.g., `"Ok to change test foo"`).

## Schema — `verify.json`

```json
{
  "schema_version": 1,
  "skill": "hstack-verify",
  "change_id": "2026-05-billing-overage-warning",
  "ran_at": "2026-05-22T15:32:00Z",
  "test_suite_runtime_s": 187.4,
  "phase_coverage": {"phase-1-types": "pass", "phase-2-component": "pass"},
  "test_plan_coverage": {
    "edge-cases": "all-observed",
    "tenant-isolation": "not-applicable",
    "performance-budgets": "not-applicable"
  },
  "discrepancies_count": 0,
  "status": "passed"
}
```

Field rules:

- `test_suite_runtime_s` — float seconds. Wall-clock elapsed across all canonical commands.
- `phase_coverage`, `test_plan_coverage` — mirror `verification.md` frontmatter for cheap downstream parsing. When verification fails, the sidecar still lands at the corresponding `ran` or `failed` status; the canonical artifact is the source of truth for any discrepancy.
- `discrepancies_count` — count of bullet points under `verification.md § Discrepancies`. A non-zero value should always pair with a non-empty Discrepancies section in the canonical artifact.

## Schema — `adversarial-review.json`

```json
{
  "schema_version": 1,
  "skill": "hstack-adversarial-review",
  "change_id": "2026-05-billing-overage-warning",
  "reviewed_at": "2026-05-22T16:42:00Z",
  "findings_floor": 5,
  "findings_count": 6,
  "findings_fewer_than_floor": false,
  "category_counts": {
    "security": 1,
    "scope-drift": 0,
    "invariant-breach": 1,
    "spec-compliance": 2,
    "data-integrity": 1,
    "code-quality": 1
  },
  "severity_counts": {"critical": 0, "high": 1, "medium": 3, "low": 2},
  "resolution_mix": {"commit": 4, "tech-debt": 1, "justified-in-prose": 1},
  "fresh_session_attestation": "session abc-123; opened 2026-05-22T16:40Z; no implementer transcripts loaded",
  "halt_reasons": []
}
```

Field rules:

- `findings_floor` is `3` by default, `5` when `change-spec.area` is in `{agent, auth, billing}` per AR-06.
- `findings_count` < `findings_floor` is permitted only when `findings_fewer_than_floor: true` (with a defended justification in the canonical artifact's Findings Floor Justification section). Aggregating across changes: a rising `findings_fewer_than_floor: true` rate means either the floors are wrong or the reviewer is gaming the escape hatch.
- `category_counts` clustering — e.g., 5 of 5 findings in `code-quality` — is the quota-gaming smell the kernel's "spread findings across categories" guidance is designed to detect. The telemetry layer surfaces it via OE-7.
- `severity_counts.high + critical` paired with `resolution_mix.justified-in-prose > 0` is a high-severity-in-prose smell flagged by QO-2. The Skill's stop condition should have caught it before terminal status; sidecar presence indicates a bypass.

## Schema — `finalize.json`

```json
{
  "schema_version": 1,
  "skill": "hstack-finalize",
  "change_id": "2026-05-billing-overage-warning",
  "shipped_at": "2026-05-23T10:14:00Z",
  "merge_commit_sha": "abc1234567890",
  "change_duration_days": 4,
  "tds_resolved": ["TD-0042-overage-banner-tailwind-class"]
}
```

Field rules:

- `merge_commit_sha` — full SHA of the merge commit on the default branch.
- `change_duration_days` — integer days from `change-spec.created` to the merge commit's author date.
- `tds_resolved` — list of TD ids; mirrors `change-spec.resolves-tech-debt`. Empty array on changes that resolve no debt.

## Discipline preserved

Per the kernel § Mechanical operations § Discipline preserved:

- **Atomic with the canonical commit.** Each sidecar is written and `git add`-ed in the same commit as the canonical artifact write. No separate commit. The sidecar piggybacks on a commit that was happening anyway — zero new LLM turns, zero new confirmation gates.
- **Idempotency.** Re-running a Skill on a phase that already landed produces a no-op on the sidecar (file already present, content unchanged aside from `schema_version` bumps if any).
- **Derivative property.** Every value in every sidecar is reconstructible from git + frontmatter + transcripts. The sidecar is a cache, not a source. Deleting a sidecar is harmless — the next `/hstack:telemetry` run will compute the same metrics from the slower path.
- **Schema versioning.** `schema_version: 1` in v1. Bumping to `2` requires either a backward-compatible additive change (new optional field) or a migration in `scripts/telemetry/parsers/`.

## What sidecars are NOT

- Not authoritative. The artifact frontmatter and git history are. If a sidecar disagrees with the artifact, the artifact wins.
- Not an audit trail. The kernel reserves "agent-ledger" naming for the v2 substrate when it ships with cryptographic guarantees.
- Not blocking. A sidecar write failure is logged but does not block the canonical commit.
- Not a parallel tracker. The kernel forbids parallel trackers; sidecars survive that rule only because they are derivative.

## Adding sidecar emission to a new Skill

The v1 emission list is fixed at five Skills (`test-plan`, `implement`, `verify`, `adversarial-review`, `finalize`). Adding a sixth is a follow-up change-spec, not a unilateral Skill edit. The cost-benefit threshold: a Skill is sidecar-eligible when its terminal event is per-change (not per-session), the data the sidecar would carry is non-trivial to reconstruct from git alone, and the Skill already auto-commits at the terminal event (no new commit needed). The "tier 2" candidates already evaluated and held back are `hstack-security-review` and `hstack-data-review`; both pass the criteria but their data is already first-class in frontmatter, so the sidecar's only value is parse-cost reduction. Promote them when WS-2 body parsing becomes a felt bottleneck.
