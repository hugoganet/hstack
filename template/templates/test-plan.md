---
id: <parent-change-id>-test-plan
type: test-plan
status: draft                          # draft | in-progress | passed | concerns-acknowledged | failed | superseded
owner: <git-handle>
parent-change: <change-spec-id>
scoring-mode: llm-strategized          # v1; v2 introduces 'executed' once mutation/coverage tooling is wired
coverage-layers:
  unit: not-applicable                 # addressed | partial | not-applicable
  integration: not-applicable
  e2e: not-applicable
tenant-isolation-tests: []             # required non-empty when surfaces includes db | api | agent
fixture-strategy-declared: false       # must be true before status: passed
performance-budgets-required: false    # true when change touches hot paths or high-traffic surfaces
challenge-prompts-answered: 0          # must equal 3
concerns-acknowledged-by: null         # handle required when any coverage layer is `partial` and deferred
invariants-mapped: []                  # change-spec invariant ids that have a mapped test in this plan
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## Surfaces and Risk Profile

_Pointer to change-spec `surfaces`. One sentence per surface naming the dominant test-risk layer it adds (e.g., "ui — interaction state regressions; db — RLS bypass risk on new table")._

## Test Pyramid

_Per-layer decisions: which behaviors land at which layer and why. Bias toward integration over end-to-end for behavior coverage; bias toward unit for pure functions and reducers. Name the test files that will exist; estimate count roughly. If a layer is `not-applicable`, justify in one sentence._

### unit

**Coverage status.** _addressed | partial | not-applicable._

**Files.** _Test files in scope (relative paths)._

-

**What's covered.** _Behaviors validated at this layer. 2–4 bullets._

-

**Rationale.** _Why this layer is the right home for these behaviors._

### integration

**Coverage status.**

**Files.**

-

**What's covered.**

-

**Rationale.**

### e2e

**Coverage status.**

**Files.**

-

**What's covered.**

-

**Rationale.**

## Edge Cases

_Enumerate the edge cases the change must handle, and name the test that catches each. Bias toward cases the change-spec's Target Behavior does not explicitly name — empty inputs, max-length inputs, concurrent writes, partial failure, retries, idempotency, time-zone boundaries, off-by-one on pagination, NULL vs empty-string, locale-sensitive formatting. Minimum three bullets unless the change is genuinely trivial. Format: `case → test file::test name`._

-
-
-

## Tenant Isolation Tests

_Required non-empty section when `surfaces` includes `db`, `api`, or `agent`. For every new RLS-protected table, new tenant-scoped RPC, new tool boundary, or new cross-tenant data path: name an explicit negative test that proves cross-tenant reads/writes are refused. The change-spec's `tenant_isolation` invariants must each map to at least one test here. Format: `surface → test file::test name → what it proves`._

-

## Test Data and Fixture Strategy

_Required section. How test data is seeded, what factories or fixtures are reused, how tests are isolated from each other, and how multi-tenant data is partitioned in test runs. Name the factory module or fixture file. State whether tests share a database between runs (transactional rollback per test, full reset per suite, in-memory mock) and why._

**Seed strategy.**

**Factory / fixture module.**

**Isolation between tests.**

**Multi-tenant partitioning.**

## Performance and Regression Budgets

_Required when `performance-budgets-required: true`. For each hot path the change touches, declare a numeric budget (p50/p95 latency, throughput, payload size, query count) and the test that asserts the budget. Budgets without an asserting test are not budgets; they are wishes._

| path | budget | asserting test |
| --- | --- | --- |
|  |  |  |

## Challenge Prompts

_All three required. Each answer must be at least one paragraph. These exist because the v1 mitigation for "humans miss what's missing" is to force the strategist to name gaps the planner and the implementer will not. The questions below are the canonical wording — adapt one to the change when the adaptation probes harder, and record what was actually asked in the heading. Keep the `(a)` / `(b)` / `(c)` prefixes: TS-02 locates the answers by them._

### (a) What behavior in this change would silently pass the test suite but break in production? Name the test that would catch it, or declare that no such test is planned and justify.

### (b) Which invariant from the change-spec has no corresponding negative or regression test? If every invariant has a mapped test, cite the test for each invariant by id.

### (c) What concurrent, multi-tenant, or failure-mode scenario is not exercised by the planned tests? If none is plausibly relevant, justify why this change has no such scenario.

## Open Concerns

_When any coverage layer is `partial` and being deferred rather than addressed: enumerate what is uncovered, why it is acceptable to defer, who is acknowledging, and what tech-debt id captures the deferral. Ack must be human-confirmed by `owner` before status: concerns-acknowledged. Empty when every layer is `addressed` or `not-applicable`._
