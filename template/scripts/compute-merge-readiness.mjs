#!/usr/bin/env node
/**
 * hstack merge-readiness scorecard — the twelve gates `/hstack:ship` reports,
 * and the thing `{{TODO-SCRIPT: compute-merge-readiness.ts}}` stood in for.
 *
 *   node hstack/scripts/compute-merge-readiness.mjs <change-id>
 *   node hstack/scripts/compute-merge-readiness.mjs <change-id> --json
 *   node hstack/scripts/compute-merge-readiness.mjs <change-id> --base origin/main
 *   node hstack/scripts/compute-merge-readiness.mjs --gates            # the registry
 *
 * Exit codes: 0 every applicable gate passes, 1 at least one gate blocks,
 * 2 usage / environment error (no change folder, no change-spec, …).
 *
 * ## Why .mjs and not .ts
 *
 * The name declared in `hstack-ship` was `compute-merge-readiness.ts`. Same
 * decision as ADR-0001 and `validate-spec.mjs`: consuming repos have no
 * `node_modules` for hstack, so a `.ts` entrypoint would impose a runtime
 * (node >= 22.6 with `--experimental-strip-types`, or `npx tsx`) on every
 * consumer. Plain ESM runs on the node the consumer already has and imports
 * `validate-spec.mjs` — the frontmatter parser, the section parser and the
 * glob matcher are already there and are not written twice.
 *
 * ## The registry is the inventory
 *
 * `GATES` carries one entry per gate id named in `hstack-ship`, and
 * `DEFERRED_GATES` names the ones that are NOT computable together with the
 * reason. Nothing disappears: a gate is either computed here or listed as
 * deferred with a stated cause. The Skill states each gate as a one-line
 * contract; this file is where the arithmetic lives, so the two cannot drift
 * into two different answers.
 *
 * ## Verdicts
 *
 *   pass             the gate's condition holds
 *   fail             the gate's condition is violated — blocks
 *   unknown          the gate could not be evaluated (no git, lints not run) — blocks
 *   not-applicable   the gate's precondition does not hold for this change
 *   deferred         the gate's content is not defined anywhere in the repo
 *
 * `fail` and `unknown` block ready-to-ship. "Not evaluated" is not "passed" —
 * the same rule V-05 applies to a suite that executed zero tests.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import {
  loadArtifact,
  buildWorld,
  findHstackRoot,
  globMatches,
  substantiveLines,
} from "./validate-spec.mjs";

// ---------------------------------------------------------------------------
// 1. Verdict helpers
// ---------------------------------------------------------------------------

const PASS = (detail) => ({ verdict: "pass", detail: detail ?? null });
const FAIL = (detail) => ({ verdict: "fail", detail });
const UNKNOWN = (detail) => ({ verdict: "unknown", detail });
const NA = (detail) => ({ verdict: "not-applicable", detail });
const DEFERRED = (detail) => ({ verdict: "deferred", detail });

/** Verdicts that stop a change from being ready to ship. */
const BLOCKING = new Set(["fail", "unknown"]);

const present = (v) => v !== null && v !== undefined && String(v).trim() !== "";

const arr = (v) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]);

const list = (xs, max = 6) =>
  xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")}, … (+${xs.length - max})`;

/** Status of an artifact that may be absent. */
const statusOf = (a) => (a && a.fm ? String(a.fm.status) : null);

// ---------------------------------------------------------------------------
// 2. Gate registry
// ---------------------------------------------------------------------------
//
// Each entry: { id, title, description, check(ctx) }.
// `check` returns one of the verdict helpers above.
//
// `ctx` is built by `buildContext` below and carries:
//   spec        the change-spec artifact record
//   art         { plan, testPlan, securityReview, dataReview, uiBrief,
//                 figmaHandoff, verification, adversarialReview } — null when absent
//   world       the whole-tree artifact index (validate-spec's buildWorld)
//   git         { available, branch, base, mergeBase, files, onBase, error }
//   lints       repo-relative paths of hstack/lints/*.yaml
//   gatesExit   exit code of run-gates.sh, or null when it was not run

