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

Operating under hstack means every change goes through the workflow, every artifact lives under `hstack/`, every status transition is written by a subagent (for interview-driven authoring) or by a Skill running in the main session (for mechanical operations — see the Mechanical operations section) and auto-committed, every Skill loads its required product context at session start, and the human's job is to answer questions and confirm — not to write.

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

Tech-debt items are first-class artifacts with their own lifecycle. Three terminal exit paths exist:

- `open → in-progress → resolved` — the team fixed the underlying problem via a shipped change-spec.
- `open → wontfix` — the team decided not to fix; the original claim is still observably true but the cost-benefit no longer warrants resolution.
- `open → stale-no-longer-reproducible` — the original claim has aged out before anyone resolved it. The surrounding code was rewritten, the dependency was upgraded, the bug was fixed incidentally as part of unrelated work, or the system the TD described no longer exists. The team verifies the absence and closes the TD without it ever entering `in-progress`.

Resolution is **not manual** — the workflow drives every transition through dedicated Skills, with reciprocal frontmatter linkage between the tech-debt and the change-spec that fixes it (when applicable).

**Reciprocity.** Tech-debt resolution is symmetric with tech-debt creation:

- Creation: `tech-debt.introduced-by` ↔ `change-spec.creates-tech-debt`. Enforced by TD-01. The TD body (including `introduced-by`) is authored by `spec-author` via `/hstack:tech-debt-new`; the reciprocal `creates-tech-debt` write on the originating change-spec is performed by the Skill directly per the Mechanical operations section.
- Resolution: `tech-debt.resolved-by` ↔ `change-spec.resolves-tech-debt`. Enforced by TD-04. Both halves are written by Skills directly: `/hstack:tech-debt-resolve` sets `resolves-tech-debt: [TD-NNNN]` on the new change-spec when scaffolding (status flip on the TD to `in-progress`); `/hstack:finalize` writes `resolved-by` on the TD and flips its status to `resolved`.

Both halves of each pair land in the same auto-commit; the validator refuses one-sided writes.

**Resolution flow.**

1. **Pick the item.** Run `/hstack:tech-debt-resolve TD-NNNN`.
2. **Pre-conditions check.** The Skill prints the TD's full body and walks each "Pre-conditions for fixing" bullet for engineer confirmation. Any unmet pre-condition halts the Skill with the recommended remediation (wait for ADR, resolve dependent TD, etc.). Pre-conditions are prose in v1; the Skill cannot mechanically verify them, so engineer confirmation is mandatory and is logged into the resulting change-spec.
3. **Status flip + scaffold.** The Skill flips the TD `open → in-progress` directly, sets `resolution-attempted-at` to today, appends a Resolution Log entry, and scaffolds a resolution change folder with `resolves-tech-debt: [TD-NNNN]` pre-populated. The change-spec's "Resolves Tech-Debt" section quotes the TD's Acceptance section verbatim; the engineer's Target Behavior must satisfy that quote (superset or exact). Both writes (TD frontmatter and new change-spec frontmatter) land in a single auto-commit so the reciprocal pair is atomic.
4. **Run the normal workflow.** test-plan → security-review → data-review (when `db` in surfaces) → plan → implement → verify → adversarial-review. The adversarial-reviewer reads each referenced TD's Acceptance section and produces a mandatory Acceptance-satisfied confirmation (AR-07) when `resolves-tech-debt` is non-empty.
5. **Ship.** `/hstack:ship` checks GT-11: every referenced TD must be at `in-progress` and the adversarial-review must contain the Acceptance-satisfied confirmation. Ship stays read-only.
6. **Finalize after merge.** `/hstack:finalize <change-id>` is the post-merge cleanup Skill. It verifies the change's branch has been merged into the configured default branch (git log check), then writes directly (per the Mechanical operations section, no `spec-author` invocation):
   - For each entry in `resolves-tech-debt`, in order: write `resolved-by: <change-spec-id>`, append a Resolution Log entry, flip status `in-progress → resolved`. Validate and auto-commit each TD as it lands.
   - Only after every TD resolution has succeeded: advance the change-spec `ready-to-ship → shipped`. This ordering ensures a mid-finalize failure leaves the change-spec at `ready-to-ship` (recoverable by re-running finalize), never at `shipped` referencing an unresolved TD.
   - Per TD-03, no further field rewrites are permitted on the tech-debt after this point.

