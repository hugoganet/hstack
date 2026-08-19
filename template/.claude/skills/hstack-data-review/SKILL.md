---
name: hstack-data-review
description: Use when a change-spec with `db` in `surfaces` is at `ready-to-plan` or later and needs `data-review.md` before implementation. Runs independently of `/hstack:change-plan` and `/hstack:security-review`.
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "{{TODO-MCP: Supabase MCP — required for live schema, RLS policies, and pgvector index introspection; v1 permits a degraded-with-flag fallback, v2 hard-fails when unreachable}}"
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates data-review frontmatter and DR-01..DR-06}}"
---

## Purpose

`hstack-data-review` produces `data-review.md` for a change-spec with `db` in its surfaces by orchestrating the `data-specialist` subagent. The artifact covers schema changes, RLS coverage, migration safety, index and performance impact, pgvector and RAG implications, and data lifecycle. It is the upstream gate the implementer refuses to bypass when surfaces touches db. In v1 the artifact is a structured judgment grounded in live-schema introspection via the Supabase MCP when available; the v1/v2 split governs MCP fallback behavior.

## When to invoke

Invoke when a change-spec with `db` in surfaces reaches `status: ready-to-plan` or later. The data-review can run before, after, or concurrently with `hstack-change-plan` and `hstack-security-review`.

## Inputs

- `<change-id>` (required, positional): the change-spec id.

## Preconditions

Before any work:

- Verify the change-spec exists and is at `status: ready-to-plan` or later.
- Verify `surfaces` includes `db`. If not, halt with a surface-conditional message.
- Verify `hstack/context/data-architecture.md` is at `status: current`. Halt otherwise.
- Read `hstack/context/tech-stack.md` and `hstack/context/ci-cd.md`.
- **Supabase MCP availability.** Probe the MCP. In v1, an unreachable MCP is a degraded read (flagged in rationale), not a hard fail, except for high-stakes cases: new public-schema tables, new RLS policies, new pgvector RPCs. For high-stakes cases the Skill halts in v1 as well; the v2 substrate will hard-fail uniformly. The Skill is explicit about which mode it is in.
- Read `supabase/migrations/` to identify migration files the diff would introduce.

## Orchestration steps

1. **Invoke `data-specialist`.** Use the Task tool with `subagent_type: data-specialist` and context = [kernel, `hstack/templates/data-review.md`, change-spec, module-spec for the change's area, data-architecture, tech-stack, ci-cd, live schema and RLS / pgvector index introspection via MCP when available]. The subagent walks the six sections — Schema Changes, RLS Coverage, Migration Safety, Index and Performance Impact, pgvector and RAG, Data Lifecycle.

2. **RLS coverage gate.** Per the subagent's contract and DR-02, every new table must have a `covered` value in `rls-coverage.new-tables` for status `passed`. Per DR-01 and DR-05, every new table named in section 1 must appear in the frontmatter and have a section 2 entry. Per the RLS coverage challenge prompt, the subagent cites the exact RLS rule and the test that would catch its absence.

3. **pgvector tenant-id gate.** Per DR-03, when the diff touches any pgvector RPC, `pgvector-changes.tenant-id-arg-present` must be `true`. If false, the Skill halts — this is a kernel-level stop condition (tenant-isolation breach).

4. **Migration safety.** When `migration-safety: risky`, section 3 must enumerate the locking behavior and the mitigation (e.g., `CREATE INDEX CONCURRENTLY`, batched backfill, feature-gated consumer). DR-04 enforces this.

5. **Index discipline and RAG implications.** Per the subagent's contract, every added index has a stated query pattern; pgvector index changes get extra scrutiny for HNSW rebuild pressure. RAG-broadening changes receive cross-tenant leak attention.

6. **Data lifecycle.** Every new table declares retention (`retained-indefinitely`, `retained-N-days`, `ephemeral`). DR-06 enforces the controlled enum.

7. **Migration proposals.** The subagent may propose migration files in section 3 (named, with intent) but does not execute them. Execution belongs to the implementer per the kernel's database workflow.

8. **v1 framing.** When live-schema MCP is degraded, every rationale paragraph names the degraded source explicitly: "Reviewed against data-architecture.md dated YYYY-MM-DD because Supabase MCP unreachable." The Skill rejects rationale paragraphs that imply live verification when the MCP was not available.

9. **Status transitions.** When every score is acceptable and validation passes, the subagent transitions to `status: passed`. When any RLS coverage is `partial` or `missing`, status moves only to `concerns-acknowledged` and only with explicit human acknowledgement plus a tech-debt item via `hstack-tech-debt-new`.

10. **Validate.** Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` — DR-01 through DR-06.

## Outputs

- `hstack/specs/changes/<change-id>/data-review.md` at `status: passed` or `concerns-acknowledged`.
- Optional surfaced recommendation to file tech-debt for deferred RLS or migration concerns.
- Optional migration-file proposals named in section 3 (for the implementer to act on).

## Auto-commit triggers

- Status transition to `in-progress` after the first frontmatter fields land.
- Status transition to terminal. Commit message: `data-review(<change-id>): passed` or `concerns-acknowledged`.
- Edits to `rls-coverage`, `pgvector-changes` (because gating depends on them).

## Idempotency contract

- Re-running on a terminal data-review without diff changes: a no-op aside from `updated` timestamps.
- Re-running after `in-scope` has expanded: the subagent re-reads the diff and may surface new tables or RPCs; the engineer confirms.
- Re-running mid-authoring after a halt: the subagent reads the partial artifact and resumes.

## Stop conditions

Beyond the kernel's general stop conditions:

- `data-architecture.md` at `needs-refresh` or absent. **Hard-fail of the Supabase MCP** when the change is high-stakes (new public-schema table, new RLS policy, new pgvector RPC). The v1/v2 split applies; the v2 substrate hard-fails uniformly.
- pgvector RPC drops tenant context (`tenant-id-arg-present: false`). Halt — kernel-level.
- A new public-schema table is introduced without an RLS policy in the same migration. Halt.
- A migration is proposed that requires `service_role` keys, raw shell against production, or `supabase db push` against a remote project. Halt — kernel-forbidden tools.
- A backfill strategy is required and the engineer has not provided one.

## Failure modes

- **Supabase MCP unreachable on a high-stakes change.** Halt in v1; v2 hard-fails. Do not silently fall back to data-architecture.md as ground truth.
- **Validator fails DR-02 because RLS coverage is `partial`.** Halt; the engineer either fixes the policy or acknowledges via tech-debt and the subagent moves to `concerns-acknowledged`.
- **A pgvector RPC modification is detected but tenant_id is absent from the RPC signature.** Halt — kernel-level stop condition.

## Anti-patterns

- Never write `passed` when any RLS coverage entry is `partial` or `missing`.
- Never approve a pgvector RPC change that drops `tenant_id`.
- Never silently treat `data-architecture.md` as ground truth when the live-schema MCP is unreachable. Flag the degradation in every affected rationale.
- Never execute migrations from this Skill. Propose only; the implementer executes.
- Never use `service_role` Supabase keys, raw shell against production, or `supabase db push` against a remote project. Kernel-forbidden.
- Never recommend disabling RLS to "simplify" a query.
- Never approve a `risky` migration without a named locking-mitigation strategy.
- Never claim live verification you did not perform.
