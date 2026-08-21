# Telemetry sidecar — schema and discipline

This document describes the JSON sidecar files five hstack Skills emit alongside their canonical artifact writes, to make per-change telemetry attribution cheap. Sidecars are **derivative** of git + frontmatter + transcripts — re-runnable from source, never authoritative. The kernel's "no parallel tracker" rule is preserved by this derivative property.

This file is the canonical schema and the only place the field rules are stated. The five emitting Skills reference it: each carries its own JSON schema block (its Skill-specific payload) and the executable step that opens the phase window, and points here for everything else. Per ADR-0012 they do not restate the rules below.

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

## The phase window — every sidecar, every Skill (schema_version 2)

Every sidecar carries three fields on top of its Skill-specific payload. They exist so the telemetry parser can answer "what did this phase cost?" — see ADR-0009.

```json
{
  "session_id": "062b8fe8-649f-4d73-b4fb-b0a28a800552",
  "phase_opened_at": "2026-08-15T09:12:44Z",
  "phase_closed_at": "2026-08-15T11:03:07Z"
}
```

Field rules — one statement, applying identically to all five Skills:

- `session_id` — the active Claude Code session, resolved by `hstack/scripts/telemetry/session_id.py` (the most recently modified `*.jsonl` under `~/.claude/projects/<encoded-cwd>/`). One shared resolver, not a per-Skill heuristic. Unresolvable → `null`.
- `phase_opened_at` — stamped when the Skill's preconditions pass, **before any subagent invocation**. Same script call as `session_id`, so both come from one read. The script is read-only, takes milliseconds, and never halts; if it fails or reports `"session_id": null`, the Skill holds `null` for both and continues.
- `phase_closed_at` — stamped at the Skill's terminal state, in the same write that lands the sidecar.
- All three are **best-effort by contract**. Any of them `null`, unparseable, or inverted makes the phase *unmeasured*: `parsers/transcripts.py:phase_usage` returns `null`, and TE-4/TE-5 print `unmeasured`. **Never zero** — a phase whose window cannot be honoured still spent tokens, and a zero would fold it into the averages as if it were free.
- A sidecar write failure never blocks the canonical commit, and the window is never a halt condition. Measurement never gates the workflow.
- ISO-8601, UTC, second precision, `Z` suffix — the format `session_id.py` emits.

Sidecars at `schema_version: 1` (written before ADR-0009) carry no window and read as unmeasured. Nothing migrates them: the transcript timestamps they would need were never recorded.

The window measures *what the session spent while the phase was open* — not what the phase required. A detour taken between `phase_opened_at` and `phase_closed_at` is counted, and subagent spend lands in its host's window (`isSidechain: false` throughout the transcripts). Narrow, not exact.

## Schema — `test-plan.json`