**The wontfix path.** When a tech-debt item is being closed without a fix (the team has decided the cost of fixing exceeds the cost of living with it), use `/hstack:tech-debt-wontfix TD-NNNN`. The Skill runs a two-question interview: "Why won't this be fixed?" and "What are we accepting as the alternative?" Both answers are required and become non-null `wontfix-reason` and `wontfix-accepted-alternative` frontmatter fields (TD-06). The Skill writes both fields and flips status `open → wontfix` directly in a single auto-commit. Wontfix is terminal and immutable per TD-03.

**The stale-no-longer-reproducible path.** When a tech-debt item's original claim has aged out — the surrounding code was rewritten, the dependency was upgraded, the bug was fixed incidentally, the system the TD described no longer exists — use `/hstack:tech-debt-stale TD-NNNN`. This is distinct from `wontfix`: `wontfix` says "the problem is still real but we choose to live with it"; stale-no-longer-reproducible says "the problem no longer exists, verifiably." Misusing `wontfix` for a stale claim corrupts the audit signal that distinguishes deliberate-deferral from organic-decay.

The Skill runs a one-question structured-elicitation loop: "What evidence shows this TD's claim no longer reproduces?" The engineer's answer becomes the non-null `stale-verification-method` field (TD-07); the current date becomes `stale-verified-at`. The Skill writes both fields and flips status `open → stale-no-longer-reproducible` directly in a single auto-commit. The new status is terminal and immutable per TD-03.

**Partial resolution is not supported in v1.** A change-spec either fully resolves a tech-debt item (listed in `resolves-tech-debt`, satisfies the Acceptance bullets) or it doesn't. If a change addresses only some of the TD's Acceptance bullets, it stays off the `resolves-tech-debt` list and the TD remains at `in-progress` for a follow-up change. This preserves the kernel's "one change-spec, one bounded contract" discipline. Engineers tempted to split a TD into smaller pieces should instead author multiple TDs via `/hstack:tech-debt-new`.

**Forbidden no matter what.**

- Manually editing tech-debt `status`, `resolved-by`, `wontfix-reason`, `wontfix-accepted-alternative`, `stale-verified-at`, `stale-verification-method`, or `resolution-attempted-at` in frontmatter outside of the resolution Skills. The status machine is owned by the four Skills (`tech-debt-resolve`, `tech-debt-wontfix`, `tech-debt-stale`, `finalize`) which perform the writes directly per the Mechanical operations section.
- Invoking `spec-author` for any of these mechanical writes. The cost is ~25k tokens per call for what is a handful of frontmatter character changes; the kernel's Mechanical operations section forbids it.
- Marking a tech-debt `resolved` without a corresponding change-spec at `shipped` whose `resolves-tech-debt` references it. The reciprocal write is the only legal path. *Exception*: during a single `/hstack:finalize` invocation, the TDs are flipped to `resolved` first and the change-spec advances to `shipped` last; this is the documented finalize-in-progress carve-out (see Mechanical operations § Atomicity for reciprocal pairs). The standing-state rule applies once finalize completes; the transient state during a single invocation is intentional and recoverable by re-running finalize.
- Skipping the adversarial-review Acceptance-satisfied confirmation when `resolves-tech-debt` is non-empty. AR-07 makes this a mandatory finding lens.
- Editing fields on a `resolved`, `wontfix`, or `stale-no-longer-reproducible` tech-debt. TD-03 forbids this; the validator compares against git history.

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

**Change-spec carries an optional `revisits-change` array.** When a new change-spec is filed to fix a defect, regression, or missed adversarial-review finding from a prior shipped change, the engineer populates `revisits-change: [<predecessor-change-id>]` so post-merge defect correlation is computable (`/hstack:telemetry` § QO-6 when promoted from watch-list to dashboard). Default empty. The field is informational, not gating — no Skill refuses to advance because the array is empty or non-empty.

