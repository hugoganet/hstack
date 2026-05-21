---
name: hstack-story-draft
description: |
  Use this skill when a user-facing change needs a story drafted or refined, anchored on an existing persona, with a concrete success metric and the user-visible edge cases enumerated. The Skill orchestrates the `product-manager` subagent and is conditional — it does not run when the parent change-spec has `internal-tooling: true`. Examples:

  <example>
  Context: The engineer just scaffolded a billing-overage change-spec and needs a linked user story before SP-09 lets the spec advance past draft.
  user: "Draft a story for the billing overage warning, anchored on the growth-marketer persona."
  assistant: "I'll invoke product-manager to walk the five story sections with the growth-marketer persona as the anchor. The story id will land in the configured story store; the change-spec's user-stories array updates reciprocally."
  <commentary>
  Stories are gated by SP-09 (`user-stories` non-empty unless `internal-tooling: true`). The Skill produces the story before the change-spec can advance, and writes the reciprocal `linked-change-specs` entry on the story.
  </commentary>
  </example>

  <example>
  Context: A story exists but the engineer wants to refine the success metric, which the product-manager flagged as too vague.
  user: "Refine STORY-2026-05-014 — sharpen the success metric."
  assistant: "I'll invoke product-manager with the existing story as the proposal layer. The other sections are accept-or-correct; the success-metric field gets the full interview treatment."
  <commentary>
  Refinement reuses the same orchestration with the existing story as the proposal context. The Skill does not re-walk every field; the subagent reads the existing content and targets the field the engineer named.
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
  - "{{TODO-MCP: Notion MCP — required when configured story store is Notion}}"
  - "{{TODO-MCP: Linear MCP — required when configured story store is Linear}}"
  - "{{TODO-MCP: GitHub MCP — required when configured story store is GitHub Issues}}"
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates story frontmatter and ST-01/ST-02/ST-03}}"
---

## Purpose

`hstack-story-draft` produces or refines one user story by orchestrating the `product-manager` subagent. It maintains the reciprocal `user-stories` ↔ `linked-change-specs` linkage between the story and its parent change-spec. It is conditional — skipped automatically for changes marked `internal-tooling: true`.

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
- If the parent change-spec carries `internal-tooling: true`, halt and surface a "story not required" message.
- Read `hstack/context/vision.md`, `mvp-scope.md`, and the personas index (required by `product-manager`'s session-start protocol).

## Orchestration steps

1. **Determine mode.** Draft a new story (no `--story` argument) or refine an existing one (`--story <id>` argument). Read the existing story when refining.

2. **Invoke or resume `product-manager`.** Per the kernel's *Subagent transcript resume* contract (Resumability section), prefer cache-read resume over fresh spawn when a previous `product-manager` session for THIS story id is still resumable in the current Claude Code session — useful when a five-section interview was interrupted, or when the engineer returns later in the same session to refine the same story.

   - **State file path:** `hstack/.session-state/story-<story-id>.yaml`. Shape:
     ```yaml
     artifact-type: story
     artifact-id: <story-id>
     agent-uuid: <agentId returned by Agent(...)>
     last-section-confirmed: <section name or null>
     mode: <draft | refine>
     last-resume-at: <ISO 8601 timestamp>
     ```
   - **Resume path** — if the state file exists and contains a non-empty `agent-uuid`, call `SendMessage(to: <agent-uuid>, message: <resume-brief>)` where `<resume-brief>` MUST include: (a) an instruction to re-read the partial story (from `hstack/stories/<id>.md` or the configured store), (b) the first unconfirmed section to resume from, (c) **the Edge Cases challenge restated verbatim**: "What does the user notice if this ships but is slightly broken?" with ≥ 2 bullets required (cached context is not authoritative for per-invocation challenge prompts), (d) the persona-anchor reminder (ST-01: `persona` field must reference an existing persona at `current`). On `success: true`, the agent resumes. On `success: false`, drop through to the spawn path.
   - **Spawn path** — call `Agent(subagent_type: product-manager, prompt: <full session-start brief>)` with context = [kernel, `hstack/templates/story.md`, vision, mvp-scope, personas store, parent change-spec when known, existing story when refining]. The subagent runs the five-section interview — Who and Why, What Shipping Looks Like, Success Metric, Edge Cases the User Cares About, Out of Scope for This Story — with confirmation gates. On return, capture the `agentId` and write/overwrite the state file.
   - **Loading discipline (both paths).** The on-disk partial story (or existing story in refine mode) is the source of truth, not the agent's working memory. The resume payload does NOT relax the Edge Cases challenge.

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
- The story would drift outside `mvp-scope.md`. `product-manager` flags; the Skill asks whether to update mvp-scope (via `hstack-configure --interview mvp-scope`) or defer the story.

## Failure modes

- **Parent change-spec is `internal-tooling: true`.** Halt early; the story is unnecessary.
- **Reciprocal write to the parent change-spec would advance its status.** It should not — the reciprocal write only touches the `user-stories` array. If the validator detects a status change, halt and ask.
- **Validator fails.** Halt and surface; the engineer rewords the failing field.

## Anti-patterns

- Never anchor a story on an invented persona. The persona either exists at `current` or is authored first via a sub-interview.
- Never bypass the Edge Cases challenge prompt, even on refinement.
- Never write a story without a concretely measurable success metric.
- Never silently fall back to a local story file when the configured external store's MCP is unreachable.
- Never write reciprocal `user-stories` entries to a change-spec at a non-draft status without going through the `spec-author`'s field-change machinery — except for the array-append case explicitly carved out by `product-manager`'s contract.
