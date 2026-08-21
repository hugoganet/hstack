#!/usr/bin/env node
/**
 * Fixture tests for the `description-budget` doctor finding (ADR-0011 Option F).
 *
 *     node scripts/test-description-budget.mjs
 *
 * Two properties, and they pull in opposite directions:
 *
 *   1. The current template produces ZERO findings. ADR-0011 refused to ship
 *      this linter alongside the rewrite because "a linter for a size that no
 *      file currently respects would flag 52 findings on day one". A linter
 *      that fires on the state it was written to bless is the same mistake
 *      inverted — it would be turned off within a week.
 *   2. An inflated description produces exactly one. The finding exists to
 *      catch the regression back toward `<example>` blocks in frontmatter.
 *
 * Imports from `dist/` because the scanner is TypeScript; `npm test` builds
 * first (`pretest`).
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  descriptionsOverBudget,
  measureDescriptions,
  extractDescription,
  wordCount,
  BUDGET_CARVE_OUTS,
  WORD_BUDGET,
  CHAR_BUDGET,
} from "../dist/lib/descriptions.js";

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
// The frontmatter reader
// ---------------------------------------------------------------------------

console.log("description extraction");
{
  check(
    "single-line scalar",
    extractDescription("---\nname: x\ndescription: Use when a thing happens.\n---\n\nbody\n"),
    "Use when a thing happens.",
  );
  check(
    "quoted scalar",
    extractDescription('---\ndescription: "Use when: a thing happens."\n---\n'),
    "Use when: a thing happens.",
  );
  check(
    "folded block scalar",
    extractDescription("---\ndescription: >-\n  Use when a thing\n  happens.\n---\n"),
    "Use when a thing happens.",
  );
  check("no frontmatter", extractDescription("# just a heading\n"), null);
  check("unterminated frontmatter", extractDescription("---\ndescription: x\n"), null);
  check("no description key", extractDescription("---\nname: x\n---\n"), null);
  check(
    "a `description:` in the body is not read",
    extractDescription("---\nname: x\n---\n\ndescription: not this one\n"),
    null,
  );
  check("word count ignores runs of whitespace", wordCount("  a   b\nc  "), 3);
}

// ---------------------------------------------------------------------------
// Property 1 — the shipped template is clean
// ---------------------------------------------------------------------------

console.log("the current template");
{
  const all = measureDescriptions("template");
  check("every skill and agent is scanned", all.length, 52);
  check(
    "every scanned file yielded a description",
    all.filter((d) => d.words === 0).map((d) => d.name),
    [],
  );

  const findings = descriptionsOverBudget("template");
  if (findings.length === 0) ok("the current template produces zero findings");
  else
    bad(
      "the current template produces zero findings",
      findings.map((d) => `${d.name} — ${d.words}w / ${d.chars}c`).join("\n         "),
    );

  // The carve-out is a decision, not a snooze: assert it is still doing work,
  // so deleting the carve-out without shrinking the description fails here
  // rather than silently at a consumer.
  const coord = all.find((d) => d.name === "hstack-coord");
  check("hstack-coord is carved out", coord?.carveOut !== null, true);
  check("hstack-coord is genuinely over budget", coord.words > WORD_BUDGET, true);
  check(
    "no carve-out is granted to a file that does not need one",
    all.filter((d) => d.carveOut !== null && d.words <= WORD_BUDGET && d.chars <= CHAR_BUDGET).map((d) => d.name),
    [],
  );
  check("only hstack-coord is carved out", [...BUDGET_CARVE_OUTS.keys()], ["hstack-coord"]);
  console.log(
    `       ${all.length} descriptions, longest non-carve-out ` +
      `${Math.max(...all.filter((d) => !d.carveOut).map((d) => d.words))}w / ` +
      `${Math.max(...all.filter((d) => !d.carveOut).map((d) => d.chars))}c ` +
      `(budget ${WORD_BUDGET}w / ${CHAR_BUDGET}c)`,
  );
}

// ---------------------------------------------------------------------------
// Property 2 — a regression is caught
// ---------------------------------------------------------------------------

/** Copy the real template, apply `mutate`, and scan the copy. */
function withTemplate(mutate) {
  const root = mkdtempSync(join(tmpdir(), "hstack-desc-"));
  try {
    cpSync("template", join(root, "template"), { recursive: true });
    mutate({
      writeSkill(name, frontmatter) {
        const dir = join(root, "template", ".claude", "skills", name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "SKILL.md"), frontmatter);
      },
      writeAgent(name, frontmatter) {
        const dir = join(root, "template", ".claude", "agents");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${name}.md`), frontmatter);
      },
    });
    return descriptionsOverBudget(join(root, "template"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const doc = (description) =>
  `---\nname: inflated\ndescription: ${description}\ntools:\n  - Read\n---\n\n## Purpose\n\nBody.\n`;

console.log("regression fixtures");
{
  // The shape ADR-0011 removed: a scripted example block back in frontmatter.
  const inflated =
    "Use when a change-spec is at ready-to-plan and needs decomposition into atomic phases. " +
    "<example>user: can you plan the widget refresh? assistant: I'll invoke planner. The change-spec " +
    "is at ready-to-plan and test-plan.md is at passed, so the preconditions hold. I'll decompose the " +
    "change into atomic phases, each with its own Verifier Expectations, and sequence them against the " +
    "in-scope allowlist.<commentary>The planner refuses to sequence phases without a terminal test-plan, " +
    "so the assistant checks that first.</commentary></example>";

  const findings = withTemplate((t) => t.writeSkill("hstack-inflated", doc(inflated)));
  check("an inflated skill description produces exactly one finding", findings.length, 1);
  check("...naming the skill", findings[0]?.name, "hstack-inflated");
  check("...with its kind", findings[0]?.kind, "skill");
  check("...and a repo-relative path", findings[0]?.relpath, ".claude/skills/hstack-inflated/SKILL.md");
  check("...over the word budget", findings[0]?.words > WORD_BUDGET, true);

  const agentFindings = withTemplate((t) => t.writeAgent("inflated-agent", doc(inflated)));
  check("an inflated agent description is caught too", agentFindings.map((d) => d.name), ["inflated-agent"]);
  check("...with its kind", agentFindings[0]?.kind, "agent");

  // Exactly at the budget is compliant; one word over is not.
  const atBudget = Array.from({ length: WORD_BUDGET }, (_, i) => `word${i}`).join(" ");
  check(
    "exactly 40 words is within budget",
    withTemplate((t) => t.writeSkill("hstack-at-budget", doc(atBudget))).length,
    0,
  );
  check(
    "41 words is over",
    withTemplate((t) => t.writeSkill("hstack-over", doc(`${atBudget} onemore`))).map((d) => d.name),
    ["hstack-over"],
  );

  // The character ceiling catches the other regression shape: few words, each
  // enormous — a wall of backticked paths rather than a sentence.
  const longChars = Array.from({ length: 12 }, () => "`hstack/specs/changes/<id>/adversarial-review.md`").join(" ");
  const charOnly = withTemplate((t) => t.writeSkill("hstack-wide", doc(longChars)));
  check("a description under 40 words but over the character ceiling is caught", charOnly.map((d) => d.name), [
    "hstack-wide",
  ]);
  check("...on characters, not words", charOnly[0]?.words <= WORD_BUDGET, true);

  // A carved-out name stays silent even when inflated — that is what a
  // carve-out means, and it is why adding one has to be an argued decision.
  check(
    "the carve-out suppresses a name on the list",
    withTemplate((t) => t.writeSkill("hstack-coord", doc(inflated))).map((d) => d.name),
    [],
  );
}

console.log("");
if (FAILURES.length > 0) {
  console.log(`FAILED — ${FAILURES.length} of ${checks} checks:`);
  for (const f of FAILURES) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`PASSED — ${checks} checks.`);