---

## Status lifecycle

Status transitions are written by hstack itself, not by direct human edits to frontmatter. Two legitimate writer-of-record paths exist:

- **Subagents** write status transitions at the end of their interview phases (e.g., `test-strategist` advances `test-plan.md` to `passed` when its work completes; `security-reviewer` advances `security-review.md`).
- **Skills** write status transitions for mechanical operations per the Mechanical operations section below. The orchestrating Skill running in the main Claude Code session performs the `Edit` directly, runs `validate-spec.ts`, and auto-commits. `/hstack:verify` (change-spec `ready-for-implementation → ready-for-review` when `verification.md` lands at `passed`, per ADR-0002), `/hstack:adversarial-review` (change-spec `ready-for-review → ready-to-ship` when `adversarial-review.md` lands at `findings-resolved`, per ADR-0002 follow-up), `/hstack:finalize`, `/hstack:tech-debt-resolve`, and `/hstack:tech-debt-wontfix` follow this path.

The engineer never writes status manually via direct frontmatter edit.

Two rules:

- **Auto-commit at status transition.** Every time a subagent or Skill moves an artifact's status to a new value, the change is git-committed to the active working branch. This produces the audit trail and provides the resumability checkpoint.
- **Upstream must be terminal before downstream advances.** A change-spec reaches `ready-for-implementation` only when test-plan, plan, security-review, data-review (when applicable), and ui-brief / figma-handoff (when applicable) are at correct terminal states. The test-plan is itself upstream of the plan — the `planner` refuses to start until `test-plan.md` is at `passed` or `concerns-acknowledged`. The transition gate is computed from artifact statuses, not asserted by an agent.

Per-type lifecycles live in the template schemas doc.

---

## Resumability

A crashed or interrupted session must lose at most one in-flight field of work.

- **Incremental writes.** Every confirmed field writes to disk immediately. Subagents never batch a long interview and write at the end.
- **Idempotency.** Every Skill is idempotent in the LLM-agent sense: re-running a Skill reads current disk state, recognizes completed phases, and produces a no-op diff for them.
- **Session state.** Long-running interviews persist their state at `hstack/.session-state/<session-id>.yaml`. This directory is git-ignored.
- **Subagent transcript resume.** Claude Code can resume a previously spawned subagent by passing its `agentId` UUID to `SendMessage`; the harness replays the on-disk transcript with cache-read pricing on the prefix. This is a harness feature, not an hstack contract — Skills do not need to encode an explicit resume-or-spawn protocol, and CC handles it opportunistically when the conversation calls for it. The `name:` Agent parameter is a separate in-memory-only alias that clears when the spawned process returns; it is not useful for cross-invocation resume. If a future incident shows native resume bypassing a load-bearing invariant (e.g., the deferred-commit instruction for `/hstack:tech-debt-new`, the test-immutability protocol, the Consequences challenge for ADRs), the failing Skill adds an explicit resume-payload restatement of that invariant — driven by evidence, not anticipation.
- **Auto-commit at status transitions.** Every phase boundary auto-commits. Worst-case loss between Skill invocations is the work in the active turn.

Claude Code's native conversation persistence (under `~/.claude/projects/`) is the floor underneath.

---

## AI writes, humans confirm

Almost every hstack artifact is produced by a subagent through a conversational interview. The human's role is to answer questions and confirm fields, not to write.

- Subagents **never** write a field silently. Every artifact field passes through an explicit confirmation gate before disk write.
- For low-stakes templates (story, ui-brief, vision, glossary, mvp-scope, persona, tech-debt) the interview is confirmation-driven: the agent proposes, the human accepts or revises.
- For high-stakes templates (security-review, data-review, adversarial-review, threat-model) the templates carry **challenge prompts** that probe for omissions — what the human did not think to mention. This is the v1 mitigation for the known asymmetry that humans miss what's missing. v2 moves the challenge logic into subagent prompts.

