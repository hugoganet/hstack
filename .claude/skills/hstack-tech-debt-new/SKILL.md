---
name: hstack-tech-debt-new
description: |
  Use this skill when the engineer needs to capture a tech-debt item — a known compromise the team agreed to live with for now. The Skill orchestrates the `spec-author` subagent through a six-section interview for the TD body (genuine open-ended authoring); the reciprocal `creates-tech-debt` write on the originating change-spec is performed by the Skill directly per ADR-0001 (no second spec-author invocation). Both halves of the reciprocal pair (TD-01) land in a single atomic commit; spec-author defers its terminal-state auto-commit when invoked under this Skill so the Skill can include both files in one commit. Examples:

  <example>
  Context: The billing-overage change shipped with a one-off Tailwind class for warning-yellow because the design token isn't yet exposed; the engineer wants to log it.
  user: "/hstack:tech-debt-new --origin 2026-05-billing-overage-warning overage-banner-tailwind-class"
  assistant: "I'll invoke spec-author for the tech-debt interview. The six sections cover Title, Why we took the shortcut, What it costs us, Fix sketch, Pre-conditions for fixing, Acceptance. Reciprocally, I'll add this tech-debt id to the change-spec's creates-tech-debt array."
  <commentary>
  Reciprocity per TD-01 is load-bearing. Without the back-reference, audit queries cannot answer "who put this here?" without grepping every change-spec. Per ADR-0001, the TD body is authored by spec-author (interview) and the reciprocal `creates-tech-debt` write on the change-spec is performed by the Skill directly; both files land in one atomic commit.
  </commentary>
  </example>

  <example>
  Context: The adversarial-reviewer surfaced a deliberate trade-off that should be tracked as tech-debt rather than fixed in the change.
  user: "F-03 routes to tech-debt. /hstack:tech-debt-new --origin 2026-06-knowledge-citations cookie-samesite-attributes"
  assistant: "I'll invoke spec-author. The reciprocal write lands on the change-spec; the adversarial-review's finding gets resolution: tech-debt:<this-td-id> once the artifact is created."
  <commentary>
  This is the routing the adversarial-review's resolution discipline assumes. The tech-debt is created here, then referenced from the adversarial-review's `findings[].resolution`. The Skill is the only path because spec-author owns reciprocal writes.
  </commentary>
  </example>
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - SendMessage
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates tech-debt frontmatter and TD-01..TD-03}}"
---

## Purpose

`hstack-tech-debt-new` captures a tech-debt item via the `spec-author` subagent. Tech-debt artifacts live at `hstack/tech-debt/TD-NNNN-<slug>.md`, are append-only, and maintain a reciprocal back-reference to the originating change-spec via the `introduced-by` ↔ `creates-tech-debt` pair (TD-01).

## When to invoke

Invoke when:
- The engineer ships a deliberate compromise (a hack-now-fix-later) and wants it logged.
- The `adversarial-reviewer` surfaces a finding routed to `tech-debt:<id>` and the artifact does not yet exist.
- A retrospective surfaces accumulated debt that was not captured at the time it landed (origin: `found-later`).

## Inputs

- `<slug>` (required, positional): kebab-case slug. Examples: `overage-banner-tailwind-class`, `stripe-webhook-idempotency-buffer`.
- `--origin <change-spec-id>` (optional): the change-spec that introduced this debt. When set, reciprocal writes apply. When omitted, origin defaults to `found-later`.

## Preconditions

Before any work:

- Verify `hstack/config.yaml` exists at `init-status: complete`.
- Read every existing tech-debt item under `hstack/tech-debt/` to determine the next sequential id.
- Verify the `<slug>` matches `^[a-z][a-z0-9-]*$` and is not already used.
- When `--origin <change-spec-id>` is provided: verify the change-spec exists.
- Scan existing tech-debt for a near-duplicate (same module, similar slug). Surface any candidates to the engineer; if the new debt is genuinely a duplicate, the Skill halts and directs the engineer to update the existing item instead.

## Orchestration steps

1. **Compute the next id.** `TD-NNNN-<slug>`.

