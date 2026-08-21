---
name: hstack-tech-debt-new
description: Use to capture a new tech-debt item — a compromise the team is agreeing to live with for now — with its reciprocal back-reference on the originating change-spec. Capture only; the three closure paths are separate Skills.
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "node hstack/scripts/validate-spec.mjs — validates tech-debt frontmatter and TD-01..TD-03"
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

2. **Invoke `spec-author` with explicit deferred-commit instruction.** Use the Task tool with `subagent_type: spec-author` and context = [kernel, `hstack/templates/tech-debt.md`, glossary, the originating change-spec when `--origin`]. The subagent walks the six sections — Title, Why we took the shortcut, What it costs us, Fix sketch, Pre-conditions for fixing, Acceptance — with confirmation gates. **Critical instruction to spec-author**: do NOT auto-commit at terminal author-state (`status: open`) when invoked under `/hstack:tech-debt-new`. The Skill will perform the atomic commit after the reciprocal change-spec write in step 7. Spec-author should leave the new TD file staged-but-uncommitted (or unstaged) so the Skill can include both halves of the reciprocal pair in a single commit. This deviation from spec-author's normal auto-commit-at-status-transition behavior is mandated by the kernel's atomicity rule for reciprocal pairs.

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

7. **Validate and atomic-commit both files.** Run `node hstack/scripts/validate-spec.mjs <path>` against the new TD and (when `--origin` is set) the modified change-spec. TD-01 (reciprocity), TD-02 (severity:critical requires target-resolve-by — v1 surfaces only), TD-03 (no field rewrites once resolved; v1 informational) all checked. On validation pass, `git add` both files and commit with message `tech-debt(TD-NNNN): open` (with `(introduced-by: <change-spec-id>)` appended when applicable). The reciprocal pair (TD `introduced-by` ↔ change-spec `creates-tech-debt`) lands in this single atomic commit. On validation failure, halt; both files remain unstaged for the engineer to inspect or discard.

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