**Mechanical operations adapt this contract.** Mechanical writes (per the Mechanical operations section below) do not have field-level interviews because the values are determined by the Skill's preconditions, the engineer's invocation arguments, or a structured-elicitation loop (per-question confirmation, see the Mechanical operations section). The "confirm before write" gate is preserved at the **Skill-invocation level**: before performing the writes, the Skill prints the **proposed diff** (the actual file changes that will be staged) and a Y/n prompt. A precise per-field summary is NOT a sufficient substitute — until `validate-spec.ts` ships as a real script (it is currently a `{{TODO-SCRIPT}}` placeholder), the proposed-diff preview is the only mechanical contract check between the Edit and the auto-commit; the engineer must see exactly what will land. The v1 mitigations are (a) the proposed-diff preview, (b) the precondition checks each Skill performs before any write, (c) idempotency on re-run, and (d) `validate-spec.ts` post-write *once it exists*. Subagent invocations remain field-level confirmation-gated as before. Structured-elicitation loops (Pre-conditions walks, wontfix-reason elicitation) are per-question confirmation-gated by their own y/n prompts; they do NOT replace the final proposed-diff preview before commit.

---

## Mechanical operations

Subagents are expensive. Each fresh subagent invocation pays the cost of its system prompt plus its session-start context loads — typically 15-25k tokens before any work begins. For interview-driven authoring, that cost is appropriate: the subagent is doing genuine judgment work that benefits from full context. For **frontmatter-only mechanical operations**, it is pure overhead.

The kernel rule reading: *"spec-author is the only **subagent** permitted to write under `hstack/specs/`, `hstack/adr/`, and `hstack/tech-debt/`."* The Skill orchestrator running in the main Claude Code session is not a subagent. Skills are therefore permitted to perform mechanical frontmatter writes directly, without invoking a subagent. ADR-0001 documents the decision.

**What counts as a mechanical operation.** Operations where no open-ended interview is required — values are determined by the Skill's preconditions, the engineer's invocation arguments, or a structured-elicitation loop with a fixed question set and bounded answer shape:

- **Status flips** — advancing an artifact's `status` field along the lifecycle. The engineer's invocation of the Skill (and any acknowledgement gate the Skill carries) is the confirmation.
- **Reciprocal writes** — when an artifact's frontmatter contains a back-reference to another artifact (e.g. `tech-debt.introduced-by` ↔ `change-spec.creates-tech-debt`, `tech-debt.resolved-by` ↔ `change-spec.resolves-tech-debt`, `ADR.supersedes` ↔ `ADR.superseded-by`), the second half is determined entirely by the first and the validator enforces both.
- **Resolution Log appends** — a single bounded prose block appended at a known transition (TD `open → in-progress`, `open → wontfix`, `in-progress → resolved`). The prose template is fixed; no field-level interview.
- **Frontmatter date bumps** — `updated:` to today on every write.
- **Structured-elicitation loops** — pre-defined finite question sets where the Skill prompts and the engineer answers with a bounded shape (e.g. y/n + one-sentence justification; one-sentence answer ≤ N characters). The output structure is fixed by the Skill, not authored open-endedly. Examples: `/hstack:tech-debt-resolve` Pre-conditions walk (per bullet: y/n + justification, persisted as `(bullet, met, justification)` triples into the resulting change-spec's Open Questions); `/hstack:tech-debt-wontfix` two-question interview (wontfix-reason ≤ 200 chars, wontfix-accepted-alternative ≤ 200 chars); `/hstack:tech-debt-stale` one-question interview (stale-verification-method ≤ 300 chars). The constraint that makes these mechanical rather than authoring: the Skill cannot expand the loop into free-form prose generation, and each prompt is a per-question confirmation gate (the engineer's answer IS the confirmation). Open-ended prose authoring (change-spec Problem, Invariants; module-spec sections; ADR Context/Decision/Consequences; tech-debt Why/Cost/Fix-sketch/Acceptance) is NOT in this category — those remain with `spec-author`.

