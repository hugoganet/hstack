---
name: hstack-data-architecture
description: Use to produce or refresh `hstack/context/data-architecture.md` — tenancy model, entity graph, RLS posture, RAG layout, migration sketches. Greenfield Phase 2, the brownfield data-architecture step, or a standalone section refresh.
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "{{TODO-MCP: Supabase MCP — live schema introspection in extract mode}}"
  - "node hstack/scripts/validate-spec.mjs — frontmatter validator"
---

## Purpose

`hstack-data-architecture` is the atom that produces or refreshes `hstack/context/data-architecture.md` via the `data-architect` subagent. The artifact is the foundational design of the data layer in five sections; downstream subagents (`data-specialist` for per-change reviews, `implementer` for migration writing) read it as canonical posture.

## When to invoke

- Phase 2 of `/hstack:greenfield-init` (elicit mode).
- Delegated by `/hstack:brownfield-init` mini-session 5a (extract mode).
- Standalone via `/hstack:data-architecture [--mode extract|elicit] [--section <name>]` for refresh or single-section edits.
- Routed-into-from-downstream when `/hstack:app-architecture` finds a state-ownership gap that requires an entity addition (the bidirectional drift recovery path).

## Inputs

- `--mode extract | elicit` — defaults: `extract` if the live schema is reachable via Supabase MCP or migration files exist; `elicit` otherwise.
- `--section <name>` — one of `tenancy | entities | rls | rag | migrations`. Fast-jumps but re-runs end-of-atom coherence.

## Preconditions

- `hstack/config.yaml` at `init-status: minimal-complete` or later.
- `hstack/context/product/product-brief.md` at `status: current`. The brief is upstream; entities trace to it. If brief is at `draft` or `needs-refresh`, halt with `HSTACK-HALT: reason=upstream-non-terminal`.
- `hstack/templates/data-architecture.md` present.
- In extract mode, the Supabase MCP is reachable OR `supabase/migrations/` exists OR equivalent schema source is reachable; otherwise halt.

## Orchestration steps

1. **Detect mode + entry.** Read disk state. If artifact at `current` and no `--section` and no `--force`: print summary, exit no-op.
2. **Invoke `data-architect` subagent.** Via the Task tool with `subagent_type: data-architect`. Pass mode, optional section, the canonical session-start context, and (in extract mode) the live-schema introspection results.
3. **Walk sections.** The subagent walks Section 1 first (Tenancy is gate). For section-targeted entry, jumps directly. Each confirmed section writes to disk + auto-commits.
4. **Run drift challenge prompts.** Each section ends with a drift challenge before confirmation. A real drift halts with `HSTACK-HALT: reason=upstream-drift` and offers (a) revise this section, (b) re-enter the upstream atom (`/hstack:product-discovery` or `/hstack:configure vision`), (c) log as ADR via `/hstack:adr-new`.
5. **End-of-atom coherence check.** Even on section-targeted entry, the subagent re-runs all five drift challenges before terminal commit. Any unanswered challenge blocks the commit.

## Outputs

- `hstack/context/data-architecture.md` at `status: current` with `assumes-database: postgres` in frontmatter (or alternative with rationale). Section 5 holds migration *sketches* only — no `.sql` file is written from this Skill; the implementer writes them during bootstrap or per-change.
- `hstack/.session-state/<session-id>.yaml` (transient).

## Auto-commit triggers

- Each confirmed section writes immediately and auto-commits.
- Artifact reaches `status: current` → final commit with the coherence-check evidence in the body.

## Idempotency contract

- Artifact at `current` + no `--section` + no `--force`: print summary, exit no-op.
- Artifact at `draft` or partial: read disk + session-state, resume at next non-confirmed section.
- Artifact at `needs-refresh`: walk all sections in confirm-or-revise mode.

## Stop conditions

- Product-brief at non-terminal status.
- Section 1's tenant is not yet one concrete noun with a rule for who is inside it, after one re-ask.
- A drift challenge surfaces an unresolved contradiction.
- Extract mode invoked but no schema source reachable.
- The `assumes-database: postgres` value contradicts an in-flight stack decision.

## Failure modes

- **Subagent unreachable.** Persist session state; retry later.
- **Supabase MCP unreachable in extract mode.** If migrations or other schema source exist, the subagent falls back to those. Otherwise halt with `HSTACK-HALT: reason=mcp-unreachable` per the kernel's load-bearing-MCP rule.
