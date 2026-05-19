---
hstack-version: v0.1.0
authority: kernel
---

# hstack — Kernel (CLAUDE.md)

This file is the kernel of the hstack engineering workflow. When a Claude Code session, Skill, or subagent operates under hstack, this file is the contract.

**In any conflict between this kernel and another document — the architecture doc, a template schema, an ADR, any source — this kernel wins.** Other documents extend the kernel; they do not override it. If the kernel is wrong, fix the kernel first and propagate downstream.

---

## What hstack is

hstack is a spec-driven engineering workflow that ships as Claude Code Skills and subagents, configurable per repo. It governs how engineers and AI agents collaborate on a codebase from change inception through merge: scoping, gating, artifact production, multi-tenant safety, audit, reviewability.

What hstack is not: a methodology framework like BMAD or Spec Kit (we adopted patterns; we are not those frameworks); a project tracker (artifacts in the repo are the tracker); a deployment system (deploys happen outside hstack); or a SOC 2 / GDPR compliance substrate by itself (v1 is good engineering hygiene; v2 covers compliance).

Operating under hstack means every change goes through the workflow, every artifact lives under `hstack/`, every status transition is written by a subagent and auto-committed, every Skill loads its required product context at session start, and the human's job is to answer questions and confirm — not to write.

---

## Scope rules

Every change-spec at `hstack/specs/changes/<id>/spec.md` declares an **In-Scope** file allowlist and an **Out-of-Scope** list. The `implementer` subagent must obey them:

- **Writes are restricted to In-Scope only.** Refuse to write or modify any file not in the In-Scope list.
- **Reads are permitted for the canonical session-start context loads (see the Product context section) plus the In-Scope list.** Reading outside this combined set is prohibited; if additional reads are required, halt and request a scope amendment.
- Refuse to drop, weaken, or modify any invariant declared in the spec's Invariants section.
- If scope expansion is necessary, halt and emit a scope-amendment request rather than acting unilaterally. The engineer updates the spec, the implementer re-loads it, execution resumes.

CI enforces the write boundary at PR time. Files modified outside In-Scope block the merge.

---

## Test immutability

Once a test file exists in the working tree (committed or staged), **no hstack subagent may edit or delete it without per-test, per-conversation human authorization.** This rule exists because the dominant failure mode of LLM-driven implementation is the model editing an assertion or deleting a test to make the suite go green, rather than fixing the code under test. The rule is load-bearing and not negotiable by any individual subagent.

**What counts as a test.** Files matching the consuming repo's test patterns declared in `hstack/context/ci-cd.md` (e.g., `*.test.ts`, `*.spec.ts`, `__tests__/**/*`, `e2e/**/*`, `*_test.go`), snapshot files (`__snapshots__/*`), and assertion-bearing fixture files (factories and seed data that encode expected outputs).

**Authorization protocol.** When a subagent determines an existing test must change:

1. **Halt before editing.** The subagent does not modify the test file.
2. **Surface the request.** State (a) the test file and the test name, (b) the reason the test must change (what the test currently asserts vs. what is now correct, with evidence), (c) the proposed change as a precise diff or description, (d) the alternatives — fix the code under test instead, amend the test-plan via `test-strategist`, file a tech-debt item, or close the test as obsolete.
3. **Wait for the canonical phrase.** The human authorizes by typing one of:
   - `Ok to change test <name>` — for assertion or logic changes inside an existing test.
   - `Ok to delete test <name>` — for test removal, including consolidations and refactors that move tests.
   - `Ok to update snapshot <name>` — for snapshot file updates. Required per-snapshot. `--update-snapshots` and equivalent bulk-update flags are forbidden.
   - `Ok to refresh fixture <name>` — for assertion-bearing fixture data (e.g., a date-sensitive expected output that requires rebaselining).
   `<name>` is either the file path or a uniquely-identifying test name. The subagent echoes the phrase back verbatim before acting to confirm scope.
4. **Echo in the audit trail.** When the change lands, the subagent records the authorization in (a) the commit message body and (b) the relevant artifact — `verification.md` Discrepancies for verifier-time discoveries, `plan.md` per-phase footnote for implementer-time changes, `adversarial-review.md` Resolution Log for review-time changes.
5. **Single-use.** Authorization covers the specific test and the specific change discussed in the current conversation. A second edit to the same test, or a follow-up change beyond what was discussed, requires fresh authorization. Authorization does not carry across sessions.

**Carve-outs.**

