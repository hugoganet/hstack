---
name: hstack-adr-new
description: |
  Use this skill when the engineer needs to capture a new Architecture Decision Record in Michael Nygard format. The Skill orchestrates the `spec-author` subagent through a conversational interview that walks the six Nygard sections, applies the Consequences challenge prompt, and writes the next sequential `ADR-NNNN-<slug>.md`. Examples:

  <example>
  Context: The team has decided to use pgvector instead of Pinecone for embedding storage and wants the decision logged.
  user: "/hstack:adr-new pgvector-over-pinecone"
  assistant: "I'll invoke spec-author for the ADR interview. Six Nygard sections — Title, Status, Context, Decision, Consequences, Alternatives Considered. The Consequences challenge prompt will probe for two consequences that look bad."
  <commentary>
  ADRs are append-only and sequential. The Skill reads the highest existing ADR-NNNN and increments. The Consequences challenge is mandatory because under-stating the trade-offs is the predictable failure mode of design decisions.
  </commentary>
  </example>

  <example>
  Context: A research session reached a decision point and the engineer is promoting it to an ADR via `/hstack:research --promote`.
  user: "Promote research session 2026-05-orchestration-patterns to an ADR."
  assistant: "The promotion routes through /hstack:adr-new. spec-author receives the research findings as the Context section seed and walks the remaining Nygard sections via interview."
  <commentary>
  Promotion routing is the explicit pattern from the architecture: `researcher` does not write ADRs directly; it hands off to `spec-author` via `hstack-adr-new` so the conversational interview pattern and the Consequences challenge prompt are preserved.
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
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates ADR frontmatter and AD-01..AD-04}}"
---

## Purpose

`hstack-adr-new` captures a new ADR via the `spec-author` subagent. ADRs live at `hstack/adr/ADR-NNNN-<slug>.md`, are append-only, and use Michael Nygard's six-section format. The Skill is the cross-cutting capture point: it is invoked directly by the engineer when a decision warrants the record, or indirectly by `hstack-research --promote` when a research session is being elevated.

## When to invoke

Invoke when the engineer wants to capture a new architectural decision. Common triggers: a non-obvious technology choice, a deliberate trade-off the team wants to remember, a constraint imposed from outside the team (legal, ops, compliance), supersession of a prior ADR.

## Inputs

- `<slug>` (required, positional): kebab-case slug for the ADR. Examples: `pgvector-over-pinecone`, `trigger-dev-v4-only`, `per-tenant-encryption-keys`.
- `--supersedes <ADR-NNNN>` (optional): id of the ADR being superseded. The Skill enforces reciprocity per AD-02.
- `--from-research <session-id>` (optional): set when invoked via `hstack-research --promote`. The named research session is seeded into the Context section.
- `--from-kernel-fit <finding-id>` (optional): set when invoked via `hstack-kernel-fit-promote`. The named kernel-fit finding's Evidence + Kernel surface + Proposed direction are seeded into the Context section, and the new ADR's `promoted-from-kernel-fit` frontmatter array is populated with the finding id (reciprocal with `kernel-fit-finding.promoted-to`; KF-04). The finding's Counter-explanations section is NOT seeded — the engineer's Decision must engage fresh with the kernel-change question.

## Preconditions

Before any work:

- Verify `hstack/config.yaml` exists at `init-status: complete`.
- Read every existing ADR under `hstack/adr/` to determine the next sequential id (highest existing `ADR-NNNN` + 1). Per AD-01, ids are sequential with no gaps.
- Verify the `<slug>` matches `^[a-z][a-z0-9-]*$` and is not already used in any existing ADR id.
- When `--supersedes` is provided: verify the referenced ADR exists at `status: accepted`.
- When `--from-research` is provided: verify the research session file exists at `hstack/research/sessions/<session-id>.md`.
- When `--from-kernel-fit` is provided: verify the finding file exists at `hstack/kernel-fit/findings/<finding-id>*.md` and is at `status: open` or `acknowledged`.

## Orchestration steps

1. **Compute the next id.** `ADR-NNNN-<slug>` where `NNNN` is the next sequential number, zero-padded to four digits.

2. **Invoke `spec-author`.** Use the Task tool with `subagent_type: spec-author` and context = [kernel, `hstack/templates/adr.md`, glossary, tech-stack, `hstack/context/roadmap.md` when present, the superseded ADR when `--supersedes`, the research session when `--from-research`, the kernel-fit finding when `--from-kernel-fit` (Evidence + Kernel surface + Proposed direction extracted as Context seed; Counter-explanations excluded)]. The subagent walks the six Nygard sections plus the Forecloses / Enables section.