2. **Invoke or resume `spec-author` with explicit deferred-commit instruction.** Per the kernel's *Subagent transcript resume* contract (Resumability section), prefer cache-read resume over fresh spawn when a previous `spec-author` session for THIS tech-debt id is still resumable in the current Claude Code session — useful when a six-section interview was interrupted mid-flow.

   - **State file path:** `hstack/.session-state/tech-debt-<id>.yaml` (where `<id>` is the computed `TD-NNNN-<slug>` from step 1). Shape:
     ```yaml
     artifact-type: tech-debt
     artifact-id: <TD-NNNN-<slug>>
     agent-uuid: <agentId returned by Agent(...)>
     last-section-confirmed: <section name or null>
     deferred-commit: true
     last-resume-at: <ISO 8601 timestamp>
     ```
   - **Resume path** — if the state file exists and contains a non-empty `agent-uuid`, call `SendMessage(to: <agent-uuid>, message: <resume-brief>)` where `<resume-brief>` MUST include: (a) an instruction to re-read `hstack/tech-debt/<TD-id>.md` (the partial draft from the prior interview), (b) the first unconfirmed section to resume from (orchestrator computes by inspecting the partial draft), (c) **the deferred-commit instruction restated verbatim**: "do NOT auto-commit at terminal author-state; leave the file staged-but-uncommitted so this Skill can include both halves of the reciprocal pair (TD ↔ change-spec.creates-tech-debt) in a single atomic commit per the kernel's atomicity rule," (d) a reminder that `introduced-by: <change-spec-id>` must be on the frontmatter when `--origin` is set. On `success: true`, the agent resumes — proceed to step 3 and wait for completion. On `success: false` (transcript expired, agent unknown, different Claude Code session), drop through to the spawn path.
   - **Spawn path** — call `Agent(subagent_type: spec-author, prompt: <full session-start brief>)` with context = [kernel, `hstack/templates/tech-debt.md`, glossary, the originating change-spec when `--origin`]. The subagent walks the six sections — Title, Why we took the shortcut, What it costs us, Fix sketch, Pre-conditions for fixing, Acceptance — with confirmation gates. **Critical instruction to spec-author (both paths)**: do NOT auto-commit at terminal author-state (`status: open`) when invoked under `/hstack:tech-debt-new`. The Skill will perform the atomic commit after the reciprocal change-spec write in step 7. Spec-author should leave the new TD file staged-but-uncommitted (or unstaged) so the Skill can include both halves of the reciprocal pair in a single commit. This deviation from spec-author's normal auto-commit-at-status-transition behavior is mandated by the kernel's atomicity rule for reciprocal pairs. On return, capture the `agentId` and **write/overwrite** the state file with `deferred-commit: true` set so any subsequent resume preserves the instruction.
   - **Why the deferred-commit instruction is load-bearing on resume.** If the resume payload omits it, the resumed agent — whose system prompt and original instructions are cached — may fall back to its default auto-commit behavior at terminal status, splitting the reciprocal pair across two commits and breaking TD-01 atomicity. The resume-brief MUST restate the instruction; cached context is not authoritative for per-invocation directives.
   - **Loading discipline (both paths).** The on-disk partial draft is the source of truth, not the agent's working memory. The resumed agent re-reads `hstack/tech-debt/<TD-id>.md` before continuing.

3. **Severity.** The subagent elicits severity (critical | high | medium | low). For `severity: critical`, a `target-resolve-by` date is required per TD-02 (this is a future field — surface in the conversation that v1 does not yet enforce it via the validator).

4. **Cost and fix-sketch-effort.** Both are controlled enums (`small | medium | large`).

5. **Reciprocity.** When `--origin <change-spec-id>` is set:
   - **Authoring half (spec-author).** `spec-author` writes `introduced-by: <change-spec-id>` on the new tech-debt frontmatter during its interview (this field is part of the artifact being authored, so it lands inside the spec-author session). Per the deferred-commit instruction in step 2, spec-author does NOT auto-commit on terminal author-state under this Skill — it leaves the TD file written but uncommitted.
   - **Reciprocal half (direct write by this Skill).** After `spec-author` finishes the interview and returns, this Skill performs the reciprocal write itself via the `Edit` tool — no second `spec-author` invocation. Edit `hstack/specs/changes/<change-spec-id>/spec.md`:
     - Append the new tech-debt id to the frontmatter `creates-tech-debt` array (idempotent — if already present, no-op).
     - Update frontmatter `updated: <today>`.
   - Per the kernel's Mechanical operations section, this reciprocal write is mechanical: the value to append is fully determined by the just-authored TD's id. No interview is required.
   - TD-01 enforces this at validation. Both files land in a single auto-commit (step 7 below) so the reciprocal pair is atomic.