- **New tests are allowed without authorization.** The implementer writes the tests named in the test-plan as part of normal phase execution. "New" means the test path did not exist in the working tree at session start.
- **A test-file move that preserves content exactly** (rename / relocation as part of an in-scope refactor) is permitted without authorization, but the subagent surfaces the move in its commit message so an adversarial-reviewer can verify no content drifted.
- **Test data refresh** for date-sensitive or environment-sensitive fixtures uses the `Ok to refresh fixture` phrase rather than `change test`. Same authorization discipline, different semantics — refresh acknowledges the test's contract is intact but the input changed.

**Forbidden no matter what.**

- Blanket authorizations ("go ahead and fix any failing tests", "update whatever snapshots need it"). Authorizations are per-test, per-conversation. The subagent refuses blanket scope.
- Bulk snapshot updates via `--update-snapshots`, `jest --updateSnapshot`, `vitest -u`, or any equivalent flag, including in pre-commit hooks.
- Relaxing an assertion without authorization (e.g., tightening a regex to a substring match, broadening a `.toBe()` to `.toContain()`, increasing a timeout to mask a real bug).
- Deleting a `.skip` annotation, replacing a `test()` call with `test.todo()`, or otherwise neutralizing a test without authorization. Neutralization is a form of deletion.
- Editing a test as part of "cleaning up" a phase without an explicit authorization for that test, even if the edit is cosmetic.

**Enforcers.** The implementer is the primary enforcer because it is the only subagent that writes code. The verifier reinforces by refusing to record a `passed` status when its diff-vs-prior-run check shows a test file modified mid-run. The adversarial-reviewer makes "test modified without authorization echo in the conversation or commit" a hard finding under spec-compliance. The test-strategist, in test-plan refresh mode, treats existing test files as read-only — when a refresh would require modifying an existing test, the strategist halts and routes the request through the authorization protocol or files a tech-debt item.

---

## Tech-debt resolution

Tech-debt items are first-class artifacts with their own lifecycle (`open → in-progress → resolved`, or `open → wontfix`). Resolution is **not manual** — the workflow drives every transition through dedicated Skills, with reciprocal frontmatter linkage between the tech-debt and the change-spec that fixes it.

**Reciprocity.** Tech-debt resolution is symmetric with tech-debt creation:

- Creation: `tech-debt.introduced-by` ↔ `change-spec.creates-tech-debt`. Enforced by TD-01. Written by `spec-author` via `/hstack:tech-debt-new`.
- Resolution: `tech-debt.resolved-by` ↔ `change-spec.resolves-tech-debt`. Enforced by TD-04. Written by `spec-author` via `/hstack:tech-debt-resolve` (status flip to `in-progress`) and `/hstack:finalize` (status flip to `resolved`).

Both halves of each pair are written together by `spec-author`; the validator refuses one-sided writes.

**Resolution flow.**

1. **Pick the item.** Run `/hstack:tech-debt-resolve TD-NNNN`.
2. **Pre-conditions check.** The Skill prints the TD's full body and walks each "Pre-conditions for fixing" bullet for engineer confirmation. Any unmet pre-condition halts the Skill with the recommended remediation (wait for ADR, resolve dependent TD, etc.). Pre-conditions are prose in v1; the Skill cannot mechanically verify them, so engineer confirmation is mandatory and is logged into the resulting change-spec.
3. **Status flip + scaffold.** `spec-author` flips the TD `open → in-progress`, sets `resolution-attempted-at` to today, appends a Resolution Log entry, and scaffolds a resolution change folder with `resolves-tech-debt: [TD-NNNN]` pre-populated. The change-spec's "Resolves Tech-Debt" section quotes the TD's Acceptance section verbatim; the engineer's Target Behavior must satisfy that quote (superset or exact).
4. **Run the normal workflow.** test-plan → security-review → data-review (when `db` in surfaces) → plan → implement → verify → adversarial-review. The adversarial-reviewer reads each referenced TD's Acceptance section and produces a mandatory Acceptance-satisfied confirmation (AR-07) when `resolves-tech-debt` is non-empty.
5. **Ship.** `/hstack:ship` checks GT-11: every referenced TD must be at `in-progress` and the adversarial-review must contain the Acceptance-satisfied confirmation. Ship stays read-only.
6. **Finalize after merge.** `/hstack:finalize <change-id>` is the post-merge cleanup Skill. It verifies the change's branch has been merged into the configured default branch (git log check), then invokes `spec-author` to:
   - Advance the change-spec `ready-to-ship → shipped`.
   - For each entry in `resolves-tech-debt`: write `resolved-by: <change-spec-id>`, append a Resolution Log entry, and flip status `in-progress → resolved`. Per TD-03, no further field rewrites are permitted on the tech-debt after this point.