3. **Interview discipline.** Per the `spec-author` contract:
   - Title — short noun phrase. One field, one confirmation.
   - Status — proposed at first write; will advance to accepted at end of interview when the engineer confirms.
   - Context — 2–4 paragraphs. When seeded from research, the engineer reviews and corrects.
   - Decision — one paragraph, stated as an active sentence.
   - Consequences — 2–4 paragraphs, exercised via the challenge prompt: "Name two consequences that look bad. If you can't, what alternative would have made them visible?"
   - Alternatives Considered — one paragraph per alternative.
   - Forecloses / Enables — one line each against the roadmap's Next/Later horizons: what does this decision make more expensive, what does it make cheaper? "None" is a valid, confirmable answer. When `roadmap.md` is missing, not `current`, or `updated` > 90 days, write `n/a — roadmap stale/missing` — advisory only, never a reason to halt or reject the ADR.

4. **Supersession reciprocity.** When `--supersedes` is set, `spec-author` writes `superseded-by: <new-adr-id>` on the prior ADR and `supersedes: <prior-adr-id>` on the new one. AD-02 enforces reciprocity.

   **Kernel-fit reciprocity.** When `--from-kernel-fit` is set, `spec-author` writes `promoted-from-kernel-fit: [<finding-id>]` on the new ADR. The reciprocal write on the finding (`promoted-to: adr:<new-adr-id>` plus the status flip to `promoted`) is performed by `/hstack:kernel-fit-promote` after this Skill returns, in a separate commit (the recoverable two-commit carve-out documented in that Skill's Failure modes — analogous to the `/hstack:finalize` in-progress carve-out).

5. **Validate.** Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` — AD-01 (sequential id), AD-02 (reciprocal supersession), AD-03 (fixed section structure), AD-04 (`superseded` requires `superseded-by`).

6. **Status transition.** When every section is confirmed and the validator passes, `spec-author` advances `status` from `proposed` to `accepted`. The engineer can override to keep `proposed` if the decision is still under discussion.

7. **Frontmatter related fields.** `spec-author` populates `related-change-specs` (if the engineer names any) and `related-modules` based on the conversation.

## Outputs

- `hstack/adr/ADR-NNNN-<slug>.md` at `status: accepted` (or `proposed`).
- When superseding: an edit to the prior ADR's frontmatter to set `status: superseded` and `superseded-by`.

## Auto-commit triggers

- Status transition to `proposed` after the first sections land.
- Status transition to `accepted` at end of interview. Commit message: `adr(<adr-id>): accepted` (or `proposed`).
- Edits to `supersedes` / `superseded-by` reciprocally (one commit covering both files).

## Idempotency contract

- Re-running with the same `<slug>` halts because the slug would not be unique.
- Re-running mid-interview after a halt: `spec-author` reads the partial ADR and resumes at the next un-confirmed section.

## Stop conditions

Beyond the kernel's general stop conditions:

- The `<slug>` collides with an existing ADR.
- A `--supersedes` target does not exist at `status: accepted`.
- A `--from-research` session does not exist on disk.
- A `--from-kernel-fit` finding does not exist on disk or is at a status other than `open` / `acknowledged`.
- The Consequences challenge prompt cannot produce two consequences that look bad; the engineer either thinks harder or accepts that this might not be ADR-worthy after all.

## Failure modes

- **ADR id sequence has a gap (e.g., ADR-0001, ADR-0003 with no ADR-0002).** AD-01 fails on the existing set, not the new write. Surface as a pre-existing problem and halt; the engineer reconciles before authoring a new ADR.
- **Validator fails AD-03 because the section structure deviates.** The subagent re-runs the missing section.
- **Engineer wants to keep the ADR at `proposed` and circulate.** Honor — `spec-author` writes the file at `proposed` and the auto-commit fires. Advancing to `accepted` later is a separate edit.

## Anti-patterns

- Never invent or reuse an ADR id. Sequential and immutable per AD-01.
- Never skip the Consequences challenge prompt. Under-stated trade-offs are the predictable ADR failure mode.
- Never write `status: accepted` without the engineer's confirmation.
- Never write supersession in one direction only. Reciprocity per AD-02 is mandatory.
- Never paraphrase research findings into the Context section without the engineer's review. The promotion path runs through `spec-author`'s confirmation gates.
- Never modify an `accepted` ADR's body. ADRs are append-only; updates happen by superseding with a new ADR.