**Skills that perform mechanical writes directly:**

- `/hstack:change-new` — scaffolds `spec.md` from template (precedent).
- `/hstack:verify` — change-spec `ready-for-implementation → ready-for-review` when `verification.md` lands at `passed` (per ADR-0002). The `verifier` subagent retains its mechanical-verification lane and writes only `verification.md`; the Skill orchestrator performs the cross-artifact change-spec advance directly via `Edit` after the subagent returns.
- `/hstack:adversarial-review` — change-spec `ready-for-review → ready-to-ship` when `adversarial-review.md` lands at `findings-resolved` (per ADR-0002 follow-up). The `adversarial-reviewer` subagent retains its critique-only lane and writes only `adversarial-review.md`; the Skill orchestrator performs the cross-artifact change-spec advance directly via `Edit` after the subagent returns. This migration replaces the prior inline-subagent-write pattern with the Skill-owned pattern ADR-0002 codified, saving ~25k subagent-context tokens per change.
- `/hstack:finalize` — change-spec `ready-to-ship → shipped`; per-TD `resolved-by` write + status flip + Resolution Log append.
- `/hstack:tech-debt-resolve` — TD `open → in-progress`; `resolution-attempted-at` write; Resolution Log append; resolution change-spec scaffold with reciprocal `resolves-tech-debt` pre-population.
- `/hstack:tech-debt-wontfix` — TD `open → wontfix`; `wontfix-reason` and `wontfix-accepted-alternative` writes; Resolution Log append.
- `/hstack:tech-debt-stale` — TD `open → stale-no-longer-reproducible`; `stale-verified-at` and `stale-verification-method` writes; Resolution Log append.
- `/hstack:tech-debt-new` — reciprocal `creates-tech-debt` write on the originating change-spec after `spec-author` finishes the TD authoring interview.

**Discipline preserved.** Skills doing direct writes still honor:

- **`validate-spec.ts` after every write** — frontmatter schema and reciprocity rules (TD-01, TD-04, ADR supersession) caught at write time. **v1 honesty note**: `hstack/scripts/validate-spec.ts` is currently a `{{TODO-SCRIPT}}` placeholder. Until it ships, the proposed-diff preview before each commit (see AI writes / humans confirm § Mechanical operations adapt this contract) is the only mechanical contract check; the validator-after-every-write language describes the target state, not v1 enforcement. Validator implementation is tracked as the blocker-priority follow-up in ADR-0001.
- **Auto-commit at every status transition** — the audit trail is identical to subagent-driven commits.
- **Atomicity for reciprocal pairs** — both halves of a reciprocal write land in the same commit; partial writes are not permitted. *Carve-out for finalize-in-progress*: when `/hstack:finalize` resolves multiple TDs, the change-spec advances to `shipped` only after every TD has landed. During the window between the first TD's `resolved` commit and the change-spec's `shipped` commit, on-disk state shows TDs at `resolved` while the change-spec is still at `ready-to-ship` — this is intentional and recoverable. The Forbidden-no-matter-what bullet "Never flip a tech-debt to resolved without an accompanying change-spec at shipped" applies to **standing** state (post-finalize), not the transient window during a single finalize invocation.
- **Idempotency** — re-running a Skill detects already-landed transitions and produces no-ops for them.
- **Telemetry sidecars (when emitted) ride the same commit.** Five Skills (`hstack-test-plan`, `hstack-implement`, `hstack-verify`, `hstack-adversarial-review`, `hstack-finalize`) write a small JSON sidecar to `hstack/specs/changes/<id>/.telemetry/<skill>-<event>.json` at the same `git add && git commit` as their canonical artifact write. The sidecar is **derivative** of git + frontmatter — re-runnable from source, never authoritative. The kernel's "no parallel tracker" rule is preserved by this derivative property. `.telemetry/` is git-ignored in the consuming repo; the sidecar is a cache, not a source. Schema and rules live in `hstack/templates/telemetry-sidecar.md`. The five emissions cover the full per-change lifecycle's high-signal events: test discipline up front, scope-locked per-phase execution, promised-vs-observed verification, gate-firing critique, lifecycle close. The other 22 Skills do not emit sidecars in v1; adding a sixth is a follow-up change-spec, not a unilateral Skill edit.

