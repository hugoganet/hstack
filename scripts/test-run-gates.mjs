#!/usr/bin/env node
/**
 * Fixture tests for hstack/scripts/run-gates.sh. No dependencies, no runner.
 *
 *     node scripts/test-run-gates.mjs
 *
 * The runner's whole reason to exist is that "did this suite execute anything?"
 * must be a measurement, not a paragraph of parsing instructions handed to a
 * haiku-class subagent. So the suite is organised around that one property:
 * every runner-output shape hstack meets in practice gets a fixture, and each
 * one asserts the verdict the verifier will write into `test-results`.
 *
 * Commands are `printf`/`cat` of a canned transcript plus an exit code — the
 * point is the parsing and the verdict logic, not any real test framework.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const RUNNER = resolve("template/scripts/run-gates.sh");
const CHANGE_ID = "2026-08-core-widget-refresh";

const FAILURES = [];
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

/** A shell command that replays `text` on stdout and exits with `code`. */
function replay(text, code = 0) {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  return `printf %s '${encoded}' | base64 -d; exit ${code}`;
}

function ciCd(pairs) {
  const block = Object.entries(pairs)
    .map(([suite, cmd]) => `${suite}: ${cmd}`)
    .join("\n");
  return `---
id: ci-cd
type: ci-cd
status: current
owner: hugoganet
created: 2026-08-01
updated: 2026-08-01
schema-version: 1
---

## Canonical Commands

Prose a human reads, which the runner ignores: \`pnpm test\` is the one to use.

\`\`\`hstack-gates
${block}
\`\`\`
`;
}

/** Build a minimal repo, run the runner, return `{ code, stdout, stderr, json, output }`. */
function run(ciCdPairs, args = [], extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "hstack-run-gates-"));
  try {
    const write = (rel, content) => {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    };
    write("hstack/KERNEL.md", "# kernel marker\n");
    if (ciCdPairs !== null) write("hstack/context/ci-cd.md", ciCd(ciCdPairs));
    mkdirSync(join(root, "hstack", "specs", "changes", CHANGE_ID), { recursive: true });
    for (const [rel, content] of Object.entries(extra)) write(rel, content);

    const r = spawnSync("bash", [RUNNER, "--root", root, ...args], {
      encoding: "utf8",
      cwd: root,
    });
    const outFile = join(root, "hstack", "specs", "changes", CHANGE_ID, "test-output.txt");
    let output = null;
    try {
      output = readFileSync(outFile, "utf8");
    } catch {
      /* not every case writes one */
    }
    let json = null;
    if (args.includes("--json")) {
      try {
        json = JSON.parse(r.stdout);
      } catch {
        json = { parseError: r.stdout };
      }
    }
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, json, output };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const suite = (json, name) => (json?.suites ?? []).find((s) => s.suite === name);

// ---------------------------------------------------------------------------
// Canonical-command parsing
// ---------------------------------------------------------------------------

