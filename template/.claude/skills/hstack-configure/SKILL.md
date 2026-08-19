---
name: hstack-configure
description: Use to edit a `hstack/config.yaml` field after init has completed, re-run the interview for one product-context document, or migrate artifacts when an hstack release bumps the schema-version. Never bootstraps from nothing.
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates frontmatter after every migration write}}"
  - "{{TODO-SCRIPT: hstack/scripts/migrate-schema.ts — applies declarative migration steps between schema-version values}}"
---

## Purpose

`hstack-configure` is the post-init editor of `hstack/config.yaml` and the product-context layer. It runs in three modes: edit a single config field, re-run the interview for a single product-context document via `--interview <doc-name>`, or migrate every artifact's `schema-version` via `--migrate` when an hstack upgrade introduces a structural change. It does not bootstrap from nothing (that is `hstack-init`'s role) and does not write per-change artifacts.

## When to invoke

Invoke when the engineer wants to change a config field after init has completed, refresh a single context document (e.g., quarterly threat-model review), wire up a previously-absent MCP, or migrate after an hstack release bumps `schemaVersion`. If init has not completed, halt and direct the engineer to `hstack-init`.

## Inputs

- `--interview <doc-name>` (optional): re-run the conversational interview for one of `vision`, `glossary`, `roadmap`, `personas`, `data-architecture`, `tech-stack`, `ci-cd`, `infrastructure`, `threat-model`, `hardening-checklist`, `incident-runbook`.
- `--migrate` (optional): detect the gap between `hstack/config.yaml`'s `schemaVersion` and the version declared by the current hstack release, and apply the declarative migration steps.
- No flag: open an interactive config editor that walks the engineer through `hstack/config.yaml` field by field, confirming or correcting each.

`--interview` and `--migrate` are mutually exclusive.

## Preconditions

Before any work:

- Verify `hstack/config.yaml` exists and contains a valid `init-status: complete` value. If init has not completed, halt and surface the message to run `hstack-init` first.
- Read `hstack/KERNEL.md` (kernel) and `hstack/templates/`.
- For `--interview <doc-name>`: verify the named document template exists under `hstack/templates/` and the corresponding instance exists under `hstack/context/`. Read the existing instance's current state to seed the interview.
- For `--migrate`: read the current `hstack/config.yaml schemaVersion` and the target version declared by the installed hstack release. If they match, halt with a "no migration needed" message.

## Orchestration steps

### Edit-config mode (no flag)

1. Read `hstack/config.yaml` and walk every field with the engineer using the `product-manager` subagent via Task. For each field, the subagent proposes the current value, the engineer accepts or corrects, the subagent writes the field to disk immediately.
2. For fields with downstream effects (e.g., changing the configured story store), emit an explicit warning naming the affected workflow Skills before writing.
3. On completion, commit. Update `hstack/config.yaml`'s `updated` field.

### `--interview <doc-name>` mode

1. Read the existing `hstack/context/<doc-name>.md`.
2. Invoke the doc's canonical author via Task with `subagent_type` set per the routing table below. Context = [kernel, template, existing instance]. The subagent walks the document's fields, treating the existing values as the proposal layer and the engineer's responses as accept-or-correct. The routing must match the authoring agent used by `hstack-init` for the same document — same author at init time and at refresh time, different cadence:
   - `vision`, `glossary`, `roadmap`, `personas`, `data-architecture`, `tech-stack`, `ci-cd` → `product-manager`.
   - `infrastructure`, `incident-runbook` → `spec-author`.
   - `threat-model`, `hardening-checklist` → `security-reviewer`.
3. Updated document is written incrementally per the kernel's per-field write rule. Status moves to `drafted` if it had been `current`, then back to `current` at the end. Prompt source-cleanup per the subagent's contract.
4. Commit.

### `--migrate` mode

1. Read `hstack/scripts/migrate-schema.ts` (or its current location) for the declarative migration steps between the current and target `schemaVersion`. Each step names: which artifact types it touches, which frontmatter fields it adds/renames/removes, and any prose-section structural changes.
2. Run a dry-run scan over `hstack/` and produce a written migration plan that lists every artifact file the migration would touch and the specific edits per file. Present the plan to the engineer for confirmation.
3. On confirmation, execute the migration step by step. After each artifact file is edited, run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against it; if validation fails, halt and surface the failure rather than continuing.
4. Update `hstack/config.yaml`'s `schemaVersion` to the target value on a successful migration. Commit.

For destructive or ambiguous migrations (renames of frontmatter fields, status enum changes), the Skill presents each ambiguity to the engineer rather than guessing.

## Outputs

- Edits to `hstack/config.yaml` (any mode).
- Edits to one `hstack/context/<doc-name>.md` (`--interview` mode).
- Edits to many artifact files under `hstack/specs/`, `hstack/context/`, `hstack/adr/`, `hstack/tech-debt/` (`--migrate` mode).
- An optional migration log file at `hstack/.migrations/<from>-to-<to>.md` capturing the dry-run plan and per-file outcomes.

## Auto-commit triggers

- End of edit-config interview: one commit summarizing the edited fields.
- End of `--interview <doc-name>` session: status transition back to `current` triggers a commit.
- End of successful `--migrate`: one commit per migrated artifact (so a partial migration is partly reversible), plus a final commit advancing `schemaVersion`.

## Idempotency contract

- Re-running edit-config mode is safe; the Skill reads current values, walks every field, and produces a no-op commit when the engineer accepts all current values unchanged.
- Re-running `--interview <doc-name>` is safe; the existing instance is the proposal layer, identical re-confirmation is a no-op.
- Re-running `--migrate` after a successful migration is a no-op; the version check at the start short-circuits. Re-running `--migrate` mid-migration (after a halt) resumes by reading the migration log file and processing the next un-migrated artifact.

## Stop conditions

Beyond the kernel's general stop conditions:

- A `--migrate` step would touch an artifact whose current frontmatter does not match the source `schemaVersion`. Halt and ask; do not migrate inconsistent state.
- A `--interview` document is referenced by an in-flight change-spec at a non-terminal status. The Skill warns about cascade effects but proceeds on engineer confirmation; the cascade is the engineer's call.
- A config field change would invalidate existing artifacts (e.g., removing a module from the module-to-area mapping when change-specs still reference it). Halt and surface the affected files.

## Failure modes

- **`migrate-schema.ts` absent or malformed.** Halt and surface as a hstack installation issue.
- **Validator failure on a migrated artifact.** Halt the migration; previous artifacts are already committed and represent a stable partial state.
- **Subagent halts mid-interview.** Persist current state; partial fields are already written per the kernel's incremental-write rule.

## Anti-patterns

- Never silently advance `schemaVersion` without a corresponding migration run.
- Never write context document content without invoking `product-manager`. This Skill orchestrates; it does not author.
- Never edit per-change artifacts (specs, plans, reviews) from this Skill. Those belong to their authoring subagents.
- Never apply a `--migrate` plan without the engineer's explicit confirmation of the dry-run output.
- Never re-run `hstack-init` semantics from this Skill. If the engineer wants to start over, they delete and re-init explicitly.