**Anti-patterns specific to mechanical operations:**

- Never invoke `spec-author` for a status flip, reciprocal write, or Resolution Log append. The cost is ~25k tokens per call for what is two-to-four character changes.
- Never let a Skill skip `validate-spec.ts` after a direct write *once the validator ships*. While the validator is a `{{TODO-SCRIPT}}` placeholder, the proposed-diff preview before commit is the v1 substitute and Skills must surface it.
- Never split a reciprocal pair across two commits *outside the finalize-in-progress carve-out above*. Atomicity is the v1 audit-trail guarantee for `<artifact-X>.<field> ↔ <artifact-Y>.<field>` consistency.

**Spec-author retains exclusive ownership of:**

- Authoring interviews — change-spec, module-spec, ADR, tech-debt, infrastructure, incident-runbook (the first creation of any of these).
- Field-level revisions that require human-confirmed prose — Open Questions edits, Invariant additions mid-flight, ADR Consequences elaboration.
- Any write to a field whose value is not determined by the Skill's preconditions alone.

The boundary is: **if the Skill knows the value to write before invoking, the Skill writes directly. If the value comes from a conversation with the engineer, spec-author runs the conversation.**

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
- `kernel-fit-analyst`: hstack/CLAUDE.md (the artifact under analysis), the latest hstack/telemetry/reports/<date>.md, every prior finding at hstack/kernel-fit/findings/, all change-specs at status: shipped (full bodies), all ADRs, all tech-debt, all module-specs; explicitly no implementer transcripts and no scratchpads from in-flight authoring sessions.
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

### Halt sentinel

When a Skill or subagent halts at any of the stop conditions above, it emits one line into its conversation output:

```
HSTACK-HALT: reason=<enum>
```

Where `<enum>` is one of: `scope-amendment | upstream-non-terminal | mcp-unreachable | forbidden-tool | test-immutability-protocol | missing-context | ambiguous-spec | environment-misconfig | branch-mismatch | other`.

The sentinel is a single line, costs zero LLM tokens to emit, and makes post-hoc halt-frequency analysis cheap (see `/hstack:telemetry` § WS-6). The sentinel is appended to the auto-commit body when a halt coincides with a status-flip commit; otherwise it appears in the conversation alone (the telemetry parser reads both transcript text and commit bodies). Halting still includes the prose explanation of the situation — the sentinel does not replace the human-readable reason, it complements it.

---

## No parallel tracker

Frontmatter is the state machine. Status, ownership, lifecycle position, dependencies — every load-bearing fact about an artifact lives in its frontmatter on disk. If a question can be answered by reading an artifact, the answer comes from the artifact, never from a separate dashboard, in-memory state, or external tracker.

Notion holds product context and decisions; it does not hold operational state. The repo holds operational state; it does not hold strategic context. The split is load-bearing.

---

## Consuming-repo wiring

Consuming repos that wire hstack via symlinks (the recommended pattern in `README.md`) have a maintenance contract that the kernel surfaces here so any session adding or removing a Skill or subagent is reminded.

- **New Skill added under `.claude/skills/hstack-<name>/`.** Each consuming repo that uses the per-skill symlink pattern must also create a corresponding symlink at `<consumer-root>/.claude/skills/hstack-<name>` pointing at `../../hstack/.claude/skills/hstack-<name>`. The symlink change lands in the same PR that adds the Skill.
- **Skill removed.** Each consuming repo's matching symlink is removed in the same PR. Orphan symlinks are silent failures.
- **Skill renamed.** Treat as removal + addition in both source and consumer.
- **New subagent added under `.claude/agents/<name>.md`.** No consumer-side action when the consuming repo's `.claude/agents/` is a dir-level symlink (the recommended pattern). The new file appears automatically.
- **Subagent removed.** Same — no consumer-side action under the dir-level symlink pattern.
- **Copy-based consumers.** Consuming repos that copied `.claude/` instead of symlinking must mirror every add / remove / rename. The drift cost is the point of recommending symlinks; this rule is the fallback path.

