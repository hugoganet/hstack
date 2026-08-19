---
name: hstack-product-discovery
description: Use to produce or refresh `hstack/context/product/product-brief.md` through one of three discovery techniques. Greenfield Phase 1, optional brownfield enrichment when source docs are thin, or standalone retroactive authoring.
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — frontmatter validator}}"
---

## Purpose

`hstack-product-discovery` is the atom that produces `hstack/context/product/product-brief.md` via the `product-discovery` subagent. It is the canonical authoring path for the brief; the brief never lands via a generic spec-author interview.

## When to invoke

- Phase 1 of `/hstack:greenfield-init` (elicit mode, no source).
- Optional enrichment within `/hstack:brownfield-init` when existing product docs are thin and the engineer wants the deeper reframe-style brief.
- Standalone via `/hstack:product-discovery [--mode extract|elicit] [--section <name>]` for retroactive brief authoring on any repo.

## Inputs

- `--mode extract | elicit` — defaults: `elicit` if no source docs are reachable; `extract` if a `product-brief.md` exists or the engineer points at source documents.
- `--section <name>` — optional, fast-jumps to a specific section for refresh. Re-runs the end-of-atom check across all sections before commit.

## Preconditions

- `hstack/config.yaml` exists and `init-status` is at least `minimal-complete` — the atom does not run standalone until config exists.
- `hstack/KERNEL.md` and `hstack/templates/product-brief.md` are present.
- `hstack/templates/discovery/{brainstorm,forcing-questions,project-brief}.md` are present.
- In extract mode, at least one source document must be reachable; otherwise halt and ask the engineer to either supply source pointers or fall back to elicit mode.

## Orchestration steps

1. **Detect mode.** Read disk state. If `hstack/context/product/product-brief.md` exists at `status: current` and no `--section` flag, this is a refresh confirmation — print summary and exit unless engineer opts into full re-interview.
2. **Pick technique** (elicit mode only). Prompt the engineer to choose Brainstorm / Forcing-Questions / Project-Brief. Persist the choice as `technique-used` in the brief frontmatter.
3. **Invoke `product-discovery` subagent.** Via the Task tool with `subagent_type: product-discovery`. Pass mode, technique, optional section, and the canonical session-start context (kernel, template, technique script, source docs in extract mode).
4. **Walk sections.** The subagent runs the chosen technique's script and walks the brief sections with confirmation gates. Each confirmed section writes to disk and auto-commits.
5. **Run forcing prompts.** The three required reframes (Who pays? What's the wedge? What would falsify this?) fire before terminal state regardless of technique.
6. **Auto-route at terminal state.** When the brief reaches `status: current`, the Skill prints the auto-route message (with alternative-path commands) and hands off to `product-manager` via the Task tool with `subagent_type: product-manager` to refresh `vision.md`, `roadmap.md`, `personas/`, `glossary.md`. If the engineer types `skip-routing`, the Skill commits the brief and exits cleanly — downstream Skills will halt on missing context docs.

## Outputs

- `hstack/context/product/product-brief.md` at `status: current`.
- `hstack/.session-state/<session-id>.yaml` (transient).
- Via auto-route: `vision.md`, `roadmap.md`, `personas/*`, `glossary.md` refreshed (unless skip-routing).

## Auto-commit triggers

- Each confirmed section writes immediately and auto-commits.
- Brief reaches `status: current` → final commit with the auto-route message in the body.
- Downstream refreshes by `product-manager` each auto-commit per the product-manager subagent's contract.

## Idempotency contract

- Brief at `current` + no `--section` + no `--force`: print summary, exit no-op.
- Brief at `draft` or partial: read disk + session-state, resume at next non-confirmed section.
- Brief at `needs-refresh` (flipped by `/hstack:configure` because upstream changed): walk all sections in confirm-or-revise mode.

## Stop conditions

- A required source document in extract mode is unreachable.
- Forcing-prompt answer is too vague after one re-ask. The subagent halts with `HSTACK-HALT: reason=ambiguous-spec` or `missing-context`.
- Mid-technique switch requested.
- Engineer signals end-of-session.
- Downstream auto-route fails (e.g., `product-manager` cannot reach the configured personas store). The Skill surfaces the failure; the brief stays at `current`, downstream context docs stay at their prior status until the engineer resolves.

## Failure modes

- **Subagent unreachable.** Persist session state; retry later.
- **Auto-route partial failure.** If `product-manager` succeeds on vision but fails on personas (e.g., Notion MCP unreachable), the partial state is on disk; re-running auto-route via `/hstack:configure personas --from-brief` recovers.

## Anti-patterns

- Never write to `vision.md`, `roadmap.md`, `personas/`, `glossary.md` from this Skill directly. Those refreshes belong to `product-manager` via the auto-route.
- Never bypass the three required forcing prompts, even in Project-Brief mode (the lightest touch).
- Never silently switch techniques mid-session.
- Never advance the brief to `current` while the Explicitly NOT section has fewer than two bullets.
