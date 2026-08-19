---
name: hstack-story-draft
description: "Use when a user-facing change needs a story drafted or refined against an existing persona. Conditional — skipped when the parent change-spec is `internal-tooling: true` or has a non-empty `enables` array."
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "{{TODO-MCP: Notion MCP — required when configured story store is Notion}}"
  - "{{TODO-MCP: Linear MCP — required when configured story store is Linear}}"
  - "{{TODO-MCP: GitHub MCP — required when configured story store is GitHub Issues}}"
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates story frontmatter and ST-01/ST-02/ST-03}}"
---

## Purpose

`hstack-story-draft` produces or refines one user story by orchestrating the `product-manager` subagent. It maintains the reciprocal `user-stories` ↔ `linked-change-specs` linkage between the story and its parent change-spec. It is conditional — skipped automatically for changes marked Category A (`internal-tooling: true`) or Category B (`enables` non-empty). For Category B, the user value lives in the downstream change-spec(s) named in `enables`; the story (if any) is drafted against that downstream spec, not this one.

## When to invoke

Invoke when the engineer wants a story for a user-facing change before SP-09 / GT-08 require it, or to refine an existing story whose fields the team is reworking. Run after `hstack-change-new` so the parent change-spec already exists and can receive the reciprocal link.

## Inputs

- `--change <id>` (optional): the parent change-spec id. If omitted, the Skill asks the engineer interactively.
- `--story <id>` (optional): an existing story id to refine. If omitted, the Skill drafts a new story.
- `--persona <id>` (optional): the persona to anchor on. If omitted, `product-manager` interviews the engineer for the anchor.

## Preconditions

Before any work:

- Verify `hstack/config.yaml` exists at `init-status: complete`.
- Verify the parent change-spec exists when `--change` is provided or when context implies it.
- Verify `hstack/context/personas/` (or the configured personas store) contains at least one persona at `status: current`.
- Verify the configured story store's MCP is reachable when the store is Notion / Linear / GitHub. If unreachable, halt — the kernel forbids silent fallback to a different store.
- If the parent change-spec carries `internal-tooling: true`, halt and surface: "Story not required — change is Category A (internal tooling, never on a user path)."
- If the parent change-spec carries `enables` non-empty, halt and surface: "Story not required — change is Category B (foundational prerequisite; user value lives in <enables-ids>). Draft a story against the downstream spec instead."
- If the parent change-spec carries BOTH `internal-tooling: true` AND `enables` non-empty, halt with SP-13 violation: "Categories A and B are mutually exclusive. Pick one via `spec-author`."
- Read `hstack/context/vision.md`, `roadmap.md`, and the personas index (required by `product-manager`'s session-start protocol).

## Orchestration steps

1. **Determine mode.** Draft a new story (no `--story` argument) or refine an existing one (`--story <id>` argument). Read the existing story when refining.

2. **Invoke `product-manager`.** Use the Task tool with `subagent_type: product-manager` and context = [kernel, `hstack/templates/story.md`, vision, roadmap, personas store, parent change-spec when known, existing story when refining]. The subagent runs the five-section interview — Who and Why, What Shipping Looks Like, Success Metric, Edge Cases the User Cares About, Out of Scope for This Story — with confirmation gates.

3. **Verify the persona anchor exists.** Per ST-01, the story's `persona` field must reference an existing persona at `current`. If the engineer names a persona that does not exist, `product-manager` halts and runs a sub-interview to author it first (or the engineer chooses an existing one).

4. **Exercise the Edge Cases challenge.** Per the `product-manager` contract, the Edge Cases section uses the challenge prompt "What does the user notice if this ships but is slightly broken?" with a minimum of two bullets. The Skill does not bypass this on refinement.

5. **Reciprocity.** When the story reaches `status: in-flight` (i.e., its `linked-change-specs` is non-empty), the Skill confirms the parent change-spec's `user-stories` array contains the story id and writes it if absent. The reciprocal write is performed by `product-manager` per its contract (the spec-author handles change-spec field writes generally, but for the `user-stories` array specifically, `product-manager`'s contract permits the reciprocal write).

6. **Persist.** When the story store is external (Notion/Linear/GitHub), `product-manager` writes via the MCP and produces a local sync stub at `hstack/stories/<id>.md` referencing the external record. When the store is `hstack/stories/`, the file is written directly.

7. **Validate.** Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the story — ST-01 (persona references existing), ST-02 (linked-change-specs non-empty at `in-flight`), ST-03 (success metric non-empty string).

## Outputs

- A new or updated story at the configured store, at `status: drafted`, `ready`, or `in-flight` per the engineer's intent.
- Reciprocal `user-stories: [<story-id>]` entry on the parent change-spec.
- When the store is external: a sync stub at `hstack/stories/<id>.md`.

## Auto-commit triggers

- Status transition of the story to `drafted` after the first sections land.
- Status transition to `ready` or `in-flight` at the end of the interview.
- Reciprocal write to the parent change-spec's `user-stories` array (commits the parent change-spec file).

## Idempotency contract

- Re-running with the same `--story` id and identical engineer answers is a no-op aside from `updated` timestamps.
- Re-running mid-interview after a halt: `product-manager` reads the partial story and resumes at the next un-confirmed field.
- Re-running to refine: existing values are the proposal layer; accepting all current values is a no-op.

## Stop conditions

Beyond the kernel's general stop conditions:

- The configured story-store MCP is unreachable. Halt.
- The named persona does not exist and the engineer declines the sub-interview to author it.
- The success metric the engineer offers is not concretely measurable. `product-manager` re-prompts; the Skill halts after a reasonable number of re-prompts.
- The story would drift outside the roadmap's Now horizon. `product-manager` flags; the Skill asks whether to update the roadmap (via `hstack-configure --interview roadmap`) or defer the story.

## Failure modes

- **Parent change-spec is `internal-tooling: true` (Category A) or `enables` non-empty (Category B).** Halt early; the story is unnecessary. For Category B, redirect the engineer to draft a story against the downstream change-spec named in `enables`.
- **Reciprocal write to the parent change-spec would advance its status.** It should not — the reciprocal write only touches the `user-stories` array. If the validator detects a status change, halt and ask.
- **Validator fails.** Halt and surface; the engineer rewords the failing field.

## Anti-patterns

- Never anchor a story on an invented persona. The persona either exists at `current` or is authored first via a sub-interview.
- Never bypass the Edge Cases challenge prompt, even on refinement.
- Never write a story without a concretely measurable success metric.
- Never silently fall back to a local story file when the configured external store's MCP is unreachable.
- Never write reciprocal `user-stories` entries to a change-spec at a non-draft status without going through the `spec-author`'s field-change machinery — except for the array-append case explicitly carved out by `product-manager`'s contract.
