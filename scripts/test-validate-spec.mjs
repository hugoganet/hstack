#!/usr/bin/env node
/**
 * Fixture tests for hstack/scripts/validate-spec.mjs. No dependencies, no runner.
 *
 *     node scripts/test-validate-spec.mjs
 *
 * Shape, following scripts/test-telemetry-parsers.py: build a known-answer
 * fixture tree on disk, run the real code against it, compare.
 *
 * The suite is organised around one property — every mechanized rule needs a
 * fixture that passes it and a fixture that fails it with that rule's id:
 *
 *   1. `cleanTree()` is a complete, valid hstack tree that puts every rule in
 *      its triggering condition (a `wontfix` tech-debt with both rationale
 *      fields, a `promoted` kernel-fit finding with its reciprocal ADR, a
 *      `risky` data-review with a filled Migration Safety section, …). It must
 *      produce zero findings — that is the passing fixture for every rule.
 *   2. Each `fails(...)` case mutates that tree in exactly one way and asserts
 *      the expected rule id fires.
 *   3. The run ends by cross-checking the registry: any rule in RULES with no
 *      failing fixture is a test-coverage hole and fails the suite.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  RULES,
  DEFERRED_RULES,
  buildWorld,
  validate,
  parseFrontmatter,
  parseSections,
  findSection,
  substantiveLines,
  globMatches,
  globsOverlap,
} from "../template/scripts/validate-spec.mjs";

const FAILURES = [];
const RULES_WITH_FAIL_FIXTURE = new Set();
let checks = 0;

function ok(label) {
  checks++;
  console.log(`  ok   ${label}`);
}

function bad(label, detail) {
  checks++;
  console.log(`  FAIL ${label}\n         ${detail}`);
  FAILURES.push(label);
}

function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
  else bad(label, `expected: ${JSON.stringify(expected)}\n         actual:   ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------
// Fixture construction
// ---------------------------------------------------------------------------

function yamlValue(v, indent = 0) {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    if (v.every((x) => typeof x !== "object" || x === null)) {
      return "[" + v.map((x) => scalarOut(x)).join(", ") + "]";
    }
    return (
      "\n" +
      v
        .map((x) => " ".repeat(indent + 2) + "- " + inlineMap(x))
        .join("\n")
    );
  }
  if (typeof v === "object") {
    const pad = " ".repeat(indent + 2);
    return (
      "\n" +
      Object.entries(v)
        .map(([k, x]) => `${pad}${k}: ${yamlValue(x, indent + 2)}`)
        .join("\n")
    );
  }
  return scalarOut(v);
}

function inlineMap(o) {
  return "{" + Object.entries(o).map(([k, v]) => `${k}: ${scalarOut(v)}`).join(", ") + "}";
}

function scalarOut(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string" && (v.includes(": ") || v.includes("#") || v === "")) {
    return JSON.stringify(v);
  }
  return String(v);
}

/** Render a `{frontmatter}` + body pair into a markdown artifact. */
function artifact(fm, body = "") {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${yamlValue(v)}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

/** Deep-ish merge used to override one field of a base fixture. */
function withFm(base, patch) {
  return { ...base, ...patch };
}

// -- the canonical clean tree ----------------------------------------------

const CHANGE_ID = "2026-08-core-widget-refresh";
const DOWNSTREAM_ID = "2026-08-core-widget-surface";
const SHIPPED_ID = "2026-08-core-shipped-fixer";

const changeSpecFm = {
  id: CHANGE_ID,
  type: "change-spec",
  status: "ready-for-review",
  owner: "hugoganet",
  area: "core",
  surfaces: ["api", "db", "ui"],
  "user-stories": ["REPO:widget-refresh"],
  "related-spec": "core",
  "related-adrs": [],
  "creates-tech-debt": [],
  "resolves-tech-debt": [],
  "parent-change": null,
  children: [],
  "revisits-change": [],
  "internal-tooling": false,
  enables: [DOWNSTREAM_ID],
  "enabled-by": [],
  trivial: false,
  "in-scope": ["src/**", "supabase/migrations/**"],
  "out-of-scope": [],
  "threat-model-delta": true,
  created: "2026-08-01",
  updated: "2026-08-02",
  "schema-version": 1,
};

const CHANGE_SPEC_BODY = `## Problem
The widget list re-fetches on every keystroke.

## Current Behavior

- Every keystroke issues a query.

## Target Behavior

- Queries are debounced to 300ms.

## Acceptance Criteria

GIVEN a widget list
WHEN the operator types
THEN at most one query per 300ms is issued

## Invariants

- Tenant scoping on every widget query is preserved.
- The public widget API shape does not change.
- No cross-tenant cache key is introduced.

## Scope Boundaries

Only the widget service and its migration are touched.

## Surfaces

api — the widget list endpoint. db — one index. ui — the list component.

## Linked Stories and Personas

REPO:widget-refresh.

## Related ADRs and Tech-Debt

None.

## Resolves Tech-Debt

None.

## Open Questions

None.
`;

const TEST_PLAN_BODY = `## Surfaces and Risk Profile

api — contract regressions. db — RLS bypass on the new index.

## Test Pyramid

### unit

**Coverage status.** addressed

**Files.**

- src/widget/debounce.test.ts

**What's covered.**

- Debounce window boundaries.

**Rationale.** Pure function.

## Edge Cases

- empty query → widget/debounce.test.ts::empty
- max length → widget/debounce.test.ts::max
- rapid keystrokes → widget/debounce.test.ts::burst

## Tenant Isolation Tests

- db → widget/rls.test.ts::cross tenant read refused → proves RLS holds

## Test Data and Fixture Strategy

**Seed strategy.** Transactional rollback per test.

**Factory / fixture module.** test/factories/widget.ts

**Isolation between tests.** Per-test transaction.

**Multi-tenant partitioning.** Two seeded tenants.

## Performance and Regression Budgets

Not required for this change.

## Challenge Prompts

### (a) What behavior in this change would silently pass the test suite but break in production?

A stale debounce timer across tenant switches; widget/debounce.test.ts::tenant-switch catches it.

### (b) Which invariant from the change-spec has no corresponding negative or regression test?

Every invariant is mapped: tenant scoping to rls.test.ts, API shape to contract.test.ts, cache key to cache.test.ts.

### (c) What concurrent, multi-tenant, or failure-mode scenario is not exercised?

Simultaneous writes from two tenants are exercised in rls.test.ts::concurrent.

## Open Concerns

None.
`;

const PLAN_BODY = `## Roadmap Alignment

Serves the Now item "operator speed"; forecloses nothing.

## Phase Overview

| step-id | summary | depends-on |
| --- | --- | --- |
| phase-1-debounce | add the debounce helper | none |
| phase-2-index | add the covering index | phase-1-debounce |

## Per-Phase Detail

### phase-1-debounce

**Purpose.** Add the debounce helper.

**Files Touched.**

- src/widget/debounce.ts

**Test Strategy.** test-plan §unit — debounce window boundaries.

**Risk.** Timer leaks across renders.

**Verifier Expectations.** Unit suite green.

### phase-2-index

**Purpose.** Add the covering index.

**Files Touched.**

- supabase/migrations/20260801_widget_index.sql

**Test Strategy.** test-plan §Tenant Isolation Tests — RLS holds on the new index.

**Risk.** Index build lock.

**Verifier Expectations.** Integration suite green.

## Cross-Phase Risks

- The index build could outlast the deploy window.

## Rollback

Drop the index and revert the helper. No data migration to undo.
`;

const SECURITY_REVIEW_BODY = `## Surfaces Touched

api, db, ui.

## Hardening Items Scored

Each layer scored against the hardening checklist with a rationale paragraph.

## Threat-Model Delta

The new index widens no trust boundary; the widget endpoint keeps its tenant filter.

## Challenge Prompts

### (a) What did the engineer not mention?

The debounce timer is per-session state and does not cross tenants.

### (b) What would an attacker try first?

Forcing a cache key collision across tenants; the key includes tenant id.

### (c) What is the worst plausible outcome?

A stale list render, not a data leak.

## Open Concerns

audit-logging is scored concerns: the widget endpoint is not yet audit-logged. Accepted for this change; TD-0002 tracks it.
`;

const DATA_REVIEW_BODY = `## Schema Changes

- New table \`widget_cache\` holding per-tenant debounce state.

## RLS Coverage

### \`widget_cache\`

**Policy.** tenant_id = auth.jwt() ->> 'tenant_id'.

**Test.** widget/rls.test.ts::cross tenant read refused

## Migration Safety

The index build takes a ShareLock; mitigated with CREATE INDEX CONCURRENTLY and a batched backfill behind a feature gate.

## Index and Performance Impact

One covering index on (tenant_id, updated_at); ~40k rows at one year.

## pgvector and RAG

The match_widgets RPC keeps its tenant_id argument.

## Data Lifecycle

widget_cache is ephemeral.
`;

const VERIFICATION_BODY = `## Summary

All suites green on the change branch.

## Per-Phase Outcomes

phase-1-debounce pass; phase-2-index pass.

## Test-Plan Coverage

Every edge case observed; tenant isolation observed; no performance budgets declared.

## Test Suite Output

See artifacts/test-output.txt.

## Discrepancies

None.
`;

const ADVERSARIAL_BODY = `## Methodology

Fresh session; loaded the change-spec, plan, test-plan, security-review, data-review, verification. No implementer transcript.

## Findings

### F-01

**Category.** security

**What.** The cache key omits a tenant salt.

**Why it matters.** Collision across tenants.

**Severity rationale.** medium — requires a hash collision.

**Recommendation.** Salt the key.

**Resolution.** commit:a1b2c3d

### F-02

**Category.** scope-drift

**What.** The migration touches an out-of-scope table comment.

**Why it matters.** Silent scope creep.

**Severity rationale.** low.

**Recommendation.** Drop the comment change.

**Resolution.** commit:e4f5a6b

### F-03

**Category.** code-quality

**What.** The debounce helper duplicates an existing util.

**Why it matters.** Divergence.

**Severity rationale.** low.

**Recommendation.** Reuse the util.

**Resolution.** justified-in-prose

## Resolution Log

F-01 salted in a1b2c3d. F-02 reverted in e4f5a6b. F-03 kept; the util has different cancel semantics.

## Findings Floor Justification

Not applicable — the floor was met.
`;

const UI_BRIEF_BODY = `## Goal

Make the widget list feel instant.

## Layouts and States

Loading, empty, populated, error.

## Reused Components

DsList, DsSpinner.

## New Components

### WidgetDebounceHint

Justified: no design-system component conveys "results are settling" without a blocking spinner.

## Copy

"Updating…"

## Accessibility Notes

aria-live=polite on the hint.
`;

const MODULE_SPEC_BODY = `## Purpose

Owns widget read and write paths.

## Public Surface

listWidgets, upsertWidget.

## Data Owned

widget, widget_cache.

## External Dependencies

Supabase, the design system.

## Invariants

- Every query is tenant-filtered.
- Writes go through upsertWidget.
- No direct SQL outside this module.

## Known Tech-Debt and ADRs

TD-0002.

## Refresh Policy

On every change-spec touching src/widget.
`;

const ADR_BODY = `## Title

Debounce the widget list at the service boundary.

## Status

accepted

## Context

The list re-queries on every keystroke.

## Decision

Debounce at the service, not the component.

## Consequences

### Positive

One place to change the window.

### Negative

Component tests need a fake timer.

## Alternatives Considered

Component-level debounce; rejected because every consumer would re-implement it.

## Forecloses / Enables

Enables server-side prefetch. Forecloses per-component windows.
`;

const TECH_DEBT_BODY = `## Title

Widget endpoint is not audit-logged.

## Why we took the shortcut

Audit plumbing lands with the observability change.

## What it costs us

No trace of who read which widget list.

## Fix sketch

Wire the endpoint into the existing audit middleware.

## Pre-conditions for fixing

- The audit middleware ships.

## Acceptance

- Every widget list read emits an audit row carrying tenant and actor.

## Resolution Log

Opened 2026-08-01.
`;

const KF_BODY = `## Title

Category-A claims span production paths.

## Pattern fired

KF-P1 — internal-tooling specs whose in-scope reaches user paths.

## Evidence

1. ${CHANGE_ID} declares internal tooling but ships src/widget.
2. ${DOWNSTREAM_ID} repeats the pattern.
3. ${SHIPPED_ID} does too.

## Kernel surface implicated

\`template/KERNEL.md § Frontmatter contract\` — the \`internal-tooling\` field.

## Proposed direction

Split Category A into build-time and repo-automation cases.

## Counter-explanations (challenge prompt — mandatory)

1. The engineers may be using internal-tooling as a story-less escape hatch, which is a training gap, not a kernel gap.
2. Three specs is a small sample across one month.

## Confidence rationale

Three evidence rows across two change-specs support high confidence.

## Triage Log

- \`status: open → promoted\` on 2026-08-02.
`;

const INFRA_BODY = [
  "Hosting & Compute",
  "Networking",
  "Data Layer",
  "Storage",
  "Secrets & Configuration",
  "Environment Separation",
  "IaC Inventory",
  "Deploy Pipeline",
  "Observability",
  "Cost & Capacity",
  "Disaster Recovery",
]
  .map((h) => `## ${h}\n\nDocumented.\n`)
  .join("\n") +
  `
## Blast-Radius Matrix

| surface | blast radius | mitigation |
| --- | --- | --- |
| widget api | one tenant | RLS |

` +
  ["Access & Change Control", "MCP Access Policy", "Compliance & Data Residency", "Third-party Dependencies", "Known Gaps"]
    .map((h) => `## ${h}\n\nDocumented.\n`)
    .join("\n") +
  `
## Unknowns

None outstanding.
`;

/**
 * A complete, valid hstack tree. Every rule is in its triggering condition
 * somewhere in here, so a clean run is the passing fixture for all of them.
 */
function cleanTree() {
  const c = `hstack/specs/changes/${CHANGE_ID}`;
  return {
    "hstack/KERNEL.md": "# kernel marker\n",
    "hstack/config.yaml": "design-system-version: 2.4.0\n",

    // Module spec + the source paths its `paths` globs must resolve to.
    "src/widget/index.ts": "export {};\n",
    "supabase/migrations/20260801_widget_index.sql": "-- index\n",
    "hstack/specs/core/spec.md": artifact(
      {
        id: "core",
        type: "module-spec",
        status: "current",
        owner: "hugoganet",
        paths: ["src/widget/**"],
        "last-refreshed": "2026-08-01",
        created: "2026-07-01",
        updated: "2026-08-01",
        "schema-version": 1,
      },
      MODULE_SPEC_BODY,
    ),

    // The change under review, plus its full artifact set.
    [`${c}/spec.md`]: artifact(changeSpecFm, CHANGE_SPEC_BODY),
    [`${c}/test-plan.md`]: artifact(
      {
        id: `${CHANGE_ID}-test-plan`,
        type: "test-plan",
        status: "passed",
        owner: "hugoganet",
        "parent-change": CHANGE_ID,
        "scoring-mode": "llm-strategized",
        "coverage-layers": { unit: "addressed", integration: "addressed", e2e: "not-applicable" },
        "tenant-isolation-tests": ["widget/rls.test.ts::cross tenant read refused"],
        "fixture-strategy-declared": true,
        "performance-budgets-required": false,
        "challenge-prompts-answered": 3,
        "concerns-acknowledged-by": null,
        "invariants-mapped": ["INV-1", "INV-2", "INV-3"],
        created: "2026-08-01",
        updated: "2026-08-01",
        "schema-version": 1,
      },
      TEST_PLAN_BODY,
    ),
    [`${c}/plan.md`]: artifact(
      {
        id: `${CHANGE_ID}-plan`,
        type: "plan",
        status: "completed",
        owner: "hugoganet",
        "parent-change": CHANGE_ID,
        "steps-completed": ["phase-1-debounce", "phase-2-index"],
        "blocked-on": null,
        "oversized-plan-justification": null,
        created: "2026-08-01",
        updated: "2026-08-02",
        "schema-version": 1,
      },
      PLAN_BODY,
    ),
    [`${c}/security-review.md`]: artifact(
      {
        id: `${CHANGE_ID}-security-review`,
        type: "security-review",
        status: "concerns-acknowledged",
        owner: "hugoganet",
        "parent-change": CHANGE_ID,
        "scoring-mode": "llm-scored",
        scores: {
          "data-at-rest": "pass",
          "data-in-transit": "pass",
          authn: "pass",
          "authz-rls": "pass",
          "tenant-isolation": "pass",
          "input-validation": "pass",
          "output-encoding": "pass",
          "secrets-handling": "pass",
          "agent-prompt-injection": "not-applicable",
          "audit-logging": "concerns",
        },
        "concerns-acknowledged-by": "hugoganet",
        "threat-model-delta-required": true,
        "challenge-prompts-answered": 3,
        created: "2026-08-01",
        updated: "2026-08-01",
        "schema-version": 1,
      },
      SECURITY_REVIEW_BODY,
    ),
    [`${c}/data-review.md`]: artifact(
      {
        id: `${CHANGE_ID}-data-review`,
        type: "data-review",
        status: "passed",
        owner: "hugoganet",
        "parent-change": CHANGE_ID,
        "rls-coverage": { "new-tables": { widget_cache: "covered" } },
        "migration-safety": "risky",
        "index-impact": { added: ["widget_cache_tenant_idx"], removed: [] },
        "pgvector-changes": { "rpcs-modified": ["match_widgets"], "tenant-id-arg-present": true },
        "rag-impact": "none",
        "data-lifecycle": "ephemeral",
        created: "2026-08-01",
        updated: "2026-08-01",
        "schema-version": 1,
      },
      DATA_REVIEW_BODY,
    ),
    [`${c}/ui-brief.md`]: artifact(
      {
        id: `${CHANGE_ID}-ui-brief`,
        type: "ui-brief",
        status: "drafted",
        owner: "hugoganet",
        "parent-change": CHANGE_ID,
        "reused-components": ["DsList", "DsSpinner"],
        "new-components": ["WidgetDebounceHint"],
        "design-system-version": "2.4.0",
        created: "2026-08-01",
        updated: "2026-08-01",
        "schema-version": 1,
      },
      UI_BRIEF_BODY,
    ),
    [`${c}/figma-handoff.md`]: artifact(
      {
        id: `${CHANGE_ID}-figma`,
        type: "figma-handoff",
        status: "ready",
        owner: "hugoganet",
        "parent-change": CHANGE_ID,
        "figma-frame-urls": ["https://figma.com/file/x"],
        "design-system-version": "2.4.0",
        created: "2026-08-01",
        updated: "2026-08-01",
        "schema-version": 1,
      },
      "## Frame Index\n\nOne frame.\n\n## Sign-off\n\nApproved.\n",
    ),
    [`${c}/verification.md`]: artifact(
      {
        id: `${CHANGE_ID}-verification`,
        type: "verification",
        status: "passed",
        owner: "hugoganet",
        "parent-change": CHANGE_ID,
        "test-results": {
          unit: "pass",
          integration: "pass",
          e2e: "pass",
          lint: "pass",
          typecheck: "pass",
        },
        "phase-coverage": { "phase-1-debounce": "pass", "phase-2-index": "pass" },
        "test-plan-coverage": {
          "edge-cases": "all-observed",
          "tenant-isolation": "all-observed",
          "performance-budgets": "not-applicable",
        },
        artifacts: { "test-output": "artifacts/test-output.txt" },
        created: "2026-08-02",
        updated: "2026-08-02",
        "schema-version": 1,
      },
      VERIFICATION_BODY,
    ),
    [`${c}/adversarial-review.md`]: artifact(
      {
        id: `${CHANGE_ID}-adversarial-review`,
        type: "adversarial-review",
        status: "findings-resolved",
        owner: "hugoganet",
        "parent-change": CHANGE_ID,
        "findings-floor": 3,
        findings: [
          { id: "F-01", category: "security", severity: "medium", status: "resolved", resolution: "commit:a1b2c3d" },
          { id: "F-02", category: "scope-drift", severity: "low", status: "resolved", resolution: "commit:e4f5a6b" },
          { id: "F-03", category: "code-quality", severity: "low", status: "resolved", resolution: "justified-in-prose" },
        ],
        "findings-fewer-than-floor": false,
        "justification-when-fewer": null,
        "fresh-session-attestation": "sess-1; opened 2026-08-02T09:00:00Z; no implementer transcript loaded",
        created: "2026-08-02",
        updated: "2026-08-02",
        "schema-version": 1,
      },
      ADVERSARIAL_BODY,
    ),

    // Category-B downstream half of the SP-14 reciprocal pair.
    [`hstack/specs/changes/${DOWNSTREAM_ID}/spec.md`]: artifact(
      withFm(changeSpecFm, {
        id: DOWNSTREAM_ID,
        status: "draft",
        enables: [],
        "enabled-by": [CHANGE_ID],
        surfaces: ["ui"],
      }),
      CHANGE_SPEC_BODY,
    ),

    // Shipped change that resolves a tech-debt and creates another —
    // the TD-01 / TD-04 / TD-05 reciprocal pairs.
    [`hstack/specs/changes/${SHIPPED_ID}/spec.md`]: artifact(
      withFm(changeSpecFm, {
        id: SHIPPED_ID,
        status: "shipped",
        surfaces: ["api"],
        enables: [],
        "enabled-by": [],
        "creates-tech-debt": ["TD-0002-widget-endpoint-not-audit-logged"],
        "resolves-tech-debt": ["TD-0001-widget-list-refetch-storm"],
        "threat-model-delta": false,
      }),
      CHANGE_SPEC_BODY + "\n## Resolves Tech-Debt\n\nTD-0001 — Acceptance: the list issues at most one query per 300ms.\n",
    ),

    "hstack/tech-debt/TD-0001-widget-list-refetch-storm.md": artifact(
      {
        id: "TD-0001-widget-list-refetch-storm",
        type: "tech-debt",
        status: "resolved",
        owner: "hugoganet",
        severity: "medium",
        origin: SHIPPED_ID,
        "introduced-by": null,
        cost: "medium",
        "fix-sketch-effort": "small",
        "related-modules": ["core"],
        "target-resolve-by": null,
        "resolution-attempted-at": "2026-08-01",
        "resolved-by": SHIPPED_ID,
        "wontfix-reason": null,
        "wontfix-accepted-alternative": null,
        "stale-verified-at": null,
        "stale-verification-method": null,
        created: "2026-07-01",
        updated: "2026-08-02",
        "schema-version": 1,
      },
      TECH_DEBT_BODY,
    ),
    "hstack/tech-debt/TD-0002-widget-endpoint-not-audit-logged.md": artifact(
      {
        id: "TD-0002-widget-endpoint-not-audit-logged",
        type: "tech-debt",
        status: "open",
        owner: "hugoganet",
        severity: "critical",
        origin: SHIPPED_ID,
        "introduced-by": SHIPPED_ID,
        cost: "small",
        "fix-sketch-effort": "small",
        "related-modules": ["core"],
        "target-resolve-by": "2026-10-01",
        "resolution-attempted-at": null,
        "resolved-by": null,
        "wontfix-reason": null,
        "wontfix-accepted-alternative": null,
        "stale-verified-at": null,
        "stale-verification-method": null,
        created: "2026-08-02",
        updated: "2026-08-02",
        "schema-version": 1,
      },
      TECH_DEBT_BODY,
    ),
    "hstack/tech-debt/TD-0003-legacy-poller-kept.md": artifact(
      {
        id: "TD-0003-legacy-poller-kept",
        type: "tech-debt",
        status: "wontfix",
        owner: "hugoganet",
        severity: "low",
        origin: "found-later",
        "introduced-by": null,
        cost: "small",
        "fix-sketch-effort": "small",
        "related-modules": [],
        "target-resolve-by": null,
        "resolution-attempted-at": null,
        "resolved-by": null,
        "wontfix-reason": "The poller costs less than the migration would.",
        "wontfix-accepted-alternative": "We keep the 60s poll and monitor its cost.",
        "stale-verified-at": null,
        "stale-verification-method": null,
        created: "2026-07-01",
        updated: "2026-08-01",
        "schema-version": 1,
      },
      TECH_DEBT_BODY,
    ),
    "hstack/tech-debt/TD-0004-old-cache-shim.md": artifact(
      {
        id: "TD-0004-old-cache-shim",
        type: "tech-debt",
        status: "stale-no-longer-reproducible",
        owner: "hugoganet",
        severity: "low",
        origin: "found-later",
        "introduced-by": null,
        cost: "small",
        "fix-sketch-effort": "small",
        "related-modules": [],
        "target-resolve-by": null,
        "resolution-attempted-at": null,
        "resolved-by": null,
        "wontfix-reason": null,
        "wontfix-accepted-alternative": null,
        "stale-verified-at": "2026-08-01",
        "stale-verification-method": "The shim was deleted when the cache layer was rewritten in 2026-07.",
        created: "2026-06-01",
        updated: "2026-08-01",
        "schema-version": 1,
      },
      TECH_DEBT_BODY,
    ),

    // ADR pair: supersedes / superseded-by, plus the KF-04 back-reference.
    "hstack/adr/ADR-0001-debounce-at-the-service.md": artifact(
      {
        id: "ADR-0001-debounce-at-the-service",
        type: "adr",
        status: "superseded",
        owner: "hugoganet",
        "decision-date": "2026-07-01",
        supersedes: null,
        "superseded-by": "ADR-0002-debounce-window-is-configurable",
        "related-change-specs": [],
        "related-modules": ["core"],
        "promoted-from-kernel-fit": [],
        created: "2026-07-01",
        updated: "2026-08-01",
        "schema-version": 2,
      },
      ADR_BODY,
    ),
    "hstack/adr/ADR-0002-debounce-window-is-configurable.md": artifact(
      {
        id: "ADR-0002-debounce-window-is-configurable",
        type: "adr",
        status: "accepted",
        owner: "hugoganet",
        "decision-date": "2026-08-01",
        supersedes: "ADR-0001-debounce-at-the-service",
        "superseded-by": null,
        "related-change-specs": [CHANGE_ID],
        "related-modules": ["core"],
        "promoted-from-kernel-fit": ["KF-0001-category-a-spans-production"],
        created: "2026-08-01",
        updated: "2026-08-01",
        "schema-version": 2,
      },
      ADR_BODY,
    ),

    // Kernel-fit: one promoted (KF-04 reciprocity), one dismissed (KF-05).
    "hstack/kernel-fit/findings/KF-0001-category-a-spans-production.md": artifact(
      {
        id: "KF-0001-category-a-spans-production",
        type: "kernel-fit-finding",
        status: "promoted",
        owner: "hugoganet",
        pattern: "KF-P1",
        confidence: "high",
        "detected-by": "kernel-fit-analyst",
        "detected-via": "detector",
        "detected-at": "2026-08-02T10:00:00Z",
        "evidence-row-count": 3,
        "evidence-rows": [
          { change: CHANGE_ID, signal: "internal-tooling with user-path in-scope" },
          { change: DOWNSTREAM_ID, signal: "same" },
          { change: SHIPPED_ID, signal: "same" },
        ],
        "related-findings": [],
        "promoted-to": "adr:ADR-0002-debounce-window-is-configurable",
        "dismissed-reason": null,
        "superseded-by": null,
        created: "2026-08-02",
        updated: "2026-08-02",
        "schema-version": 1,
      },
      KF_BODY,
    ),
    "hstack/kernel-fit/findings/KF-0002-plan-phase-count-drift.md": artifact(
      {
        id: "KF-0002-plan-phase-count-drift",
        type: "kernel-fit-finding",
        status: "dismissed",
        owner: "hugoganet",
        pattern: "KF-P2",
        confidence: "low",
        "detected-by": "kernel-fit-analyst",
        "detected-via": "flag",
        "detected-at": "2026-08-02T11:00:00Z",
        "evidence-row-count": 1,
        "evidence-rows": [{ change: CHANGE_ID, signal: "two phases where four were sketched" }],
        "related-findings": [],
        "promoted-to": null,
        "dismissed-reason":
          "Phase count varies with the shape of the change; the kernel deliberately gives a norm rather than a bound, so this is working as designed.",
        "superseded-by": null,
        created: "2026-08-02",
        updated: "2026-08-02",
        "schema-version": 1,
      },
      KF_BODY,
    ),

    "hstack/kernel-fit/flags/pending/flag-20260802T120000-sess1.md": artifact(
      {
        id: "flag-20260802T120000-sess1",
        type: "kernel-fit-flag",
        status: "processed",
        "session-id": "sess-1",
        "session-transcript-path": "/tmp/sess-1.jsonl",
        branch: "change/2026-08-core-widget-refresh",
        head: "a1b2c3d",
        workspace: "/repo",
        timestamp: "2026-08-02T12:00:00Z",
        "pre-compaction-message-count": 42,
        hint: "friction",
        classification: "friction",
        "classification-rationale": "The Skill re-asked a question it had already answered.",
        "folded-into": null,
        "emitted-as": null,
        created: "2026-08-02",
        updated: "2026-08-02",
        "schema-version": 1,
      },
      "",
    ),

    "hstack/coord/messages/msg-20260802T120000-repo-widget-a1b2.md": artifact(
      {
        id: "msg-20260802T120000-repo-widget-a1b2",
        type: "coord-message",
        status: "sent",
        owner: "hugoganet",
        "from-repo": "repo",
        "from-branch": "change/2026-08-core-widget-refresh",
        "from-change": CHANGE_ID,
        "to-repo": "repo",
        "to-branch": null,
        subject: "widget debounce landed; the index build needs a window",
        refs: ["repo:main:hstack/specs/changes/2026-08-core-widget-refresh/spec.md"],
        expires: null,
        created: "2026-08-02",
        updated: "2026-08-02",
        "schema-version": 1,
      },
      "## Message\n\nThe index build needs a deploy window.\n",
    ),

    "hstack/context/personas/persona-operator.md": artifact(
      {
        id: "persona-operator",
        type: "persona",
        status: "current",
        owner: "hugoganet",
        "anchored-on": "design-partner-a",
        created: "2026-06-01",
        updated: "2026-08-01",
        "schema-version": 1,
      },
      "## Role\n\nOperator.\n",
    ),
    "hstack/stories/REPO-widget-refresh.md": artifact(
      {
        id: "REPO:widget-refresh",
        type: "story",
        status: "in-flight",
        owner: "hugoganet",
        persona: "persona-operator",
        "job-to-be-done": "See the widget list settle without flicker.",
        "success-metric": "p95 keystroke-to-render under 400ms",
        "linked-change-specs": [CHANGE_ID],
        created: "2026-08-01",
        updated: "2026-08-01",
        "schema-version": 1,
      },
      "## Who and Why\n\nOperators.\n",
    ),
    "hstack/context/infrastructure.md": artifact(
      {
        id: "infrastructure",
        type: "infrastructure",
        status: "current",
        owner: "hugoganet",
        "last-quarterly-review": "2026-07-01",
        created: "2026-05-01",
        updated: "2026-08-01",
        "schema-version": 1,
      },
      INFRA_BODY,
    ),
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function runTree(files) {
  const root = mkdtempSync(join(tmpdir(), "hstack-validate-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    const world = buildWorld(root, join(root, "hstack"));
    return validate(world);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Apply `mutate` to a fresh clean tree and assert `rule` fires. */
function fails(rule, label, mutate) {
  const files = cleanTree();
  mutate(files);
  const findings = runTree(files);
  const hit = findings.filter((f) => f.rule === rule);
  if (hit.length > 0) {
    RULES_WITH_FAIL_FIXTURE.add(rule);
    ok(`${rule} fails on ${label}`);
  } else {
    bad(
      `${rule} fails on ${label}`,
      `no ${rule} finding. Findings were: ${findings.map((f) => `${f.rule}@${f.file}`).join(", ") || "(none)"}`,
    );
  }
}

/** Read-modify-write helper for a fixture file's frontmatter line. */
function patchLine(files, path, key, newLine) {
  const before = files[path];
  const re = new RegExp(`^${key}:.*$`, "m");
  if (!re.test(before)) throw new Error(`no \`${key}:\` line in ${path}`);
  files[path] = before.replace(re, newLine);
}

const CHANGE_DIR = `hstack/specs/changes/${CHANGE_ID}`;

// ---------------------------------------------------------------------------
// Parser unit tests
// ---------------------------------------------------------------------------

console.log("frontmatter parser");
{
  const fm = parseFrontmatter(`---
id: a-b
type: change-spec
surfaces: [ui, db]
enables:
  - one
  - two
scores:
  authn: pass
  authz-rls: concerns
refs:
  [
    'a:b:c',
    'd:e:f',
  ]
note: >-
  folded
  scalar
empty: {}
flag: true
count: 3
nothing: null
subject: "value: with colon"  # trailing comment
---

body`);
  check("id", fm.data.id, "a-b");
  check("inline flow seq", fm.data.surfaces, ["ui", "db"]);
  check("block seq", fm.data.enables, ["one", "two"]);
  check("nested map", fm.data.scores, { authn: "pass", "authz-rls": "concerns" });
  check("multi-line flow seq", fm.data.refs, ["a:b:c", "d:e:f"]);
  check("folded scalar", fm.data.note, "folded scalar");
  check("empty flow map", fm.data.empty, {});
  check("boolean", fm.data.flag, true);
  check("integer", fm.data.count, 3);
  check("explicit null", fm.data.nothing, null);
  check("quoted value with colon + comment", fm.data.subject, "value: with colon");
  check("key line number", fm.keyLines.type, 3);
  check("no frontmatter", parseFrontmatter("# hi\n").found, false);
  check("unterminated frontmatter", parseFrontmatter("---\na: b\n").found, false);
}

console.log("section parser");
{
  const sections = parseSections(`## Consequences

### Positive

Good things.

## Alternatives Considered

\`\`\`
## not a heading
\`\`\`

Real content.
`);
  const cons = findSection(sections, "Consequences");
  check("parent section sees subsection content", substantiveLines(cons).length > 0, true);
  check("fenced heading is not a section", sections.filter((s) => s.title === "not a heading").length, 0);
  check(
    "ordinal-prefixed heading matches",
    findSection(parseSections("## Section 2 — RLS Coverage\n\nx\n"), "RLS Coverage") !== null,
    true,
  );
}

console.log("glob helpers");
{
  check("glob ** matches nested", globMatches("src/**", "src/a/b.ts"), true);
  check("glob * stops at slash", globMatches("src/*.ts", "src/a/b.ts"), false);
  check("bare dir covers subtree", globMatches("src/widget", "src/widget/a.ts"), true);
  check("disjoint globs do not overlap", globsOverlap("services/agents/**", "services/board.ts"), false);
  check("nested globs overlap", globsOverlap("app/**", "app/settings/**"), true);
}

// ---------------------------------------------------------------------------
// The clean tree is the passing fixture for every rule
// ---------------------------------------------------------------------------

console.log("clean tree (passing fixture for every rule)");
{
  const findings = runTree(cleanTree());
  if (findings.length === 0) ok("clean tree produces zero findings");
  else {
    bad(
      "clean tree produces zero findings",
      findings.map((f) => `${f.rule} ${f.file}:${f.line} — ${f.message}`).join("\n         "),
    );
  }
}

// ---------------------------------------------------------------------------
// One failing fixture per mechanized rule
// ---------------------------------------------------------------------------

console.log("failing fixtures");

fails("FM-01", "missing floor field", (f) => {
  f[`${CHANGE_DIR}/spec.md`] = f[`${CHANGE_DIR}/spec.md`].replace(/^owner:.*$/m, "");
});
fails("FM-01", "wrong-case enum", (f) => {
  patchLine(f, `${CHANGE_DIR}/spec.md`, "status", "status: Ready-For-Review");
});
fails("FM-01", "non-ISO date", (f) => {
  patchLine(f, `${CHANGE_DIR}/spec.md`, "created", "created: 08/01/2026");
});
fails("FM-01", "impossible ISO date", (f) => {
  patchLine(f, `${CHANGE_DIR}/spec.md`, "created", "created: 2026-02-30");
});
fails("FM-01", "comma-separated string where an array belongs", (f) => {
  patchLine(f, `${CHANGE_DIR}/spec.md`, "in-scope", "in-scope: src/**, supabase/**");
});
fails("FM-01", "non-kebab id", (f) => {
  patchLine(f, `${CHANGE_DIR}/test-plan.md`, "id", "id: Widget_TestPlan");
});
fails("FM-01", "surface outside the enum", (f) => {
  patchLine(f, `${CHANGE_DIR}/spec.md`, "surfaces", "surfaces: [api, cron]");
});

fails("SP-04", "two invariants", (f) => {
  f[`${CHANGE_DIR}/spec.md`] = f[`${CHANGE_DIR}/spec.md`].replace(
    "- No cross-tenant cache key is introduced.\n",
    "",
  );
});
fails("SP-05", "empty in-scope past draft", (f) => {
  patchLine(f, `${CHANGE_DIR}/spec.md`, "in-scope", "in-scope: []");
});
fails("SP-06", "empty Scope Boundaries", (f) => {
  f[`${CHANGE_DIR}/spec.md`] = f[`${CHANGE_DIR}/spec.md`].replace(
    "## Scope Boundaries\n\nOnly the widget service and its migration are touched.\n",
    "## Scope Boundaries\n\n",
  );
});
fails("SP-06", "empty Problem section", (f) => {
  f[`${CHANGE_DIR}/spec.md`] = f[`${CHANGE_DIR}/spec.md`].replace(
    "## Problem\nThe widget list re-fetches on every keystroke.\n",
    "## Problem\n\n_What is broken or missing today._\n",
  );
});
// The shipped spec is the one with no carve-out of its own (`enables: []`,
// `internal-tooling: false`, `area: core`), so emptying its stories leaves
// SP-09 with nothing to fall back on.
fails("SP-09", "no story and no carve-out", (f) => {
  patchLine(f, `hstack/specs/changes/${SHIPPED_ID}/spec.md`, "user-stories", "user-stories: []");
});
fails("SP-13", "Category A and B together", (f) => {
  patchLine(f, `${CHANGE_DIR}/spec.md`, "internal-tooling", "internal-tooling: true");
});
fails("SP-14", "one-sided enables", (f) => {
  patchLine(f, `hstack/specs/changes/${DOWNSTREAM_ID}/spec.md`, "enabled-by", "enabled-by: []");
});

fails("TD-01", "introduced-by without the reciprocal creates-tech-debt", (f) => {
  patchLine(f, `hstack/specs/changes/${SHIPPED_ID}/spec.md`, "creates-tech-debt", "creates-tech-debt: []");
});
fails("TD-02", "critical severity without target-resolve-by", (f) => {
  patchLine(f, "hstack/tech-debt/TD-0002-widget-endpoint-not-audit-logged.md", "target-resolve-by", "target-resolve-by: null");
});
fails("TD-04", "resolved-by without the reciprocal resolves-tech-debt", (f) => {
  patchLine(f, `hstack/specs/changes/${SHIPPED_ID}/spec.md`, "resolves-tech-debt", "resolves-tech-debt: []");
});
fails("TD-04", "shipped change whose TD was never resolved", (f) => {
  patchLine(f, "hstack/tech-debt/TD-0001-widget-list-refetch-storm.md", "status", "status: in-progress");
  patchLine(f, "hstack/tech-debt/TD-0001-widget-list-refetch-storm.md", "resolved-by", "resolved-by: null");
});
fails("TD-05", "resolved without resolved-by", (f) => {
  patchLine(f, "hstack/tech-debt/TD-0001-widget-list-refetch-storm.md", "resolved-by", "resolved-by: null");
  patchLine(f, `hstack/specs/changes/${SHIPPED_ID}/spec.md`, "resolves-tech-debt", "resolves-tech-debt: []");
});
fails("TD-06", "wontfix without the accepted alternative", (f) => {
  patchLine(f, "hstack/tech-debt/TD-0003-legacy-poller-kept.md", "wontfix-accepted-alternative", "wontfix-accepted-alternative: null");
});
fails("TD-07", "stale without a verification method", (f) => {
  patchLine(f, "hstack/tech-debt/TD-0004-old-cache-shim.md", "stale-verification-method", "stale-verification-method: null");
});

fails("AD-01", "a gap in the ADR sequence", (f) => {
  const src = f["hstack/adr/ADR-0002-debounce-window-is-configurable.md"];
  f["hstack/adr/ADR-0004-later-decision.md"] = src
    .replace("ADR-0002-debounce-window-is-configurable", "ADR-0004-later-decision")
    .replace(/^supersedes:.*$/m, "supersedes: null")
    .replace(/^promoted-from-kernel-fit:.*$/m, "promoted-from-kernel-fit: []");
  patchLine(f, "hstack/adr/ADR-0001-debounce-at-the-service.md", "superseded-by", "superseded-by: null");
  patchLine(f, "hstack/adr/ADR-0001-debounce-at-the-service.md", "status", "status: accepted");
  patchLine(f, "hstack/adr/ADR-0002-debounce-window-is-configurable.md", "supersedes", "supersedes: null");
});
fails("AD-02", "supersedes without the reciprocal superseded-by", (f) => {
  patchLine(f, "hstack/adr/ADR-0001-debounce-at-the-service.md", "superseded-by", "superseded-by: null");
  patchLine(f, "hstack/adr/ADR-0001-debounce-at-the-service.md", "status", "status: accepted");
});
fails("AD-03", "missing Forecloses / Enables", (f) => {
  f["hstack/adr/ADR-0002-debounce-window-is-configurable.md"] = f[
    "hstack/adr/ADR-0002-debounce-window-is-configurable.md"
  ].replace(/## Forecloses \/ Enables[\s\S]*$/, "");
});
fails("AD-04", "superseded without superseded-by", (f) => {
  patchLine(f, "hstack/adr/ADR-0001-debounce-at-the-service.md", "superseded-by", "superseded-by: null");
  patchLine(f, "hstack/adr/ADR-0002-debounce-window-is-configurable.md", "supersedes", "supersedes: null");
});

fails("TS-01", "parent-change pointing elsewhere", (f) => {
  patchLine(f, `${CHANGE_DIR}/test-plan.md`, "parent-change", `parent-change: ${DOWNSTREAM_ID}`);
});
fails("TS-02", "two challenge prompts answered", (f) => {
  patchLine(f, `${CHANGE_DIR}/test-plan.md`, "challenge-prompts-answered", "challenge-prompts-answered: 2");
});
fails("TS-03", "empty tenant-isolation-tests on a db surface", (f) => {
  patchLine(f, `${CHANGE_DIR}/test-plan.md`, "tenant-isolation-tests", "tenant-isolation-tests: []");
});
fails("TS-04", "passed with a partial coverage layer", (f) => {
  f[`${CHANGE_DIR}/test-plan.md`] = f[`${CHANGE_DIR}/test-plan.md`].replace(
    "integration: addressed",
    "integration: partial",
  );
});
fails("TS-05", "passed without a declared fixture strategy", (f) => {
  patchLine(f, `${CHANGE_DIR}/test-plan.md`, "fixture-strategy-declared", "fixture-strategy-declared: false");
});
fails("TS-06", "fewer mapped invariants than the spec declares", (f) => {
  patchLine(f, `${CHANGE_DIR}/test-plan.md`, "invariants-mapped", "invariants-mapped: [INV-1]");
});

fails("SR-01", "scores map missing a hardening layer", (f) => {
  f[`${CHANGE_DIR}/security-review.md`] = f[`${CHANGE_DIR}/security-review.md`].replace(
    /^  audit-logging: concerns$/m,
    "",
  );
  patchLine(f, `${CHANGE_DIR}/security-review.md`, "status", "status: passed");
  patchLine(f, `${CHANGE_DIR}/security-review.md`, "concerns-acknowledged-by", "concerns-acknowledged-by: null");
});
fails("SR-02", "one challenge prompt answered", (f) => {
  patchLine(f, `${CHANGE_DIR}/security-review.md`, "challenge-prompts-answered", "challenge-prompts-answered: 1");
});
fails("SR-03", "db surface without a required threat-model delta", (f) => {
  patchLine(f, `${CHANGE_DIR}/security-review.md`, "threat-model-delta-required", "threat-model-delta-required: false");
});
fails("SR-04", "concerns-acknowledged with no acknowledger", (f) => {
  patchLine(f, `${CHANGE_DIR}/security-review.md`, "concerns-acknowledged-by", "concerns-acknowledged-by: null");
});
fails("SR-05", "passed with a concerns score", (f) => {
  patchLine(f, `${CHANGE_DIR}/security-review.md`, "status", "status: passed");
  patchLine(f, `${CHANGE_DIR}/security-review.md`, "concerns-acknowledged-by", "concerns-acknowledged-by: null");
});

fails("DR-01", "a new table absent from rls-coverage", (f) => {
  f[`${CHANGE_DIR}/data-review.md`] = f[`${CHANGE_DIR}/data-review.md`].replace(
    "- New table `widget_cache` holding per-tenant debounce state.",
    "- New table `widget_cache` holding per-tenant debounce state.\n- New table `widget_audit` holding read events.",
  );
});
fails("DR-02", "passed with partial RLS coverage", (f) => {
  f[`${CHANGE_DIR}/data-review.md`] = f[`${CHANGE_DIR}/data-review.md`].replace(
    "widget_cache: covered",
    "widget_cache: partial",
  );
});
fails("DR-03", "pgvector RPC without a tenant-id argument", (f) => {
  f[`${CHANGE_DIR}/data-review.md`] = f[`${CHANGE_DIR}/data-review.md`].replace(
    "tenant-id-arg-present: true",
    "tenant-id-arg-present: false",
  );
});
fails("DR-04", "risky migration with an empty Migration Safety section", (f) => {
  f[`${CHANGE_DIR}/data-review.md`] = f[`${CHANGE_DIR}/data-review.md`].replace(
    /## Migration Safety\n\n.*\n/,
    "## Migration Safety\n\n",
  );
});
fails("DR-05", "a covered table with no RLS Coverage entry", (f) => {
  f[`${CHANGE_DIR}/data-review.md`] = f[`${CHANGE_DIR}/data-review.md`].replace(
    "### `widget_cache`",
    "### `other_table`",
  );
});
fails("DR-06", "data-lifecycle outside the enum", (f) => {
  patchLine(f, `${CHANGE_DIR}/data-review.md`, "data-lifecycle", "data-lifecycle: forever");
});

fails("PL-01", "parent-change pointing elsewhere", (f) => {
  patchLine(f, `${CHANGE_DIR}/plan.md`, "parent-change", `parent-change: ${DOWNSTREAM_ID}`);
});
fails("PL-02", "a detail phase missing from the overview table", (f) => {
  f[`${CHANGE_DIR}/plan.md`] = f[`${CHANGE_DIR}/plan.md`].replace(
    "| phase-2-index | add the covering index | phase-1-debounce |\n",
    "",
  );
});
fails("PL-03", "steps-completed naming an unknown phase", (f) => {
  patchLine(f, `${CHANGE_DIR}/plan.md`, "steps-completed", "steps-completed: [phase-1-debounce, phase-9-ghost]");
});
fails("PL-04", "Files Touched outside in-scope", (f) => {
  f[`${CHANGE_DIR}/plan.md`] = f[`${CHANGE_DIR}/plan.md`].replace(
    "- src/widget/debounce.ts",
    "- scripts/deploy.sh",
  );
});
fails("PL-05", "completed with an uncompleted phase", (f) => {
  patchLine(f, `${CHANGE_DIR}/plan.md`, "steps-completed", "steps-completed: [phase-1-debounce]");
});
fails("PL-05", "ready without a Rollback section", (f) => {
  f[`${CHANGE_DIR}/plan.md`] = f[`${CHANGE_DIR}/plan.md`].replace(/## Rollback[\s\S]*$/, "");
});

fails("V-01", "phase-coverage that does not mirror steps-completed", (f) => {
  f[`${CHANGE_DIR}/verification.md`] = f[`${CHANGE_DIR}/verification.md`].replace(
    /^  phase-2-index: pass$/m,
    "",
  );
});
fails("V-02", "passed with a failing suite", (f) => {
  f[`${CHANGE_DIR}/verification.md`] = f[`${CHANGE_DIR}/verification.md`].replace(
    "integration: pass",
    "integration: fail",
  );
});
fails("V-03", "passed with partial tenant-isolation observation", (f) => {
  f[`${CHANGE_DIR}/verification.md`] = f[`${CHANGE_DIR}/verification.md`].replace(
    "tenant-isolation: all-observed",
    "tenant-isolation: partial",
  );
});
fails("V-04", "passed with a regressed performance budget", (f) => {
  f[`${CHANGE_DIR}/verification.md`] = f[`${CHANGE_DIR}/verification.md`].replace(
    "performance-budgets: not-applicable",
    "performance-budgets: regressed",
  );
});
fails("V-05", "not-run suite at passed with no Discrepancies entry", (f) => {
  f[`${CHANGE_DIR}/verification.md`] = f[`${CHANGE_DIR}/verification.md`]
    .replace("e2e: pass", "e2e: not-run")
    .replace("## Discrepancies\n\nNone.\n", "## Discrepancies\n\n");
});

fails("AR-01", "below the findings floor with no justification", (f) => {
  f[`${CHANGE_DIR}/adversarial-review.md`] = f[`${CHANGE_DIR}/adversarial-review.md`].replace(
    /^  - \{id: F-03.*$/m,
    "",
  );
});
fails("AR-02", "a non-sequential finding id", (f) => {
  f[`${CHANGE_DIR}/adversarial-review.md`] = f[`${CHANGE_DIR}/adversarial-review.md`].replace(
    "id: F-02",
    "id: F-07",
  );
});
fails("AR-02", "an unparseable resolution value", (f) => {
  f[`${CHANGE_DIR}/adversarial-review.md`] = f[`${CHANGE_DIR}/adversarial-review.md`].replace(
    "resolution: commit:a1b2c3d",
    "resolution: fixed it",
  );
});
fails("AR-05", "a tech-debt resolution pointing at nothing", (f) => {
  f[`${CHANGE_DIR}/adversarial-review.md`] = f[`${CHANGE_DIR}/adversarial-review.md`].replace(
    "resolution: justified-in-prose",
    "resolution: tech-debt:TD-9999-does-not-exist",
  );
});
fails("AR-06", "floor of 3 on an agent-area change", (f) => {
  patchLine(f, `${CHANGE_DIR}/spec.md`, "area", "area: agent");
  patchLine(f, `${CHANGE_DIR}/spec.md`, "related-spec", "related-spec: agent");
});
fails("AR-07", "no Acceptance Satisfied section when the parent resolves tech-debt", (f) => {
  patchLine(f, `${CHANGE_DIR}/spec.md`, "resolves-tech-debt", "resolves-tech-debt: [TD-0002-widget-endpoint-not-audit-logged]");
  f[`${CHANGE_DIR}/spec.md`] = f[`${CHANGE_DIR}/spec.md`].replace(
    "## Resolves Tech-Debt\n\nNone.\n",
    "## Resolves Tech-Debt\n\nTD-0002 — Acceptance: every widget list read emits an audit row.\n",
  );
});

fails("KF-01", "evidence-row-count disagreeing with evidence-rows", (f) => {
  patchLine(f, "hstack/kernel-fit/findings/KF-0001-category-a-spans-production.md", "evidence-row-count", "evidence-row-count: 5");
});
fails("KF-02", "high confidence on one evidence row", (f) => {
  patchLine(f, "hstack/kernel-fit/findings/KF-0002-plan-phase-count-drift.md", "confidence", "confidence: high");
});
fails("KF-03", "one counter-explanation above low confidence", (f) => {
  f["hstack/kernel-fit/findings/KF-0001-category-a-spans-production.md"] = f[
    "hstack/kernel-fit/findings/KF-0001-category-a-spans-production.md"
  ].replace(/^2\. Three specs is a small sample across one month\.$/m, "");
});
fails("KF-04", "promoted with no reciprocal back-reference on the ADR", (f) => {
  patchLine(f, "hstack/adr/ADR-0002-debounce-window-is-configurable.md", "promoted-from-kernel-fit", "promoted-from-kernel-fit: []");
});
fails("KF-05", "a dismissed finding with a too-short reason", (f) => {
  patchLine(f, "hstack/kernel-fit/findings/KF-0002-plan-phase-count-drift.md", "dismissed-reason", "dismissed-reason: not worth it");
});

fails("MS-01", "a paths glob that resolves to nothing", (f) => {
  patchLine(f, "hstack/specs/core/spec.md", "paths", "paths: [src/nonexistent/**]");
});
fails("MS-02", "two module-specs claiming the same paths", (f) => {
  f["hstack/specs/edge/spec.md"] = f["hstack/specs/core/spec.md"].replace("id: core", "id: edge");
});
fails("MS-03", "two invariants in a module-spec", (f) => {
  f["hstack/specs/core/spec.md"] = f["hstack/specs/core/spec.md"].replace(
    "- No direct SQL outside this module.\n",
    "",
  );
});

fails("UI-01", "a new component with no justification", (f) => {
  patchLine(f, `${CHANGE_DIR}/ui-brief.md`, "new-components", "new-components: [WidgetDebounceHint, WidgetGhostRow]");
});
fails("UI-02", "design-system-version drifting from config.yaml", (f) => {
  patchLine(f, `${CHANGE_DIR}/ui-brief.md`, "design-system-version", "design-system-version: 2.3.0");
});
fails("UI-02", "figma-handoff drifting from its ui-brief", (f) => {
  patchLine(f, `${CHANGE_DIR}/figma-handoff.md`, "design-system-version", "design-system-version: 2.3.0");
});

fails("ST-01", "a story naming a persona that does not exist", (f) => {
  patchLine(f, "hstack/stories/REPO-widget-refresh.md", "persona", "persona: persona-ghost");
});
fails("ST-02", "in-flight with no linked change-spec", (f) => {
  patchLine(f, "hstack/stories/REPO-widget-refresh.md", "linked-change-specs", "linked-change-specs: []");
});
fails("ST-03", "an empty success metric", (f) => {
  patchLine(f, "hstack/stories/REPO-widget-refresh.md", "success-metric", 'success-metric: ""');
});

fails("INF-01", "a missing infrastructure section", (f) => {
  f["hstack/context/infrastructure.md"] = f["hstack/context/infrastructure.md"].replace(
    "## Disaster Recovery\n\nDocumented.\n",
    "",
  );
});
fails("INF-02", "no Unknowns section", (f) => {
  f["hstack/context/infrastructure.md"] = f["hstack/context/infrastructure.md"].replace(
    /## Unknowns[\s\S]*$/,
    "",
  );
});
fails("INF-03", "an empty Blast-Radius Matrix at status current", (f) => {
  f["hstack/context/infrastructure.md"] = f["hstack/context/infrastructure.md"].replace(
    "| widget api | one tenant | RLS |\n",
    "",
  );
});

fails("FL-01", "a pin missing its session id", (f) => {
  patchLine(f, "hstack/kernel-fit/flags/pending/flag-20260802T120000-sess1.md", "session-id", "session-id: null");
});
fails("FL-02", "processed with no classification", (f) => {
  patchLine(f, "hstack/kernel-fit/flags/pending/flag-20260802T120000-sess1.md", "classification", "classification: null");
});

fails("CM-01", "a message with no to-repo", (f) => {
  patchLine(f, "hstack/coord/messages/msg-20260802T120000-repo-widget-a1b2.md", "to-repo", "to-repo: null");
});
fails("CM-01", "a subject over the 80-char cap", (f) => {
  patchLine(
    f,
    "hstack/coord/messages/msg-20260802T120000-repo-widget-a1b2.md",
    "subject",
    "subject: " + "x".repeat(90),
  );
});

// ---------------------------------------------------------------------------
// Registry coverage — the suite fails if a rule has no failing fixture
// ---------------------------------------------------------------------------

console.log("registry coverage");
{
  const registryIds = [...new Set(RULES.map((r) => r.id))].sort();
  const uncovered = registryIds.filter((id) => !RULES_WITH_FAIL_FIXTURE.has(id));
  check("every mechanized rule has a failing fixture", uncovered, []);
  check("deferred rules are all documented with a reason", DEFERRED_RULES.filter((r) => !r.reason).map((r) => r.id), []);
  console.log(
    `       ${registryIds.length} mechanized rule ids, ${RULES.length} checks, ${DEFERRED_RULES.length} deferred entries`,
  );
}

console.log("");
if (FAILURES.length > 0) {
  console.log(`FAILED — ${FAILURES.length} of ${checks} checks:`);
  for (const f of FAILURES) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks.`);
