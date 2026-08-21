#!/usr/bin/env node
/**
 * Fixture tests for hstack/scripts/compute-merge-readiness.mjs. No
 * dependencies, no runner.
 *
 *     node scripts/test-merge-readiness.mjs
 *
 * Same shape and same property as `test-validate-spec.mjs`: every gate needs a
 * fixture that passes it and a fixture that fails it with that gate's id.
 *
 *   1. `cleanTree()` (shared, `scripts/fixtures/clean-tree.mjs`) plus a
 *      synthetic in-scope diff puts every gate in its triggering condition and
 *      must produce zero blocking verdicts — that is the passing fixture for
 *      every gate.
 *   2. Each `fails(...)` case mutates that tree (or the git facts) in exactly
 *      one way and asserts the expected gate id turns `fail`.
 *   3. The run ends by cross-checking the registry: any gate in GATES with no
 *      failing fixture is a test-coverage hole and fails the suite. GT-09 is
 *      exempt and separately asserted to be `deferred` — it has no computable
 *      content to fail on, which is the whole reason it is deferred.
 *
 * The git facts are injected rather than produced by a real repository: the
 * gates read `{branch, base, files, onBase}` and nothing else, so a synthetic
 * context tests the gate logic without a fixture repo per case. The real git
 * path (`gitContext`) is exercised once, against this repo.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import {
  GATES,
  DEFERRED_GATES,
  buildContext,
  score,
  gitContext,
  readDefaultBranch,
} from "../template/scripts/compute-merge-readiness.mjs";
import { cleanTree, CHANGE_ID, DOWNSTREAM_ID } from "./fixtures/clean-tree.mjs";

const FAILURES = [];
const GATES_WITH_FAIL_FIXTURE = new Set();
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
  else
    bad(label, `expected: ${JSON.stringify(expected)}\n         actual:   ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const CHANGE_DIR = `hstack/specs/changes/${CHANGE_ID}`;

/**
 * A diff that is entirely inside the clean tree's `in-scope`
 * (`src/**`, `supabase/migrations/**`), plus one artifact the workflow itself
 * writes — so the WORKFLOW_OWNED carve-out is exercised by the passing
 * fixture rather than only by its own case.
 */
const CLEAN_GIT = () => ({
  available: true,
  branch: `change/${CHANGE_ID}`,
  base: "origin/main",
  mergeBase: "a1b2c3d4e5f6",
  files: [
    "src/widget/index.ts",
    "src/widget/debounce.ts",
    "supabase/migrations/20260801_widget_index.sql",
    `${CHANGE_DIR}/verification.md`,
  ],
  onBase: false,
  error: null,
});