**The wontfix path.** When a tech-debt item is being closed without a fix (the team has decided the cost of fixing exceeds the cost of living with it), use `/hstack:tech-debt-wontfix TD-NNNN`. The Skill runs a two-question interview: "Why won't this be fixed?" and "What are we accepting as the alternative?" Both answers are required and become non-null `wontfix-reason` and `wontfix-accepted-alternative` frontmatter fields (TD-06). `spec-author` writes both fields and flips status `open → wontfix` in a single auto-commit. Wontfix is terminal and immutable per TD-03.

**Partial resolution is not supported in v1.** A change-spec either fully resolves a tech-debt item (listed in `resolves-tech-debt`, satisfies the Acceptance bullets) or it doesn't. If a change addresses only some of the TD's Acceptance bullets, it stays off the `resolves-tech-debt` list and the TD remains at `in-progress` for a follow-up change. This preserves the kernel's "one change-spec, one bounded contract" discipline. Engineers tempted to split a TD into smaller pieces should instead author multiple TDs via `/hstack:tech-debt-new`.

**Forbidden no matter what.**

- Manually editing tech-debt `status`, `resolved-by`, `wontfix-reason`, or `resolution-attempted-at` in frontmatter outside of the resolution Skills. The status machine is owned by `spec-author` via the three Skills (`tech-debt-resolve`, `tech-debt-wontfix`, `finalize`).
- Marking a tech-debt `resolved` without a corresponding change-spec at `shipped` whose `resolves-tech-debt` references it. The reciprocal write is the only legal path.
- Skipping the adversarial-review Acceptance-satisfied confirmation when `resolves-tech-debt` is non-empty. AR-07 makes this a mandatory finding lens.
- Editing fields on a `resolved` or `wontfix` tech-debt. TD-03 forbids this; the validator compares against git history.

---

## Frontmatter contract

Every artifact under `hstack/specs/`, `hstack/context/`, `hstack/adr/`, `hstack/tech-debt/`, and `hstack/research/promoted/` carries YAML frontmatter. The shared floor every artifact must include:

```yaml
---
id: <kebab-case slug, immutable>
type: <controlled enum — see template schemas>
status: <controlled enum per type>
owner: <engineer responsible>
created: <ISO 8601 date>
updated: <ISO 8601 date>
---
```

Per-type fields extend this floor. The full per-type schema is authoritative in the template schemas doc: https://www.notion.so/361d6791656c8178bbbbc812fa6426e0. The kernel does not duplicate per-template detail.

Naming rules: `id` is kebab-case and immutable once written; dates are ISO 8601; controlled enums are case-sensitive; arrays are YAML arrays, never comma-separated strings.

---

## Status lifecycle

Status transitions are written by subagents, not humans. Each subagent updates the status field at phase completion as part of its workflow. The engineer never writes status manually.

Two rules:

- **Auto-commit at status transition.** Every time a subagent moves an artifact's status to a new value, the change is git-committed to the active working branch. This produces the audit trail and provides the resumability checkpoint.
- **Upstream must be terminal before downstream advances.** A change-spec reaches `ready-for-implementation` only when test-plan, plan, security-review, data-review (when applicable), and ui-brief / figma-handoff (when applicable) are at correct terminal states. The test-plan is itself upstream of the plan — the `planner` refuses to start until `test-plan.md` is at `passed` or `concerns-acknowledged`. The transition gate is computed from artifact statuses, not asserted by an agent.

Per-type lifecycles live in the template schemas doc.

---

## Resumability

A crashed or interrupted session must lose at most one in-flight field of work.

- **Incremental writes.** Every confirmed field writes to disk immediately. Subagents never batch a long interview and write at the end.
- **Idempotency.** Every Skill is idempotent in the LLM-agent sense: re-running a Skill reads current disk state, recognizes completed phases, and produces a no-op diff for them.
- **Session state.** Long-running interviews persist their state at `hstack/.session-state/<session-id>.yaml`. This directory is git-ignored.
- **Auto-commit at status transitions.** Every phase boundary auto-commits. Worst-case loss between Skill invocations is the work in the active turn.

Claude Code's native conversation persistence (under `~/.claude/projects/`) is the floor underneath.

---

## AI writes, humans confirm

Almost every hstack artifact is produced by a subagent through a conversational interview. The human's role is to answer questions and confirm fields, not to write.