console.log("canonical commands");
{
  const r = run({ unit: "echo hi", lint: "echo lint", e2e: "none" }, ["--list"]);
  check("--list exits 0", r.code, 0);
  check("--list prints the declared suites", /unit\s+echo hi/.test(r.stdout), true);
  check("`none` declares a suite absent and is not listed", /e2e/.test(r.stdout), false);

  const noBlock = run(null, ["--list"]);
  check("a missing ci-cd.md is exit 2", noBlock.code, 2);
  check("...with a message naming the fix", /configure --interview ci-cd/.test(noBlock.stderr), true);

  const emptyBlock = mkdtempSync(join(tmpdir(), "hstack-run-gates-empty-"));
  try {
    mkdirSync(join(emptyBlock, "hstack", "context"), { recursive: true });
    writeFileSync(join(emptyBlock, "hstack", "KERNEL.md"), "# kernel\n");
    writeFileSync(
      join(emptyBlock, "hstack", "context", "ci-cd.md"),
      "---\nid: ci-cd\ntype: ci-cd\n---\n\n## Gates\n\nProse only, no fenced block.\n",
    );
    const r2 = spawnSync("bash", [RUNNER, "--root", emptyBlock, "--list"], { encoding: "utf8" });
    check("ci-cd.md with no hstack-gates block is exit 2", r2.status, 2);
    check(
      "...and says where the block belongs",
      /hstack-gates.*block|templates\/ci-cd\.md/s.test(r2.stderr),
      true,
    );
  } finally {
    rmSync(emptyBlock, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// V-05 — observed test counts per suite, per runner
// ---------------------------------------------------------------------------

console.log("observed-test-count per runner (V-05)");

const RUNNER_OUTPUTS = [
  {
    name: "Jest / Vitest, tests executed",
    text: "PASS src/widget.test.ts\n\nTest Files  3 passed (3)\n     Tests:  12 passed, 3 skipped, 15 total\n",
    expect: { verdict: "pass", passed: 12, skipped: 3, total: 15 },
  },
  {
    // The case V-05 exists for: a non-zero total with zero assertions.
    name: "Jest / Vitest, everything skipped",
    text: "Tests:       15 skipped, 15 total\n",
    expect: { verdict: "not-run", passed: 0, skipped: 15, total: 15, executed: 0 },
  },
  {
    name: "Jest / Vitest, no files matched the collection pattern",
    text: "No tests found, exiting with code 0\npattern: src/nothing\n",
    expect: { verdict: "not-run", total: 0 },
  },
  {
    name: "pytest, tests executed",
    text: "collected 15 items\n\n=========== 12 passed, 3 skipped in 0.42s ============\n",
    expect: { verdict: "pass", passed: 12, skipped: 3, total: 15 },
  },
  {
    name: "pytest, empty collection",
    text: "collected 0 items\n\n=========== no tests ran in 0.01s ============\n",
    expect: { verdict: "not-run", total: 0 },
  },
  {
    name: "Mocha, tests executed",
    text: "\n  9 passing (120ms)\n  1 pending\n",
    expect: { verdict: "pass", passed: 9, skipped: 1, total: 10 },
  },
  {
    name: "Playwright, tests executed",
    text: "Running 7 tests using 2 workers\n\n  7 passed (12.3s)\n",
    expect: { verdict: "pass", passed: 7, total: 7 },
  },
  {
    name: "Playwright, everything skipped by a tag filter",
    text: "Running 0 tests using 0 workers\n\n  3 skipped\n",
    expect: { verdict: "not-run", skipped: 3, total: 3, executed: 0 },
  },
  {
    name: "an unrecognised summary format",
    text: "everything is fine, trust me\n",
    expect: { verdict: "not-run", total: 0 },
  },
];

for (const c of RUNNER_OUTPUTS) {
  const r = run({ unit: replay(c.text) }, ["--change", CHANGE_ID, "--json"]);
  const s = suite(r.json, "unit");
  if (!s) {
    bad(c.name, `no unit suite in output: ${r.stdout}\n${r.stderr}`);
    continue;
  }
  const actual = { verdict: s.verdict };
  const expected = { verdict: c.expect.verdict };
  for (const k of ["passed", "failed", "skipped", "total", "executed"]) {
    if (c.expect[k] !== undefined) {
      actual[k] = s.observed[k];
      expected[k] = c.expect[k];
    }
  }
  check(c.name, actual, expected);
}

// Playwright's "3 skipped" case is the one worth stating explicitly: the runner
// read a real total but nothing executed, so it must still be `not-run`.
console.log("zero executed tests is not-run even when the total is non-zero");
{
  const r = run({ unit: replay("  3 skipped\n") }, ["--change", CHANGE_ID, "--json"]);
  const s = suite(r.json, "unit");
  check("skipped-only run is not-run", s.verdict, "not-run");
  check("...and the process exits 1", r.code, 1);
  check("...with a stated reason naming the skips", /zero executed tests — 3 skipped/.test(s.reason), true);
}

// ---------------------------------------------------------------------------
// Verdicts and exit codes
// ---------------------------------------------------------------------------

console.log("verdicts and exit codes");
{
  const green = run(
    {
      unit: replay("Tests:  4 passed, 4 total\n"),
      integration: replay("Tests:  2 passed, 2 total\n"),
      lint: replay("no problems\n"),
      typecheck: replay(""),
    },
    ["--change", CHANGE_ID, "--json"],
  );
  check("all green exits 0", green.code, 0);
  check("ok is true", green.json.ok, true);
  check("every suite is pass", green.json.suites.map((s) => s.verdict), [
    "pass",
    "pass",
    "pass",
    "pass",
  ]);
  check(
    "lint and typecheck are exempt from V-05 at zero counts",
    green.json.suites.filter((s) => ["lint", "typecheck"].includes(s.suite)).map((s) => s.verdict),
    ["pass", "pass"],
  );
  check(
    "the pointer path is repo-relative",
    green.json["test-output"],
    `hstack/specs/changes/${CHANGE_ID}/test-output.txt`,
  );

  const red = run(
    {
      unit: replay("Tests:  3 passed, 1 failed, 4 total\n", 1),
      lint: replay("clean\n"),
    },
    ["--change", CHANGE_ID, "--json"],
  );
  check("a non-zero command exit is a fail verdict", suite(red.json, "unit").verdict, "fail");
  check("...and the runner exits 1", red.code, 1);
  check("a later suite still runs after an earlier failure", suite(red.json, "lint").verdict, "pass");

  const filtered = run(
    { unit: replay("Tests:  1 passed, 1 total\n"), lint: replay("clean\n") },
    ["--change", CHANGE_ID, "--suite", "lint", "--json"],
  );
  check("--suite runs only what was asked", filtered.json.suites.map((s) => s.suite), ["lint"]);
}

// ---------------------------------------------------------------------------
// The captured pointer file
// ---------------------------------------------------------------------------

console.log("captured output");
{
  const r = run(
    {
      unit: replay("Tests:  4 passed, 4 total\nthe-unit-marker\n"),
      lint: replay("the-lint-marker\n"),
    },
    ["--change", CHANGE_ID],
  );
  check("the pointer file is written", typeof r.output === "string", true);
  check("it carries every suite's stdout", /the-unit-marker/.test(r.output) && /the-lint-marker/.test(r.output), true);
  check("it labels each suite", /--- suite: unit/.test(r.output), true);
  check("it records the command that ran", /^\$ /m.test(r.output), true);
  check(
    "it records the per-suite verdict",
    /suite: unit → pass \(exit 0, 4 of 4 test\(s\) executed\)/.test(r.output),
    true,
  );
  check(
    "the human report names the verification field to fill",
    /verification\.artifacts\.test-output/.test(r.stdout),
    true,
  );

  const missing = run({ unit: replay("Tests: 1 passed, 1 total\n") }, ["--change", "no-such-change"]);
  check("an unknown change id is exit 2", missing.code, 2);
}

// ---------------------------------------------------------------------------

console.log("");
if (FAILURES.length > 0) {
  console.log(`FAILED — ${FAILURES.length} of ${checks} checks:`);
  for (const f of FAILURES) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks.`);
