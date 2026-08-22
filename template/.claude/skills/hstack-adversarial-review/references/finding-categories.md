# The six finding categories — a calibration rubric

Reference file for `hstack-adversarial-review` and the `adversarial-reviewer`
subagent. Read it when a category is unfamiliar, when a finding feels thin and
you want to know whether it is real, or when calibrating severity against
precedent. It is **not** a checklist: nothing here says how many findings a
review should produce, and a review that lands entirely in one category is a
correct outcome when the change carries its risk in one dimension (ADR-0014).

The `category` value in a finding record is a controlled enum — the six names
below, exactly — and AR-02 rejects anything else.

---

## security

**What it means.** The change creates or widens a path an attacker can use, or
weakens a control that was closing one. Distinct from `data-integrity`: this is
about an adversary, not about accidental corruption.

**Real findings look like.** A new endpoint that reads a user-supplied id and
queries by it without re-deriving the caller's scope. A prompt that
concatenates retrieved document text into a system message. A secret moved from
an env read to a literal. An auth check that runs after the side effect. A
dependency bump that pulls a package with a known CVE the security-review did
not see because the lockfile changed outside `in-scope`.

**Filler looks like.** "Consider adding rate limiting" on a change that touches
no network surface. Restating a hardening-checklist item the security-review
already scored `pass`, with no evidence from the diff that the score is wrong.

**Severity.** Anything exploitable by a non-authenticated caller, or that
crosses a tenant boundary, is `critical` or `high` — never `medium` because it
is unlikely. Likelihood belongs in the severity rationale, not in the level.

---

## scope-drift

**What it means.** The diff touches things `change-spec.in-scope` does not
name, or the change quietly grew a second purpose.

**Real findings look like.** A refactor of a shared util that no phase in
`plan.md` asked for. A migration that alters a table outside the change's
module. A "while I was in there" rename that makes the diff unreviewable. A new
dependency added to satisfy a convenience the spec never asked for.

**Filler looks like.** Flagging a file the change-spec's globs do cover on a
literal reading. Flagging generated files, lockfiles, or formatter output that
the repo's conventions produce automatically.

**Severity.** Usually `medium`. It escalates when the drift lands in a module
with its own module-spec invariants, because then it is also `invariant-breach`
and CI's scope gate did not catch it.

---

## invariant-breach

**What it means.** Something the change-spec or the relevant module-spec
declares as always-true is no longer always-true after this diff.

**Real findings look like.** A module-spec that says "no direct SQL outside this
module" and a new query in an adjacent file. A change-spec invariant about
ordering that the new code path can violate under concurrency. An invariant
that is still true but is now enforced by convention where it used to be
enforced by a type or a constraint.

**Filler looks like.** Paraphrasing an invariant back and calling it a risk.
Naming an invariant the diff does not touch.

**Severity.** `high` by default — an invariant that can break silently is worse
than a bug that throws. Drop to `medium` only when the breach is caught by an
existing test that will fail loudly.

---

## spec-compliance

**What it means.** The diff and the artifacts disagree. This is the category
with the widest surface and the one most often under-used.

**Real findings look like.** An acceptance criterion in the change-spec with no
corresponding behaviour in the diff. An edge case the `test-plan` promised and
the diff did not land. A tenant-isolation test named in the test-plan and
absent from the branch. An invariant in the change-spec that
`verification.test-plan-coverage` maps to no observed test. Behaviour the
implementation added that no artifact anticipated — undeclared scope is a
compliance gap in the other direction. **Any test-file modification without its
canonical authorization echo** (see `KERNEL.md` § Test immutability); this one
is mandatory and never subject to judgment about whether it is worth filing.
When `resolves-tech-debt` is non-empty, any Acceptance bullet the diff leaves
`partial` or `not-satisfied` (AR-07).

**Filler looks like.** "The spec could have been clearer." Style disagreements
with the plan's phase decomposition.

**Severity.** Unauthorized test changes: `high` minimum, `critical` for bulk
snapshot updates. Unmet Acceptance bullets: `high`, `critical` once the change
is at `ready-to-ship`. Everything else: judgment.

---

## data-integrity

**What it means.** Data can end up wrong, lost, or visible to the wrong tenant
without anybody attacking anything.

**Real findings look like.** A migration that adds a NOT NULL column without a
default or a backfill. A destructive DDL with no stated rollback. An RLS policy
whose predicate does not match the tenancy model in `data-architecture.md`. A
tenant-scoped RPC missing its `tenant_id` filter. A write path that is
not idempotent under retry. A pgvector retrieval that filters after the
similarity search rather than inside it.

**Filler looks like.** Speculating about scale on a table with a bounded row
count. Recommending an index with no query to justify it.

**Severity.** Cross-tenant leakage is `critical` — always, including when the
leak needs an unlikely sequence to trigger. Irreversible data loss is
`critical`. Recoverable inconsistency is `high`.

---

## code-quality

**What it means.** The change works and will cost more than it should to live
with. The weakest category and the easiest to pad, which is why it is worth
being strict about what belongs here.

**Real findings look like.** A third copy of logic that already exists twice,
where the copies have started to disagree. Error handling that swallows a
failure the caller needs. A function whose behaviour depends on call order with
nothing that documents or enforces it. A performance budget in the test-plan
that the implementation cannot meet as written.

**Filler looks like.** Naming preferences. Suggested comments. Requests to
extract a function that is used once. Anything a formatter or a linter would
have said.

**Severity.** `low` or `medium`. A `code-quality` finding at `high` is usually
mis-categorized — look again at whether it is really `invariant-breach` or
`data-integrity`.

---

## Resolution routing

Independent of category:

- `commit:<hash>` — fixed on the branch. The hash must exist there (AR-04).
- `tech-debt:<id>` — acknowledged and deferred, against a tech-debt artifact
  that exists at `open` or `in-progress` at write time (AR-05).
- `justified-in-prose` — the finding is real and the right answer is to explain
  why nothing changes. Reserved for `low` severity. A `high`-severity finding
  routed here is a halt, and a security or tenant-isolation finding routed here
  is a halt with escalation.