/**
 * Paths hstack itself writes on the change branch by construction — every
 * Skill's auto-commit lands in one of them. GT-02 defends the *implementer's*
 * write boundary (kernel § Scope rules: "CI enforces the write boundary at PR
 * time"); the framework's own audit trail is not what it is defending, and a
 * gate that failed on the artifacts the workflow just wrote would be switched
 * off within a week. Named here rather than inferred, so the carve-out is
 * reviewable.
 *
 * `<id>` is substituted with the change id — a change may write its OWN
 * artifact folder, never a sibling change's.
 */
const WORKFLOW_OWNED = [
  "hstack/specs/changes/<id>/**",
  "hstack/adr/**",
  "hstack/tech-debt/**",
  "hstack/kernel-fit/**",
  "hstack/coord/**",
  "hstack/research/**",
  "hstack/telemetry/reports/**",
];

/** Terminal statuses per artifact type, as `hstack-ship` states them. */
const REVIEW_TERMINAL = ["passed", "concerns-acknowledged"];

export const GATES = [
  {
    id: "GT-01",
    title: "spec presence",
    description:
      "The change folder exists with a change-spec past `draft`, or the change carries `trivial: true`. A draft spec is not a contract anything can be scored against.",
    check(ctx) {
      if (ctx.spec.fm.trivial === true) {
        return PASS("`trivial: true` — spec-presence is bypassed per the kernel's trivial carve-out");
      }
      const s = statusOf(ctx.spec);
      if (s === "draft" || s === "archived") {
        return FAIL(`change-spec is at \`${s}\`; a shippable spec is past draft and not archived`);
      }
      return PASS(`change-spec at \`${s}\``);
    },
  },
  {
    id: "GT-02",
    title: "diff within scope",
    description:
      "Every file in the PR diff (against the merge target) is a subset of `change-spec.in-scope`, plus the named workflow-owned carve-out. Mandatory even for `trivial: true`.",
    check(ctx) {
      if (!ctx.git.available) {
        return UNKNOWN(`the diff could not be read: ${ctx.git.error}`);
      }
      if (ctx.git.onBase) {
        return UNKNOWN(
          `HEAD is \`${ctx.git.branch}\`, which is the merge target — there is no PR diff to score. ` +
            `Check out \`change/${ctx.changeId}\` (\`/hstack:branch ${ctx.changeId}\`) and re-run.`,
        );
      }
      const inScope = arr(ctx.spec.fm["in-scope"]).filter(present).map(String);
      if (inScope.length === 0) {
        return FAIL("`in-scope` is empty — every changed file is out of scope by definition");
      }
      const owned = WORKFLOW_OWNED.map((g) => g.replace("<id>", ctx.changeId));
      const offenders = ctx.git.files.filter(
        (f) => !inScope.some((g) => globMatches(g, f)) && !owned.some((g) => globMatches(g, f)),
      );
      if (offenders.length > 0) {
        return FAIL(
          `${offenders.length} of ${ctx.git.files.length} changed file(s) outside \`in-scope\`: ${list(offenders)}`,
        );
      }
      return PASS(`${ctx.git.files.length} changed file(s), all within \`in-scope\``);
    },
  },
  {
    id: "GT-03",
    title: "pattern lints",
    description:
      "Every rule under `hstack/lints/*.yaml` passes. Computed from the exit code of `hstack/scripts/run-gates.sh`, passed in with `--gates-exit`.",
    check(ctx) {
      if (ctx.lints.length === 0) {
        return NA("no `hstack/lints/*.yaml` rules are declared in this repo");
      }
      if (ctx.gatesExit === null) {
        return UNKNOWN(
          `${ctx.lints.length} lint rule file(s) declared but the gate runner was not run — ` +
            "run `hstack/scripts/run-gates.sh` and re-run with `--gates-exit <code>`",
        );
      }
      return ctx.gatesExit === 0
        ? PASS(`run-gates.sh exited 0 against ${ctx.lints.length} rule file(s)`)
        : FAIL(`run-gates.sh exited ${ctx.gatesExit} — read the captured output for the failing rule`);
    },
  },
  {
    id: "GT-04",
    title: "adversarial-review resolved",
    description: "`adversarial-review.md` is at `findings-resolved`.",
    check(ctx) {
      return terminalGate(ctx.art.adversarialReview, "adversarial-review.md", ["findings-resolved"]);
    },
  },
  {
    id: "GT-05",
    title: "security-review terminal",
    description: "`security-review.md` is at `passed` or `concerns-acknowledged`.",
    check(ctx) {
      return terminalGate(ctx.art.securityReview, "security-review.md", REVIEW_TERMINAL);
    },
  },
  {
    id: "GT-06",
    title: "data-review terminal",
    description:
      "`data-review.md` is at `passed` or `concerns-acknowledged`, when `surfaces` includes `db`.",
    check(ctx) {
      if (!ctx.surfaces.includes("db")) {
        return NA("`surfaces` does not include `db`");
      }
      return terminalGate(ctx.art.dataReview, "data-review.md", REVIEW_TERMINAL);
    },
  },
  {
    id: "GT-07",
    title: "ui artifacts terminal",
    description:
      "`ui-brief.md` is at `drafted` and `figma-handoff.md` is at `ready`, when `surfaces` includes `ui`.",
    check(ctx) {
      if (!ctx.surfaces.includes("ui")) {
        return NA("`surfaces` does not include `ui`");
      }
      const parts = [
        terminalGate(ctx.art.uiBrief, "ui-brief.md", ["drafted"]),
        terminalGate(ctx.art.figmaHandoff, "figma-handoff.md", ["ready"]),
      ];
      const bad = parts.filter((p) => p.verdict !== "pass");
      return bad.length === 0
        ? PASS(parts.map((p) => p.detail).join("; "))
        : FAIL(bad.map((p) => p.detail).join("; "));
    },
  },
  {
    id: "GT-08",
    title: "user value declared",
    description:
      "`user-stories` is non-empty, UNLESS exactly one no-story carve-out is declared: Category A `internal-tooling: true`, Category B non-empty `enables`, Category C `area: bootstrap`. Restates SP-09; GT-12 owns the mutual exclusion.",
    check(ctx) {
      const stories = arr(ctx.spec.fm["user-stories"]).filter(present);
      if (stories.length > 0) return PASS(`${stories.length} user story reference(s)`);
      if (ctx.spec.fm["internal-tooling"] === true) {
        return PASS("Category A — `internal-tooling: true`, never on a user path");
      }
      const enables = arr(ctx.spec.fm.enables).filter(present).map(String);
      if (enables.length > 0) {
        // The audit-chain assumption, stated so it is not mistaken for a bug:
        // a Category-B spec's user value lives in one of the specs it enables.
        // This gate does not transitively verify that downstream spec has
        // `user-stories` non-empty — that is the downstream's own GT-08, run at
        // its own ship time. Category C terminates the chain by construction.
        return PASS(
          `Category B — user value is realized downstream by ${list(enables)} ` +
            "(not transitively verified here; that is the downstream's own GT-08)",
        );
      }
      if (String(ctx.spec.fm.area) === "bootstrap") {
        return PASS("Category C — `area: bootstrap`");
      }
      return FAIL(
        "`user-stories` is empty and no carve-out is declared — set `internal-tooling: true` (A), " +
          "a non-empty `enables` (B), or `area: bootstrap` (C)",
      );
    },
  },
  {
    id: "GT-09",
    title: "cross-reference rules",
    description:
      "Every cross-reference rule CG-01..CG-04 passes. The range is named by `hstack-ship`; no repo source states what the four rules are.",
    check() {
      return DEFERRED(
        "CG-01..CG-04 are named as a range but stated nowhere — implementing them would mean " +
          "inventing them. Assigning the four statements is a kernel change, not a script change. " +
          "The reciprocity and presence rules the range would plausibly cover are already enforced " +
          "by `validate-spec.mjs` (SP-14, TD-01, TD-04, TD-05, KF-04) and by GT-12.",
      );
    },
  },
  {
    id: "GT-10",
    title: "test coverage honoured",
    description:
      "`test-plan.md` is at `passed` or `concerns-acknowledged`, and `verification.test-plan-coverage` shows no missing tenant-isolation tests and no out-of-budget performance assertions.",
    check(ctx) {
      const tp = terminalGate(ctx.art.testPlan, "test-plan.md", REVIEW_TERMINAL);
      if (tp.verdict !== "pass") return tp;

      const v = ctx.art.verification;
      if (!v) return FAIL("verification.md is missing — coverage cannot be scored");
      const cov = v.fm["test-plan-coverage"];
      if (!cov || typeof cov !== "object") {
        return FAIL("verification.md carries no `test-plan-coverage` map");
      }
      const problems = [];
      const tenant = String(cov["tenant-isolation"]);
      if (!["all-observed", "not-applicable"].includes(tenant)) {
        problems.push(`tenant-isolation is \`${tenant}\` (must be all-observed or not-applicable)`);
      }
      const perf = String(cov["performance-budgets"]);
      if (!["all-within-budget", "not-applicable"].includes(perf)) {
        problems.push(
          `performance-budgets is \`${perf}\` (must be all-within-budget or not-applicable)`,
        );
      }
      return problems.length === 0
        ? PASS(`${tp.detail}; tenant-isolation \`${tenant}\`, performance-budgets \`${perf}\``)
        : FAIL(problems.join("; "));
    },
  },
  {
    id: "GT-11",
    title: "tech-debt resolution honest",
    description:
      "When `resolves-tech-debt` is non-empty: every referenced tech-debt exists at `status: in-progress` with `resolution-attempted-at` set, none already carries a `resolved-by`, and the adversarial-review carries its AR-07 Acceptance-satisfied confirmation.",
    check(ctx) {
      const tds = arr(ctx.spec.fm["resolves-tech-debt"]).filter(present).map(String);
      if (tds.length === 0) return NA("`resolves-tech-debt` is empty");

      const problems = [];
      for (const id of tds) {
        const td = ctx.world.byId.get(id);
        if (!td || td.type !== "tech-debt") {
          problems.push(`${id} names no tech-debt on disk`);
          continue;
        }
        const s = statusOf(td);
        if (s !== "in-progress") {
          problems.push(
            `${id} is at \`${s}\`; a debt under active resolution is at \`in-progress\` ` +
              "(`/hstack:tech-debt-resolve` flips it, `/hstack:finalize` closes it post-merge)",
          );
        }
        if (!present(td.fm["resolution-attempted-at"])) {
          problems.push(`${id} has no \`resolution-attempted-at\``);
        }
        if (present(td.fm["resolved-by"])) {
          problems.push(
            `${id} already carries \`resolved-by: ${td.fm["resolved-by"]}\` — double resolution`,
          );
        }
      }

      // (b) AR-07: presence of the Acceptance-satisfied confirmation. This is
      // the one place ship reads a body section rather than frontmatter — the
      // confirmation has no frontmatter representation.
      const ar = ctx.art.adversarialReview;
      if (!ar) {
        problems.push("adversarial-review.md is missing, so the AR-07 confirmation cannot be present");
      } else {
        const hit = ar.sections.find((s) => /acceptance[- ]satisfied/i.test(s.title));
        if (!hit) {
          problems.push('adversarial-review.md carries no "Acceptance Satisfied" subsection (AR-07)');
        } else if (substantiveLines(hit).length === 0) {
          problems.push('the adversarial-review\'s "Acceptance Satisfied" subsection is empty (AR-07)');
        }
      }

      return problems.length === 0
        ? PASS(`${tds.length} tech-debt item(s) at \`in-progress\` with the AR-07 confirmation present`)
        : FAIL(problems.join("; "));
    },
  },
  {
    id: "GT-12",
    title: "category exclusivity and reciprocity",
    description:
      "SP-13: `internal-tooling: true` AND non-empty `enables` is forbidden. SP-14: every id in `enables` names a change-spec on disk that lists this change-id in its `enabled-by`, and every `enabled-by` entry reciprocates. Both directions are FAIL.",
    check(ctx) {
      const problems = [];
      const id = String(ctx.spec.fm.id);
      const enables = arr(ctx.spec.fm.enables).filter(present).map(String);

      // SP-13 — hard FAIL, and the reason the two halves are one gate: a spec
      // that is both A and B has no coherent user-value story to audit.
      const declared = [];
      if (ctx.spec.fm["internal-tooling"] === true) declared.push("`internal-tooling: true` (A)");
      if (enables.length > 0) declared.push("non-empty `enables` (B)");
      if (String(ctx.spec.fm.area) === "bootstrap") declared.push("`area: bootstrap` (C)");
      if (declared.length > 1) {
        problems.push(
          `the no-story categories are mutually exclusive but this spec declares ${declared.length}: ${declared.join(", ")}`,
        );
      }

      // SP-14 — reciprocity, both directions. By ship time a forward reference
      // must have been scaffolded; only authoring time tolerates a dangling id.
      for (const target of enables) {
        const other = ctx.world.byId.get(target);
        if (!other || other.type !== "change-spec") {
          problems.push(
            `enables \`${target}\` names no change-spec on disk — by ship time the downstream must be scaffolded`,
          );
          continue;
        }
        if (!arr(other.fm["enabled-by"]).map(String).includes(id)) {
          problems.push(`enables \`${target}\` but ${other.relpath} does not list \`${id}\` in \`enabled-by\``);
        }
      }
      for (const source of arr(ctx.spec.fm["enabled-by"]).filter(present).map(String)) {
        const other = ctx.world.byId.get(source);
        if (!other || other.type !== "change-spec") {
          problems.push(`enabled-by \`${source}\` names no change-spec on disk`);
          continue;
        }
        if (!arr(other.fm.enables).map(String).includes(id)) {
          problems.push(`enabled-by \`${source}\` but ${other.relpath} does not list \`${id}\` in \`enables\``);
        }
      }

      return problems.length === 0 ? PASS("categories exclusive, reciprocity holds") : FAIL(problems.join("; "));
    },
  },
];