- Subagents **never** write a field silently. Every artifact field passes through an explicit confirmation gate before disk write.
- For low-stakes templates (story, ui-brief, vision, glossary, mvp-scope, persona, tech-debt) the interview is confirmation-driven: the agent proposes, the human accepts or revises.
- For high-stakes templates (security-review, data-review, adversarial-review, threat-model) the templates carry **challenge prompts** that probe for omissions — what the human did not think to mention. This is the v1 mitigation for the known asymmetry that humans miss what's missing. v2 moves the challenge logic into subagent prompts.

---

## Authoring and review never share a session

The `implementer` and the `adversarial-reviewer` must run in separate Claude Code sessions. The implementer's working memory, scratchpad, and conversation are not loaded into the adversarial-reviewer's session.

This is honor-system in v1. The v2 substrate adds session-id verification at the CI gate. Until then, the engineer is responsible for opening a fresh session before running `/hstack:adversarial-review`.

---

## Multi-module changes

One module per change-spec. A change that meaningfully touches more than one module splits into multiple change-specs, each scoped to a single module, linked via a `parent-change` frontmatter field.

The parent change-spec is a coordination artifact — no plan, no security-review, no implementer of its own. Each child runs the workflow independently. The parent reaches `shipped` only when every child has shipped.

Never let a single change-spec span modules. The implementer's scope-lock and the adversarial-reviewer's findings quota both stop working when In-Scope spans subsystems.

---

## Trivial changes

Some changes are too small to justify the full workflow: a typo fix, a comment edit, a dependency version bump where no functional surface changes. These bypass spec-presence and scope-completeness gates via the `trivial` PR tag.

A change qualifies as trivial only when **all** of the following hold: zero new functionality, zero behavior change, zero new files, no security-sensitive surface touched (no agent code, no auth code, no pgvector calls, no tool boundaries), no migration. If any of these fails, the change runs the full workflow.

The `trivial` tag is an escape hatch, not a release valve. Misuse is grounds for revert and re-shipping through the full workflow.

---

## Branch hygiene

Every per-change workflow Skill assumes one branch per change-spec, named `change/<change-id>`, branching from `main`. The convention is enforced at exactly two moments and surfaced (without enforcement) at a third:

- **Offered at `/hstack:change-new`.** When the change-id becomes known, the Skill offers to create `change/<change-id>` from the current branch and check out before the scaffold auto-commits. Default Yes; the engineer can decline or supply a different branch name.
- **Enforced at `/hstack:implement`.** Hard halt on `main` (or the configured default branch) for any change not carrying `trivial: true`. The kernel's database-workflow and forbidden-tools rules already forbid committing real work to `main`; this is the workflow-level corollary.
- **Surfaced at `/hstack:help`.** When a non-trivial in-flight change-spec exists but the current branch is `main` (or any branch other than the expected `change/<change-id>`), the situation report flags the mismatch.

Other workflow Skills (`change-plan`, `ui-brief`, `security-review`, `data-review`, `verify`, `adversarial-review`) tolerate any branch. Their artifacts live under `hstack/specs/changes/<id>/` and are git-cherry-pickable if they land on the wrong branch — recoverable, not load-bearing.

`/hstack:branch <change-id>` is the explicit mid-flow switch command for when the engineer realizes they're on the wrong branch already. Honors the same convention.

Trivial changes (`trivial: true`) bypass branch hygiene and may commit directly on `main`, per the existing trivial-changes carve-out.

---

## v1 / v2 split

hstack v1 is good engineering hygiene. v1 does not by itself deliver SOC 2 or GDPR posture. The architecture document's v2 roadmap names the substrate work required before hstack-governed code can defensibly carry a production-grade label: executable security tests, audit-architecture spec, tool-call and MCP blast-radius controls, MCP hard-fail on load-bearing dependencies, session-id verification, and more.

Subagents and Skills in v1 must not falsely assert v2 guarantees. The `security-reviewer` produces a structured judgment, not an executable test result. The `test-strategist` produces strategic judgment about test layering, edge cases, and coverage gaps — not coverage-measured or mutation-tested evidence; v2 substrate wires coverage instrumentation, mutation testing, and benchmark-asserted performance budgets. The agent ledger is useful telemetry, not defensible audit evidence. Frame outputs accordingly.

---

## Product context

The product context layer lives at `hstack/context/`:

- `vision.md` — what the product is, what it does, what it is not.
- `glossary.md` — terms with non-obvious meaning.
- `mvp-scope.md` — in MVP, in v2, deferred.
- `personas/` — one file per persona, or one row per persona in the configured store.
- `data-architecture.md` — data model, schema, RAG architecture, embedding strategy.
- `tech-stack.md` — canonical languages, frameworks, libraries.
- `ci-cd.md` — CI/CD setup of the consuming repo.
- `infrastructure.md` — operational truth: hosting, networking, secrets, environments, deploy pipeline, observability, cost, disaster recovery, blast-radius matrix, access control, compliance posture, third-party dependencies. Truth-gathering, not policy — `threat-model.md` and `hardening-checklist.md` carry the policy and score against this file.
- `threat-model.md` — threats per attack surface, with mitigations.
- `hardening-checklist.md` — scored items per stack layer.
- `incident-runbook.md` — kill switches, revocation flows, comms templates.

Load-at-session-start rules by subagent:

- `product-manager`: vision, personas, mvp-scope, glossary.
- `spec-author`: glossary, tech-stack, the relevant module-spec.
- `test-strategist`: change-spec, module-spec, tech-stack, ci-cd, data-architecture (when surfaces includes db), existing test files within in-scope.
- `planner`: change-spec, test-plan, ui-brief, figma-handoff, data-review (when present).
- `ui-ux-briefer`: configured design system docs, change-spec, linked stories.
- `security-reviewer`: threat-model, hardening-checklist, tech-stack, ci-cd, infrastructure.
- `data-specialist`: data-architecture, tech-stack, ci-cd, infrastructure, current schema (via MCP).
- `implementer`: change-spec, plan, test-plan, security-review, data-review and ui-brief and figma-handoff when present, tech-stack, infrastructure (when surfaces includes infra).
- `verifier`: change-spec, plan, test-plan, ci-cd.
- `adversarial-reviewer`: all change artifacts (including test-plan); explicitly no implementer transcripts.
- `researcher`: query context plus relevant product-context docs as the query requires.

A subagent that cannot reach a required context document halts and asks the human, rather than proceeding without it.

**Promotion routing.** When the `researcher` promotes a research session into an ADR or a tech-debt item, it does so by handing off to `spec-author`, not by writing the ADR or tech-debt file directly. This preserves the conversational interview pattern that those templates depend on — challenge prompts for ADR consequences, reciprocity for tech-debt origin. Promotion into `hstack/research/promoted/` for durable notes (not ADRs or tech-debt) can be done by the researcher directly, since those are free-form reference artifacts.

---

## Templates

Templates live at `hstack/templates/`. Each template file is the canonical source for that artifact type. Subagents fill templates; they do not invent structure ad hoc.

Per-template detail — required fields, section structure, length norms, validation rules, status transitions, dependencies — lives in the template schemas doc: https://www.notion.so/361d6791656c8178bbbbc812fa6426e0. Read it before any template instance is authored.

---

## Stop conditions

A Skill or subagent must halt and ask the human when:

- A change-spec has empty Invariants or empty Scope Boundaries.
- A required upstream artifact is missing or not at terminal status.
- A load-bearing MCP is unreachable. Do not silently fall back to stale documents.
- A modification outside the In-Scope file list is needed.
- A `service_role` Supabase key, raw shell, or other forbidden tool would be used.
- An MCP server with write capability is wired against a project tagged `production` in `infrastructure.md`'s MCP Access Policy and is not inside its named change-window (INF-04). Halt and surface — even if the immediate operation would only read.
- A write-capable MCP tool is active in the same session as a query that would return user-generated content from a tenant-scoped table (INF-05). The prompt-injection mitigation is load-bearing; the session must split or the MCP must be disabled before the read.
- A status transition is requested but the upstream gate computation does not permit it.
- The agent is asked to write a field for which the human has not provided an answer.

Halting is not failure. It is the correct response when preconditions are not met.

---

## No parallel tracker

Frontmatter is the state machine. Status, ownership, lifecycle position, dependencies — every load-bearing fact about an artifact lives in its frontmatter on disk. If a question can be answered by reading an artifact, the answer comes from the artifact, never from a separate dashboard, in-memory state, or external tracker.

Notion holds product context and decisions; it does not hold operational state. The repo holds operational state; it does not hold strategic context. The split is load-bearing.

---

## References

- Architecture document (long-form companion): https://www.notion.so/360d6791656c813d955af822cb8814d1
- Template schemas and frontmatter contracts: https://www.notion.so/361d6791656c8178bbbbc812fa6426e0
- Adversarial review of the architecture: https://www.notion.so/361d6791656c81f78eb3c97ba4aecbb4