6. **Proposed-diff preview (confirmation gate).** Per the kernel's AI-writes-humans-confirm contract for mechanical operations, print the proposed reciprocal-write diff (the `creates-tech-debt` array append on the change-spec, the `updated` bump) and ask "Proceed with these writes? (Y/n)". Default Yes. On `n`, halt without staging the change-spec edit; the TD file remains unstaged so the engineer can `git checkout -- <td-file>` to discard.

7. **Validate and atomic-commit both files.** Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the new TD and (when `--origin` is set) the modified change-spec. TD-01 (reciprocity), TD-02 (severity:critical requires target-resolve-by — v1 surfaces only), TD-03 (no field rewrites once resolved; v1 informational) all checked. On validation pass, `git add` both files and commit with message `tech-debt(TD-NNNN): open` (with `(introduced-by: <change-spec-id>)` appended when applicable). The reciprocal pair (TD `introduced-by` ↔ change-spec `creates-tech-debt`) lands in this single atomic commit. On validation failure, halt; both files remain unstaged for the engineer to inspect or discard.

8. **Status note.** The new artifact lands at `status: open`. Advancing to `in-progress` or `resolved` is a separate later operation, not this Skill's domain.

## Outputs

- `hstack/tech-debt/TD-NNNN-<slug>.md` at `status: open`.
- When `--origin` is set: an edit to the originating change-spec's `creates-tech-debt` array.

The tech-debt item lands at `status: open`. To begin resolution work, invoke `/hstack:tech-debt-resolve TD-NNNN`. To close without a fix, invoke `/hstack:tech-debt-wontfix TD-NNNN`. The new fields `resolved-by`, `resolution-attempted-at`, `wontfix-reason`, `wontfix-accepted-alternative` are left as their template defaults (`null`) at creation time — they are written by the corresponding resolution Skill.

## Auto-commit triggers

- One commit at terminal author-state (`status: open`). When reciprocity writes are involved, both files are included in the commit. Commit message: `tech-debt(TD-NNNN): open` (with the origin change-spec in parentheses when applicable).

## Idempotency contract

- Re-running with the same `<slug>` halts because the slug would not be unique.
- Re-running mid-interview after a halt: `spec-author` reads the partial tech-debt file and resumes.
- Reciprocal writes are idempotent: if the change-spec's `creates-tech-debt` already contains the tech-debt id, the Skill does not duplicate.

## Stop conditions

Beyond the kernel's general stop conditions:

- The `<slug>` collides with an existing tech-debt item.
- `--origin` references a change-spec that does not exist.
- A near-duplicate tech-debt item already exists and the engineer should update it instead.
- The Why-we-took-the-shortcut field is empty — every tech-debt item must explain its origin, not just enumerate the cost.

## Failure modes

- **Reciprocal write to the change-spec fails (e.g., the change-spec's frontmatter is broken).** Halt before commit; the TD authoring half also rolls back unstaged. The engineer fixes the change-spec frontmatter manually (broken YAML is hand-fixed and validated; if the change-spec body needs prose authoring corrections, `spec-author` can resume the change-spec since change-spec body editing is interview-driven, but `spec-author` cannot touch the `creates-tech-debt` reciprocal field per kernel — the Skill performs that append on the re-run). Then re-run `/hstack:tech-debt-new` — the Skill is idempotent on the TD half (spec-author resumes the existing partial file) and idempotent on the reciprocal append (a no-op if the TD id is already in the array).
- **The change-spec is at `shipped` or `archived` status.** TD-03 forbids rewrites on resolved items, but the change-spec at `shipped` may still accept `creates-tech-debt` array appends — surface and confirm with the engineer before writing.
- **Validator fails TD-01.** Halt before commit; the partial state on disk is unstaged. The engineer reconciles by running the Skill again — the reciprocal half is idempotent and the TD half resumes from the existing file.

## Anti-patterns

- Never invent a tech-debt id. Sequential per the implicit rule.
- Never write a tech-debt item without the Why-we-took-the-shortcut section. Debt without context is paperwork.
- Never write `origin: <change-spec-id>` without the reciprocal `creates-tech-debt` write on that change-spec.
- Never advance status past `open` from this Skill. Status transitions happen on the fix side, not the capture side.
- Never overwrite an existing tech-debt item from this Skill. Updates happen via direct `spec-author` invocation when the item is being actively worked on.