/** Write a fixture tree to a temp dir and score it. */
function runTree(files, { git = CLEAN_GIT(), gatesExit = null, base = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "hstack-gates-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    const ctx = buildContext(root, join(root, "hstack"), CHANGE_ID, { git, gatesExit, base });
    if (ctx.error) return { error: ctx.error };
    return { ctx, ...score(ctx) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const verdictOf = (result, id) => result.gates.find((g) => g.id === id)?.verdict ?? "(absent)";
const detailOf = (result, id) => result.gates.find((g) => g.id === id)?.detail ?? "";

/** Apply `mutate` to a fresh clean tree and assert `gate` turns `fail`. */
function fails(gate, label, mutate, opts = {}) {
  const files = cleanTree();
  const options = { ...opts };
  mutate(files, options);
  const result = runTree(files, options);
  if (result.error) {
    bad(`${gate} fails on ${label}`, `context error: ${result.error}`);
    return;
  }
  const v = verdictOf(result, gate);
  if (v === "fail") {
    GATES_WITH_FAIL_FIXTURE.add(gate);
    ok(`${gate} fails on ${label}`);
  } else {
    bad(
      `${gate} fails on ${label}`,
      `${gate} came back \`${v}\` (${detailOf(result, gate)}). Verdicts: ` +
        result.gates.map((g) => `${g.id}=${g.verdict}`).join(" "),
    );
  }
}

/** Same, for the cases whose correct verdict is `unknown` rather than `fail`. */
function unknown(gate, label, mutate, opts = {}) {
  const files = cleanTree();
  const options = { ...opts };
  mutate(files, options);
  const result = runTree(files, options);
  const v = result.error ? `(context error: ${result.error})` : verdictOf(result, gate);
  if (v === "unknown") ok(`${gate} is unknown on ${label}`);
  else bad(`${gate} is unknown on ${label}`, `got \`${v}\` — ${detailOf(result, gate)}`);
}

/** Read-modify-write helper for a fixture file's frontmatter line. */
function patchLine(files, path, key, newLine) {
  const before = files[path];
  if (before === undefined) throw new Error(`no fixture at ${path}`);
  const re = new RegExp(`^${key}:.*$`, "m");
  if (!re.test(before)) throw new Error(`no \`${key}:\` line in ${path}`);
  files[path] = before.replace(re, newLine);
}

// ---------------------------------------------------------------------------
// The clean tree is the passing fixture for every gate
// ---------------------------------------------------------------------------

console.log("clean tree (passing fixture for every gate)");
{
  const result = runTree(cleanTree());
  if (result.error) {
    bad("clean tree builds a context", result.error);
  } else {
    const blocking = result.gates.filter((g) => g.verdict === "fail" || g.verdict === "unknown");
    if (blocking.length === 0) ok("clean tree produces zero blocking verdicts");
    else
      bad(
        "clean tree produces zero blocking verdicts",
        blocking.map((g) => `${g.id} ${g.verdict} — ${g.detail}`).join("\n         "),
      );

    check("GT-01 passes on a ready-for-review spec", verdictOf(result, "GT-01"), "pass");
    check("GT-02 passes on an in-scope diff", verdictOf(result, "GT-02"), "pass");
    check("GT-03 is n/a with no hstack/lints rules", verdictOf(result, "GT-03"), "not-applicable");
    check("GT-06 applies — surfaces includes db", verdictOf(result, "GT-06"), "pass");
    check("GT-07 applies — surfaces includes ui", verdictOf(result, "GT-07"), "pass");
    check("GT-08 passes on a non-empty user-stories", verdictOf(result, "GT-08"), "pass");
    check("GT-09 is deferred, never pass or fail", verdictOf(result, "GT-09"), "deferred");
    check("GT-11 is n/a with no resolves-tech-debt", verdictOf(result, "GT-11"), "not-applicable");
    check("clean tree is ready to ship", result.ready, true);
  }
}

// ---------------------------------------------------------------------------
// One failing fixture per computed gate
// ---------------------------------------------------------------------------

console.log("failing fixtures");

// -- GT-01 spec presence -----------------------------------------------------

fails("GT-01", "a change-spec still at draft", (f) => {
  patchLine(f, `${CHANGE_DIR}/spec.md`, "status", "status: draft");
});

// -- GT-02 diff within scope -------------------------------------------------

fails("GT-02", "a changed file outside in-scope", (_f, o) => {
  o.git = { ...CLEAN_GIT(), files: [...CLEAN_GIT().files, "services/billing/charge.ts"] };
});
fails("GT-02", "an empty in-scope allowlist", (f) => {
  patchLine(f, `${CHANGE_DIR}/spec.md`, "in-scope", "in-scope: []");
});
fails("GT-02", "a sibling change's artifacts edited from this branch", (_f, o) => {
  o.git = {
    ...CLEAN_GIT(),
    files: [`hstack/specs/changes/${DOWNSTREAM_ID}/spec.md`],
  };
});
unknown("GT-02", "HEAD standing on the merge target", (_f, o) => {
  o.git = { ...CLEAN_GIT(), branch: "main", onBase: true };
});
unknown("GT-02", "git being unavailable", (_f, o) => {
  o.git = { available: false, branch: null, base: null, files: [], error: "not a git repository" };
});

// -- GT-03 pattern lints -----------------------------------------------------

fails("GT-03", "run-gates.sh exiting non-zero with lint rules present", (f, o) => {
  f["hstack/lints/no-console.yaml"] = "rule: no-console\n";
  o.gatesExit = 1;
});
unknown("GT-03", "lint rules present but the runner not run", (f) => {
  f["hstack/lints/no-console.yaml"] = "rule: no-console\n";
});

// -- GT-04..GT-07 terminal-status gates --------------------------------------

fails("GT-04", "an adversarial-review still at findings-open", (f) => {
  patchLine(f, `${CHANGE_DIR}/adversarial-review.md`, "status", "status: findings-open");
});
fails("GT-04", "a missing adversarial-review", (f) => {
  delete f[`${CHANGE_DIR}/adversarial-review.md`];
});
fails("GT-05", "a security-review at failed", (f) => {
  patchLine(f, `${CHANGE_DIR}/security-review.md`, "status", "status: failed");
});
fails("GT-06", "a data-review at in-progress while surfaces includes db", (f) => {
  patchLine(f, `${CHANGE_DIR}/data-review.md`, "status", "status: in-progress");
});
fails("GT-07", "a figma-handoff still at draft while surfaces includes ui", (f) => {
  patchLine(f, `${CHANGE_DIR}/figma-handoff.md`, "status", "status: draft");
});

console.log("conditional gates go not-applicable, not pass");
{
  const files = cleanTree();
  patchLine(files, `${CHANGE_DIR}/spec.md`, "surfaces", "surfaces: [api]");
  // Dropping db/ui also drops the artifacts a db/ui change would carry.
  delete files[`${CHANGE_DIR}/data-review.md`];
  delete files[`${CHANGE_DIR}/ui-brief.md`];
  delete files[`${CHANGE_DIR}/figma-handoff.md`];
  const result = runTree(files);
  check("GT-06 not-applicable without db", verdictOf(result, "GT-06"), "not-applicable");
  check("GT-07 not-applicable without ui", verdictOf(result, "GT-07"), "not-applicable");
  check("dropping conditional surfaces still ships", result.ready, true);
}

// -- GT-08 user value --------------------------------------------------------

fails("GT-08", "an empty user-stories with no carve-out declared", (f) => {
  patchLine(f, `${CHANGE_DIR}/spec.md`, "user-stories", "user-stories: []");
  patchLine(f, `${CHANGE_DIR}/spec.md`, "enables", "enables: []");
  patchLine(f, `hstack/specs/changes/${DOWNSTREAM_ID}/spec.md`, "enabled-by", "enabled-by: []");
});

console.log("GT-08 carve-outs A / B / C");
{
  const carveOuts = [
    ["A — internal-tooling", "internal-tooling", "internal-tooling: true"],
    ["C — area bootstrap", "area", "area: bootstrap"],
  ];
  for (const [label, key, line] of carveOuts) {
    const files = cleanTree();
    patchLine(files, `${CHANGE_DIR}/spec.md`, "user-stories", "user-stories: []");
    patchLine(files, `${CHANGE_DIR}/spec.md`, "enables", "enables: []");
    patchLine(files, `hstack/specs/changes/${DOWNSTREAM_ID}/spec.md`, "enabled-by", "enabled-by: []");
    patchLine(files, `${CHANGE_DIR}/spec.md`, key, line);
    check(`GT-08 passes on carve-out ${label}`, verdictOf(runTree(files), "GT-08"), "pass");
  }
  // B is the clean tree's own shape: enables non-empty, user-stories emptied.
  const filesB = cleanTree();
  patchLine(filesB, `${CHANGE_DIR}/spec.md`, "user-stories", "user-stories: []");
  const b = runTree(filesB);
  check("GT-08 passes on carve-out B — enables", verdictOf(b, "GT-08"), "pass");
  check(
    "GT-08's Category-B detail says the downstream is not transitively checked",
    /not transitively verified/.test(detailOf(b, "GT-08")),
    true,
  );
}

// -- GT-10 test coverage -----------------------------------------------------

fails("GT-10", "a test-plan at in-progress", (f) => {
  patchLine(f, `${CHANGE_DIR}/test-plan.md`, "status", "status: in-progress");
});
fails("GT-10", "verification reporting partial tenant-isolation coverage", (f) => {
  const p = `${CHANGE_DIR}/verification.md`;
  f[p] = f[p].replace("tenant-isolation: all-observed", "tenant-isolation: partial");
});
fails("GT-10", "verification reporting a regressed performance budget", (f) => {
  const p = `${CHANGE_DIR}/verification.md`;
  f[p] = f[p].replace("performance-budgets: not-applicable", "performance-budgets: regressed");
});

// -- GT-11 tech-debt resolution ---------------------------------------------
//
// The clean tree's TD-0002 is `open` and unreferenced. Pointing the change at
// it puts GT-11 in its triggering condition; each case then breaks one clause.

const RESOLVES = `resolves-tech-debt: [TD-0002-widget-endpoint-not-audit-logged]`;
const TD2 = "hstack/tech-debt/TD-0002-widget-endpoint-not-audit-logged.md";

/**
 * The GT-11-applicable happy path: the change points at TD-0002, the debt is
 * at `in-progress` with a resolution date, and the adversarial-review carries
 * the AR-07 confirmation. The clean tree deliberately does NOT carry that
 * subsection — its change resolves no debt, so AR-07 does not apply to it —
 * which is why it is added here rather than shared.
 */
const AR_07_SECTION = `
### Acceptance Satisfied

TD-0002's Acceptance ("every widget endpoint writes an audit row") is met by
the diff: \`src/widget/index.ts\` writes to \`audit_log\` on every path.
`;

function resolvingTree() {
  const files = cleanTree();
  patchLine(files, `${CHANGE_DIR}/spec.md`, "resolves-tech-debt", RESOLVES);
  patchLine(files, TD2, "status", "status: in-progress");
  patchLine(files, TD2, "resolution-attempted-at", "resolution-attempted-at: 2026-08-02");
  const ar = `${CHANGE_DIR}/adversarial-review.md`;
  files[ar] = files[ar].replace("## Findings", `${AR_07_SECTION}\n## Findings`);
  return files;
}

console.log("GT-11 applicable path");
{
  const result = runTree(resolvingTree());
  check("GT-11 passes on an in-progress TD with the AR-07 confirmation", verdictOf(result, "GT-11"), "pass");
}

fails("GT-11", "a referenced tech-debt still at open", (f) => {
  Object.assign(f, resolvingTree());
  patchLine(f, TD2, "status", "status: open");
});
fails("GT-11", "a referenced tech-debt with no resolution-attempted-at", (f) => {
  Object.assign(f, resolvingTree());
  patchLine(f, TD2, "resolution-attempted-at", "resolution-attempted-at: null");
});
fails("GT-11", "a referenced tech-debt that already carries resolved-by", (f) => {
  Object.assign(f, resolvingTree());
  patchLine(f, TD2, "resolved-by", `resolved-by: ${CHANGE_ID}`);
});
fails("GT-11", "a tech-debt id that names nothing on disk", (f) => {
  Object.assign(f, resolvingTree());
  patchLine(f, `${CHANGE_DIR}/spec.md`, "resolves-tech-debt", "resolves-tech-debt: [TD-9999-imaginary]");
});
fails("GT-11", "an adversarial-review with no Acceptance Satisfied subsection", (f) => {
  Object.assign(f, resolvingTree());
  const p = `${CHANGE_DIR}/adversarial-review.md`;
  const before = f[p];
  f[p] = before.replace("### Acceptance Satisfied", "### Something Else Entirely");
  if (f[p] === before) throw new Error("fixture drift: resolvingTree no longer adds AR-07");
});
fails("GT-11", "an empty Acceptance Satisfied subsection", (f) => {
  Object.assign(f, resolvingTree());
  const p = `${CHANGE_DIR}/adversarial-review.md`;
  f[p] = f[p].replace(AR_07_SECTION.trim(), "### Acceptance Satisfied");
});

// -- GT-12 exclusivity and reciprocity --------------------------------------

fails("GT-12", "a spec that is both Category A and Category B", (f) => {
  patchLine(f, `${CHANGE_DIR}/spec.md`, "internal-tooling", "internal-tooling: true");
});
fails("GT-12", "an enables entry naming no change-spec on disk", (f) => {
  patchLine(f, `${CHANGE_DIR}/spec.md`, "enables", "enables: [2026-08-core-never-scaffolded]");
});
fails("GT-12", "a downstream that does not reciprocate in enabled-by", (f) => {
  patchLine(f, `hstack/specs/changes/${DOWNSTREAM_ID}/spec.md`, "enabled-by", "enabled-by: []");
});
fails("GT-12", "an enabled-by entry pointing at a spec that does not list it", (f) => {
  patchLine(f, `${CHANGE_DIR}/spec.md`, "enabled-by", "enabled-by: [2026-08-core-shipped-fixer]");
});

// ---------------------------------------------------------------------------
// Stop conditions — these exit 2 rather than producing a scorecard
// ---------------------------------------------------------------------------

console.log("stop conditions");
{
  const noFolder = runTree({ "hstack/KERNEL.md": "# kernel marker\n" });
  check(
    "a missing change folder is a context error",
    /no change folder/.test(noFolder.error ?? ""),
    true,
  );

  const noSpec = cleanTree();
  delete noSpec[`${CHANGE_DIR}/spec.md`];
  check(
    "a missing change-spec is a context error",
    /no change-spec/.test(runTree(noSpec).error ?? ""),
    true,
  );

  const badFm = cleanTree();
  badFm[`${CHANGE_DIR}/plan.md`] = "no frontmatter here at all\n";
  check(
    "an unparseable artifact is a context error, not a FAIL",
    /unparseable frontmatter/.test(runTree(badFm).error ?? ""),
    true,
  );
}

// ---------------------------------------------------------------------------
// The real git path, exercised once against this repository
// ---------------------------------------------------------------------------

console.log("git facts");
{
  const g = gitContext(process.cwd(), null, "main");
  check("gitContext reports a branch", typeof g.branch === "string" && g.branch.length > 0, true);
  check("gitContext returns an array of changed files", Array.isArray(g.files), true);
  if (g.available) {
    check("changed paths are repo-relative", g.files.every((f) => !f.startsWith("/")), true);
  } else {
    ok(`gitContext degrades with a stated reason: ${g.error}`);
  }
  check("default branch falls back to main with no config", readDefaultBranch("/nonexistent"), "main");
}

// ---------------------------------------------------------------------------
// Registry coverage — the suite fails if a computed gate has no failing fixture
// ---------------------------------------------------------------------------

console.log("registry coverage");
{
  // GT-09 is exempt by construction: its content is undefined, so it reports
  // `deferred` and can never be made to fail. That exemption is itself asserted
  // above, against the clean tree.
  const computed = GATES.map((g) => g.id).filter((id) => id !== "GT-09");
  const uncovered = computed.filter((id) => !GATES_WITH_FAIL_FIXTURE.has(id));
  check("every computed gate has a failing fixture", uncovered, []);
  check(
    "deferred gates are all documented with a reason",
    DEFERRED_GATES.filter((g) => !g.reason).map((g) => g.id),
    [],
  );
  check(
    "every gate carries a description",
    GATES.filter((g) => !g.description || !g.title).map((g) => g.id),
    [],
  );
  console.log(`       ${GATES.length} gates, ${DEFERRED_GATES.length} deferred entries`);
}

console.log("");
if (FAILURES.length > 0) {
  console.log(`FAILED — ${FAILURES.length} of ${checks} checks:`);
  for (const f of FAILURES) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks.`);