/**
 * Gates named by `hstack-ship` that this script does NOT compute, with the
 * reason. Printed by `--gates` and surfaced in `--json`, mirroring
 * `validate-spec.mjs`'s `DEFERRED_RULES`, so nothing quietly disappears
 * between "documented" and "enforced".
 */
export const DEFERRED_GATES = [
  {
    id: "CG-01..CG-04",
    gate: "GT-09",
    reason:
      "The repo names the range (`GT-09: every cross-reference rule (CG-01..CG-04) passes`) but no source states what the four rules are. Implementing them means inventing them. Defining the four statements is a kernel change — a kernel-fit candidate, not a TODO in this file.",
  },
];

/** Shared shape for the "artifact X is at one of these statuses" gates. */
function terminalGate(a, filename, terminals) {
  if (!a) return FAIL(`${filename} is missing`);
  const s = statusOf(a);
  return terminals.includes(s)
    ? PASS(`${filename} at \`${s}\``)
    : FAIL(`${filename} is at \`${s}\`; required: ${terminals.map((t) => `\`${t}\``).join(" | ")}`);
}

// ---------------------------------------------------------------------------
// 3. Git facts
// ---------------------------------------------------------------------------

function git(repoRoot, args) {
  try {
    const out = execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, out: out.trim() };
  } catch (err) {
    const msg = (err && (err.stderr || err.message)) || String(err);
    return { ok: false, out: "", error: String(msg).trim().split("\n")[0] };
  }
}

const refExists = (repoRoot, ref) => git(repoRoot, ["rev-parse", "--verify", "--quiet", ref]).ok;

/**
 * The merge target. `--base` wins; otherwise the default branch from
 * `hstack/config.yaml` (fallback `main`), preferring its remote-tracking ref
 * because that is what the PR will actually be diffed against.
 */
function resolveBase(repoRoot, baseOpt, defaultBranch) {
  if (baseOpt) return baseOpt;
  for (const candidate of [`origin/${defaultBranch}`, defaultBranch]) {
    if (refExists(repoRoot, candidate)) return candidate;
  }
  return defaultBranch;
}

/**
 * The PR diff. `git diff --name-only <merge-base>` rather than `<base>...HEAD`
 * so uncommitted work counts too — ship runs *before* the PR exists, and a
 * scorecard that scored only committed files would pass a change whose
 * out-of-scope edit is still in the working tree. Untracked files are added
 * separately because `git diff` cannot see them.
 */
export function gitContext(repoRoot, baseOpt, defaultBranch) {
  const head = git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!head.ok) {
    return { available: false, branch: null, base: null, files: [], error: head.error };
  }
  const branch = head.out;
  const base = resolveBase(repoRoot, baseOpt, defaultBranch);
  if (!refExists(repoRoot, base)) {
    return {
      available: false,
      branch,
      base,
      files: [],
      error: `merge target \`${base}\` does not resolve — pass \`--base <ref>\``,
    };
  }
  const mb = git(repoRoot, ["merge-base", base, "HEAD"]);
  if (!mb.ok) {
    return { available: false, branch, base, files: [], error: `no merge-base with \`${base}\`: ${mb.error}` };
  }
  const changed = git(repoRoot, ["diff", "--name-only", mb.out]);
  const untracked = git(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
  const files = [
    ...new Set([...changed.out.split("\n"), ...untracked.out.split("\n")].map((s) => s.trim()).filter(Boolean)),
  ].sort();

  // HEAD is the merge target itself: the diff is empty by construction, and an
  // empty diff would make GT-02 pass without having looked at anything.
  const baseBranch = base.replace(/^[^/]+\//, "");
  const onBase = branch === base || branch === baseBranch;

  return { available: true, branch, base, mergeBase: mb.out, files, onBase, error: null };
}

// ---------------------------------------------------------------------------
// 4. Context assembly
// ---------------------------------------------------------------------------

/** Per-change artifact filenames, in the order the scorecard reports them. */
const CHANGE_ARTIFACTS = {
  plan: "plan.md",
  testPlan: "test-plan.md",
  securityReview: "security-review.md",
  dataReview: "data-review.md",
  uiBrief: "ui-brief.md",
  figmaHandoff: "figma-handoff.md",
  verification: "verification.md",
  adversarialReview: "adversarial-review.md",
};

/** Best-effort read of `default-branch` from hstack/config.yaml. */
export function readDefaultBranch(hstackRoot) {
  const cfg = join(hstackRoot, "config.yaml");
  if (!existsSync(cfg)) return "main";
  try {
    const m = /^\s*default-branch:\s*(\S+)\s*$/m.exec(readFileSync(cfg, "utf8"));
    return m ? m[1].replace(/^["']|["']$/g, "") : "main";
  } catch {
    return "main";
  }
}

function readLintRules(hstackRoot) {
  const dir = join(hstackRoot, "lints");
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .sort()
      .map((f) => `hstack/lints/${f}`);
  } catch {
    return [];
  }
}

/**
 * Assemble everything the gates read. Separated from `main` so the tests can
 * hand-build a context — including a synthetic `git` — and score it without a
 * repository.
 *
 * Returns `{ error }` for the two stop conditions `hstack-ship` names: the
 * change folder is missing, or the change-spec is missing / unparseable.
 */
export function buildContext(repoRoot, hstackRoot, changeId, opts = {}) {
  const changeDir = join(hstackRoot, "specs", "changes", changeId);
  if (!existsSync(changeDir)) {
    return { error: `no change folder at hstack/specs/changes/${changeId}/` };
  }
  const specPath = join(changeDir, "spec.md");
  if (!existsSync(specPath)) {
    return { error: `no change-spec at hstack/specs/changes/${changeId}/spec.md` };
  }
  const spec = loadArtifact(specPath, repoRoot);
  if (spec.noFrontmatter || spec.unreadable) {
    return { error: `hstack/specs/changes/${changeId}/spec.md: ${spec.parseError ?? spec.unreadable}` };
  }
  if (spec.type !== "change-spec") {
    return { error: `hstack/specs/changes/${changeId}/spec.md carries \`type: ${spec.type}\`, not change-spec` };
  }

  const art = {};
  const missing = [];
  for (const [key, filename] of Object.entries(CHANGE_ARTIFACTS)) {
    const p = join(changeDir, filename);
    if (!existsSync(p)) {
      art[key] = null;
      continue;
    }
    const a = loadArtifact(p, repoRoot);
    if (a.noFrontmatter || a.unreadable) {
      // A present-but-unreadable artifact is a halt, not a FAIL: the scorecard
      // would be scoring a file it could not parse.
      missing.push(`${filename}: ${a.parseError ?? a.unreadable}`);
      art[key] = null;
      continue;
    }
    art[key] = a;
  }
  if (missing.length > 0) return { error: `unparseable frontmatter — ${missing.join("; ")}` };

  const defaultBranch = readDefaultBranch(hstackRoot);
  return {
    changeId,
    repoRoot,
    hstackRoot,
    spec,
    art,
    surfaces: arr(spec.fm.surfaces).filter(present).map(String),
    world: buildWorld(repoRoot, hstackRoot),
    defaultBranch,
    lints: readLintRules(hstackRoot),
    gatesExit: opts.gatesExit ?? null,
    git: opts.git ?? gitContext(repoRoot, opts.base ?? null, defaultBranch),
  };
}

// ---------------------------------------------------------------------------
// 5. Runner
// ---------------------------------------------------------------------------

export function score(ctx) {
  const results = [];
  for (const gate of GATES) {
    let r;
    try {
      r = gate.check(ctx);
    } catch (err) {
      r = UNKNOWN(`scorecard error while computing this gate: ${err && err.message ? err.message : err}`);
    }
    results.push({ id: gate.id, title: gate.title, verdict: r.verdict, detail: r.detail ?? null });
  }
  const counts = { pass: 0, fail: 0, unknown: 0, "not-applicable": 0, deferred: 0 };
  for (const r of results) counts[r.verdict]++;
  return { gates: results, counts, ready: results.every((r) => !BLOCKING.has(r.verdict)) };
}

// ---------------------------------------------------------------------------
// 6. CLI
// ---------------------------------------------------------------------------

function usage() {
  return `hstack compute-merge-readiness — the twelve-gate merge-readiness scorecard

  node hstack/scripts/compute-merge-readiness.mjs <change-id> [options]

Options
  --json              emit the scorecard as JSON on stdout
  --base REF          merge target to diff against (default: origin/<default-branch>)
  --gates-exit N      exit code from hstack/scripts/run-gates.sh, for GT-03
  --gates             print the gate registry (computed + deferred) and exit
  --root DIR          repo root to resolve hstack/ from (default: search upward)
  -h, --help          this text

Exit codes: 0 every applicable gate passes, 1 at least one gate blocks,
2 usage or environment error.`;
}

function printGates() {
  console.log(
    `# hstack merge-readiness registry — ${GATES.length} gates, ${DEFERRED_GATES.length} deferred entries\n`,
  );
  console.log("## Computed\n");
  for (const g of GATES) console.log(`- ${g.id}  ${g.title}\n    ${g.description}`);
  console.log("\n## Deferred — named, not computable\n");
  for (const d of DEFERRED_GATES) console.log(`- ${d.id}  [${d.gate}]\n    ${d.reason}`);
}

const TAG = {
  pass: "pass",
  fail: "FAIL",
  unknown: "?   ",
  "not-applicable": "n/a ",
  deferred: "def ",
};

function render(ctx, result) {
  const g = ctx.git;
  console.log(`hstack merge-readiness — ${ctx.changeId}\n`);
  console.log(`  branch:  ${g.branch ?? "(unknown)"}`);
  console.log(`  base:    ${g.base ?? "(unresolved)"}${g.mergeBase ? ` (merge-base ${g.mergeBase.slice(0, 8)})` : ""}`);
  console.log(`  diff:    ${g.available ? `${g.files.length} file(s)` : `unavailable — ${g.error}`}`);
  console.log("");
  for (const r of result.gates) {
    console.log(`  ${r.id}  ${TAG[r.verdict]}  ${r.title}`);
    if (r.detail) console.log(`         ${r.detail}`);
  }
  console.log("");
  const c = result.counts;
  console.log(
    `merge-readiness: ${c.pass} pass, ${c.fail} fail, ${c.unknown} unknown, ` +
      `${c["not-applicable"]} n/a, ${c.deferred} deferred — ` +
      (result.ready ? "READY (advance to `ready-to-ship`)" : "NOT READY"),
  );
  if (!result.ready) {
    const blocking = result.gates.filter((r) => BLOCKING.has(r.verdict)).map((r) => r.id);
    console.log(`  blocking: ${blocking.join(", ")}`);
  }
}

function main(argv) {
  const args = argv.slice(2);
  const opts = { json: false, gates: false, base: null, gatesExit: null, root: null, positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") opts.json = true;
    else if (a === "--gates") opts.gates = true;
    else if (a === "--base") opts.base = args[++i];
    else if (a === "--gates-exit") opts.gatesExit = Number(args[++i]);
    else if (a === "--root") opts.root = args[++i];
    else if (a === "-h" || a === "--help") {
      console.log(usage());
      return 0;
    } else if (a.startsWith("-")) {
      console.error(`compute-merge-readiness: unknown option ${a}\n\n${usage()}`);
      return 2;
    } else opts.positional.push(a);
  }

  if (opts.gates) {
    printGates();
    return 0;
  }
  if (opts.positional.length !== 1) {
    console.error(`compute-merge-readiness: expected exactly one <change-id>\n\n${usage()}`);
    return 2;
  }
  if (opts.gatesExit !== null && !Number.isInteger(opts.gatesExit)) {
    console.error("compute-merge-readiness: --gates-exit takes an integer exit code");
    return 2;
  }

  const found = findHstackRoot(opts.root ?? process.cwd());
  if (!found) {
    console.error(
      "compute-merge-readiness: no hstack/ tree found (looked for hstack/KERNEL.md upward from " +
        (opts.root ?? process.cwd()) +
        "). Pass --root <repo>.",
    );
    return 2;
  }

  const ctx = buildContext(found.repoRoot, found.hstackRoot, opts.positional[0], {
    base: opts.base,
    gatesExit: opts.gatesExit,
  });
  if (ctx.error) {
    console.error(`compute-merge-readiness: ${ctx.error}`);
    return 2;
  }

  const result = score(ctx);
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: result.ready,
          changeId: ctx.changeId,
          branch: ctx.git.branch,
          base: ctx.git.base,
          mergeBase: ctx.git.mergeBase ?? null,
          changedFiles: ctx.git.files,
          gates: result.gates,
          counts: result.counts,
          deferred: DEFERRED_GATES,
        },
        null,
        2,
      ),
    );
  } else {
    render(ctx, result);
  }
  return result.ready ? 0 : 1;
}

// Only run the CLI when invoked directly, so the Skill and the tests can import.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]).endsWith(`${sep}compute-merge-readiness.mjs`);
if (invokedDirectly) {
  process.exit(main(process.argv));
}
