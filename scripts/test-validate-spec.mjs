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

// The canonical clean tree lives in `scripts/fixtures/clean-tree.mjs` — it is
// shared with `test-merge-readiness.mjs`, which scores the same artifacts
// through the merge gates instead of the contract rules.
import {
  cleanTree,
  CHANGE_ID,
  DOWNSTREAM_ID,
  SHIPPED_ID,
} from "./fixtures/clean-tree.mjs";


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

// ADR-0014: the count is no longer gated, so dropping F-03 is a passing review.
// What AR-01 still refuses is the undefended empty result.
fails("AR-01", "an empty findings array with no defence", (f) => {
  f[`${CHANGE_DIR}/adversarial-review.md`] = f[`${CHANGE_DIR}/adversarial-review.md`].replace(
    /^findings: ?\n(?:  - \{id: F-\d\d[^\n]*\n)+/m,
    "findings: []\n",
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