```json
{
  "schema_version": 2,
  "skill": "hstack-test-plan",
  "session_id": "<session id, or null>",
  "phase_opened_at": "<ISO-8601 at precondition pass, or null>",
  "phase_closed_at": "<ISO-8601 at terminal state, or null>",
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
  "schema_version": 2,
  "skill": "hstack-implement",
  "session_id": "062b8fe8-649f-4d73-b4fb-b0a28a800552",
  "phase_opened_at": "2026-05-22T13:58:12Z",
  "phase_closed_at": "2026-05-22T14:18:42Z",
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

- `started_at`, `completed_at` — ISO-8601. The implementer records them from session timestamps. They describe the phase; `phase_opened_at` / `phase_closed_at` bound the *measurement window* and come from the shared resolver. They will usually be within seconds of each other; when they disagree, the window fields are the ones the parser reads.
- `files_touched_count` — count of distinct files modified by the phase's commit. Computed mechanically; not a judgment.
- `tests_written_count` — count of test files newly created in the phase (kernel test-immutability rule allows new tests without authorization).
- `scope_amendment_emitted` — `true` only when the implementer halted and surfaced a scope-amendment request during this phase.
- `halt_reasons` — array of enum values from the kernel halt sentinel (see KERNEL.md § Halt sentinel).
- `test_immutability_authorizations` — array of canonical authorization phrases echoed during this phase (e.g., `"Ok to change test foo"`).

## Schema — `verify.json`

```json
{
  "schema_version": 2,
  "skill": "hstack-verify",
  "session_id": "062b8fe8-649f-4d73-b4fb-b0a28a800552",
  "phase_opened_at": "2026-05-22T15:19:41Z",
  "phase_closed_at": "2026-05-22T15:32:00Z",
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
  "schema_version": 2,
  "skill": "hstack-adversarial-review",
  "session_id": "9f41c0aa-2f5e-4c31-9a77-6d0b1b0e2c14",
  "phase_opened_at": "2026-05-22T16:40:03Z",
  "phase_closed_at": "2026-05-22T16:42:00Z",
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

- `findings_floor` is `3` by default, `5` when `change-spec.area` is in `{agent, auth, billing}` per AR-06. Since ADR-0014 it is the area's *expected* finding count and gates nothing — it is carried here so `findings_count` has a denominator to be read against.
- `findings_count` below `findings_floor` is an ordinary outcome, not a violation. The one count the canonical artifact must argue for is zero: AR-01 requires `findings_fewer_than_floor: true` with a defended justification when `findings` is empty. Aggregating across changes: the `findings_count / findings_floor` distribution is the primary read, and a rate of empty reviews that climbs while `severity_counts` stays flat is the signal worth acting on.
- `category_counts` clustering — e.g., 5 of 5 findings in `code-quality` — is a description of where a change carried its risk, not a smell in itself. It is worth reading against the change's `surfaces`: a `db`-surface change with every finding in `code-quality` is a review that did not look where the risk was. Surfaced via OE-7.
- `severity_counts.high + critical` paired with `resolution_mix.justified-in-prose > 0` is a high-severity-in-prose smell flagged by QO-2. The Skill's stop condition should have caught it before terminal status; sidecar presence indicates a bypass.

## Schema — `finalize.json`

```json
{
  "schema_version": 2,
  "skill": "hstack-finalize",
  "session_id": "c7d2e5b1-88a4-4f0d-b3ce-51a9f7d6e8b2",
  "phase_opened_at": "2026-05-23T10:11:26Z",
  "phase_closed_at": "2026-05-23T10:14:00Z",
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
- **Derivative property.** Every value in every sidecar is reconstructible from git + frontmatter + transcripts. The sidecar is a cache, not a source. Deleting a sidecar is harmless — the next `/hstack:telemetry` run will compute the same metrics from the slower path. The phase window is the one field group with a shelf life: it points at a transcript that `cleanupPeriodDays` will eventually sweep (365 days on some machines, 30 by default), after which the phase reads as unmeasured. Deleting the sidecar loses the window for good, since nothing else records it.
- **Schema versioning.** `schema_version: 2` since ADR-0009 (the phase window). The bump is additive: every v1 field keeps its name and meaning, and a v1 sidecar still parses — it simply reports as unmeasured. No migration exists or is planned.
- **No local identifiers in git.** `session_id` is a local machine identifier. `.telemetry/` is gitignored in the consuming repo, so it never lands in history — but the discipline now depends on that gitignore line holding. A consumer that commits `.telemetry/` publishes its session ids.

## What sidecars are NOT

- Not authoritative. The artifact frontmatter and git history are. If a sidecar disagrees with the artifact, the artifact wins.
- Not an audit trail. The kernel reserves "agent-ledger" naming for the v2 substrate when it ships with cryptographic guarantees.
- Not blocking. A sidecar write failure is logged but does not block the canonical commit.
- Not a parallel tracker. The kernel forbids parallel trackers; sidecars survive that rule only because they are derivative.

## Adding sidecar emission to a new Skill

The v1 emission list is fixed at five Skills (`test-plan`, `implement`, `verify`, `adversarial-review`, `finalize`). Adding a sixth is a follow-up change-spec, not a unilateral Skill edit. The cost-benefit threshold: a Skill is sidecar-eligible when its terminal event is per-change (not per-session), the data the sidecar would carry is non-trivial to reconstruct from git alone, and the Skill already auto-commits at the terminal event (no new commit needed). The "tier 2" candidates already evaluated and held back are `hstack-security-review` and `hstack-data-review`; both pass the criteria but their data is already first-class in frontmatter, so the sidecar's only value is parse-cost reduction. Promote them when WS-2 body parsing becomes a felt bottleneck.
