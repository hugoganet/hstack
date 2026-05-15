---
name: hstack-tech-debt-new
description: |
  Use this skill when the engineer needs to capture a tech-debt item — a known compromise the team agreed to live with for now. The Skill orchestrates the `spec-author` subagent through a six-section interview and maintains the reciprocal back-reference between the new tech-debt item and its originating change-spec (TD-01). Examples:

  <example>
  Context: The billing-overage change shipped with a one-off Tailwind class for warning-yellow because the design token isn't yet exposed; the engineer wants to log it.
  user: "/hstack:tech-debt-new --origin 2026-05-billing-overage-warning overage-banner-tailwind-class"
  assistant: "I'll invoke spec-author for the tech-debt interview. The six sections cover Title, Why we took the shortcut, What it costs us, Fix sketch, Pre-conditions for fixing, Acceptance. Reciprocally, I'll add this tech-debt id to the change-spec's creates-tech-debt array."
  <commentary>
  Reciprocity per TD-01 is load-bearing. Without the back-reference, audit queries cannot answer "who put this here?" without grepping every change-spec. The Skill writes both sides via spec-author.
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

2. **Invoke `spec-author`.** Use the Task tool with `subagent_type: spec-author` and context = [kernel, `hstack/templates/tech-debt.md`, glossary, the originating change-spec when `--origin`]. The subagent walks the six sections — Title, Why we took the shortcut, What it costs us, Fix sketch, Pre-conditions for fixing, Acceptance — with confirmation gates.

3. **Severity.** The subagent elicits severity (critical | high | medium | low). For `severity: critical`, a `target-resolve-by` date is required per TD-02 (this is a future field — surface in the conversation that v1 does not yet enforce it via the validator).

4. **Cost and fix-sketch-effort.** Both are controlled enums (`small | medium | large`).

5. **Reciprocity.** When `--origin <change-spec-id>` is set:
   - Write `introduced-by: <change-spec-id>` on the new tech-debt frontmatter (per architecture amendment A6).
   - Append the new tech-debt id to the originating change-spec's `creates-tech-debt` array.
   - Both writes are confirmation-gated; the engineer sees the proposed reciprocal edit before it lands.
   - TD-01 enforces this at validation.

6. **Validate.** Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` — TD-01 (reciprocity), TD-02 (severity:critical requires target-resolve-by — v1 surfaces only), TD-03 (no field rewrites once resolved; v1 informational).

7. **Status.** The new artifact lands at `status: open`. Advancing to `in-progress` or `resolved` is a separate later operation, not this Skill's domain.

## Outputs

- `hstack/tech-debt/TD-NNNN-<slug>.md` at `status: open`.
- When `--origin` is set: an edit to the originating change-spec's `creates-tech-debt` array.

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

- **Reciprocal write to the change-spec fails (e.g., the change-spec's frontmatter is broken).** Halt; the engineer fixes the change-spec first via `spec-author`.
- **The change-spec is at `shipped` or `archived` status.** TD-03 forbids rewrites on resolved items, but the change-spec at `shipped` may still accept `creates-tech-debt` array appends — surface and confirm with the engineer before writing.
- **Validator fails TD-01.** Halt; the engineer reconciles the reciprocity manually if `spec-author`'s write did not land.

## Anti-patterns

- Never invent a tech-debt id. Sequential per the implicit rule.
- Never write a tech-debt item without the Why-we-took-the-shortcut section. Debt without context is paperwork.
- Never write `origin: <change-spec-id>` without the reciprocal `creates-tech-debt` write on that change-spec.
- Never advance status past `open` from this Skill. Status transitions happen on the fix side, not the capture side.
- Never overwrite an existing tech-debt item from this Skill. Updates happen via direct `spec-author` invocation when the item is being actively worked on.