When this kernel is loaded in a session that is adding or removing a Skill or subagent, the session is responsible for surfacing the consumer-wiring step before committing. See `README.md` § Maintenance for exact commands.

---

## How hstack improves itself

hstack ships a closed-loop system for detecting when the kernel itself — this file, the templates, the validators, the Skill flows — is misaligned with how engineers and AI agents actually use it. The loop has five layers and one non-negotiable contract: **the human gates promotion to a kernel change.** Detection and synthesis can be automated; the decision to amend the kernel cannot.

- **Detection is post-hoc and derivative.** `hstack/scripts/telemetry/insights/kernel_fit.py` pattern-matches across shipped change-specs, ADRs, tech-debt, halt sentinels, and adversarial-review findings. Every detection is reconstructible from git + frontmatter; the no-parallel-tracker rule is preserved because the detector reads, never writes.

- **Synthesis is delegated to the `kernel-fit-analyst` subagent.** Model `opus`, loads the kernel and all shipped artifacts and every prior finding, explicitly *not* implementer transcripts (same session-isolation rule as `adversarial-reviewer`). The analyst produces one finding file per pattern at `hstack/kernel-fit/findings/KF-NNNN-<slug>.md`, with a mandatory two-bullet counter-explanation challenge prompt that defends against false-positives. Findings carry a `confidence` enum and a `status` lifecycle (`open → acknowledged → promoted` for actionable findings; `open → dismissed` for non-actionable; `open → superseded` for restated findings).

- **Three Skills drive the lifecycle.** `/hstack:kernel-fit-scan` runs detection + synthesis + Slack nudge. `/hstack:kernel-fit-triage <id> --action acknowledge|dismiss --reason <text>` is a mechanical status flip per ADR-0001. `/hstack:kernel-fit-promote <id> --slug <adr-slug>` routes to `/hstack:adr-new --from-kernel-fit <id>`, mirroring the `--from-research` pattern already in use by `/hstack:research --promote`. The ADR's Context section is seeded from the finding's Evidence + Kernel Surface + Proposed Direction; `spec-author` runs the normal Nygard interview — this is the human gate. The reciprocal `promoted-to` write on the finding lands atomically with the ADR commit per the kernel's reciprocal-pair atomicity rule.

- **Notification is best-effort via Slack MCP.** Threshold-gated (notify on `high` and `medium` confidence only; `low` lands silently on disk) and de-duplicated (no re-notification on an open pattern within a 14-day window). Graceful degradation: if the Slack MCP is unreachable or unwired, findings still land on disk; the Skill logs to stderr and exits 0. This is a deliberate carve-out from the kernel's general MCP-unreachable stop condition — the disk write is load-bearing, Slack is a side-channel pointer, not authoritative state.

- **The analyst never writes ADRs, change-specs, or edits existing findings** (one carve-out: it may set `status: superseded` on a prior finding when restating it more cleanly). Promotion is engineer-initiated and routes through the established authoring Skills. Auto-creation of ADRs is forbidden — the kernel's "AI writes, humans confirm" contract applies most forcefully at the kernel-modification layer, where the cost of a bad ADR cascades through every subsequent change.

The loop is the smallest expression of the kernel reasoning about itself without auto-modifying itself. v1 honesty: the analyst's output is an LLM-strategized judgment, not measured truth; the counter-explanation challenge is the false-positive mitigation. Same framing rule as `test-strategist` and `security-reviewer`. See ADR-0003 for the rationale; see `template/templates/kernel-fit-finding.md` for the artifact schema.

---

## References

- Architecture document (long-form companion): https://www.notion.so/360d6791656c813d955af822cb8814d1
- Template schemas and frontmatter contracts: https://www.notion.so/361d6791656c8178bbbbc812fa6426e0
- Adversarial review of the architecture: https://www.notion.so/361d6791656c81f78eb3c97ba4aecbb4
