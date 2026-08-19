---
name: hstack-app-architecture
description: Use to produce or refresh `hstack/context/app-architecture.md` — module map, agent orchestration, deterministic-vs-LLM split, state ownership, surface boundaries. Greenfield Phase 3, the brownfield app-architecture step, or a standalone section refresh.
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

`hstack-app-architecture` is the atom that produces or refreshes `hstack/context/app-architecture.md` via the `app-architect` subagent. The artifact captures the internal architecture in five sections; subsequent module-spec authoring and per-change-spec `surfaces` declarations depend on it.

## When to invoke

- Phase 3 of `/hstack:greenfield-init` (elicit mode).
- Delegated by `/hstack:brownfield-init` mini-session 5b (extract mode).
- Standalone via `/hstack:app-architecture [--mode extract|elicit] [--section <name>]` for refresh or single-section edits.
- Routed-into-from-downstream when `/hstack:stack-decide` finds a stack constraint that contradicts the architecture (rare).

## Inputs

- `--mode extract | elicit` — defaults: `extract` if a `src/`, `app/`, or `lib/` tree exists in the consuming repo; `elicit` if the repo is empty (greenfield).
- `--section <name>` — one of `modules | orchestration | split | state | surfaces`. Fast-jumps but re-runs end-of-atom coherence.

## Preconditions

- `hstack/config.yaml` at `init-status: minimal-complete` or later.
- `hstack/context/product/product-brief.md` and `hstack/context/data-architecture.md` both at `status: current`. App architecture is downstream of both. If either is at non-terminal status, halt with `HSTACK-HALT: reason=upstream-non-terminal`.
- `hstack/templates/app-architecture.md` and `hstack/templates/module-spec.md` present.
- In extract mode, a source tree (`src/`, `app/`, or `lib/`) is reachable; otherwise halt.

## Orchestration steps

1. **Detect mode + entry.** Read disk state. If artifact at `current` and no `--section` and no `--force`: print summary, exit no-op.
2. **Invoke `app-architect` subagent.** Via the Task tool with `subagent_type: app-architect`. Pass mode, optional section, the canonical session-start context. Explicitly DO NOT pass `tech-stack.md` — the architecture is stack-agnostic.
3. **Walk sections.** The subagent walks all five sections in order in fresh-start mode. Section 3 (Deterministic-vs-LLM Split) is walked per-flow with per-step confirmation; this is the only section with finer-than-section confirmation gates because per-step declarations are too consequential to batch.
4. **Run drift challenge prompts.** Each section ends with a drift challenge. A real drift halts with `HSTACK-HALT: reason=upstream-drift` and offers (a) revise this section, (b) re-enter the upstream atom (typically `/hstack:data-architecture --section entities` for state-ownership gaps), (c) log as ADR.
5. **End-of-atom coherence check.** Even on section-targeted entry, the subagent re-runs all five drift challenges before terminal commit.
6. **Terminal-state side effects (one atomic commit).** When the artifact reaches `status: current`, the Skill performs three mechanical writes in a single commit:
   - The completed `app-architecture.md`.
   - One `hstack/specs/<module>/spec.md` stub per module from Section 1 (header sections only, `status: draft`, body note pointing to `/hstack:module-spec`).
   - `hstack/config.yaml` updated to set the `surfaces` enum to match Section 5.
   The proposed-diff preview runs before this commit lands per the kernel's mechanical-operations rule.

## Outputs

- `hstack/context/app-architecture.md` at `status: current`.
- One `hstack/specs/<module>/spec.md` per module at `status: draft`.
- `hstack/config.yaml` with updated `surfaces` enum.
- `hstack/.session-state/<session-id>.yaml` (transient).

## Auto-commit triggers

- Each confirmed section writes immediately and auto-commits.
- Per-flow row in Section 3 commits individually (not full-section batch).
- Terminal-state side effects (artifact + stubs + config) land in one atomic commit.

## Idempotency contract

- Artifact at `current` + no `--section` + no `--force`: print summary, exit no-op.
- Artifact at `draft` or partial: resume at next non-confirmed section.
- Artifact at `needs-refresh`: walk all sections in confirm-or-revise mode.
- Module-spec stubs at `status: draft`: the atom does NOT overwrite stubs on re-run; if Section 1 added a module on refresh, the new stub lands additively; if Section 1 removed a module, the orphan stub is flagged for engineer review (the engineer either deletes it or routes the deletion through `/hstack:tech-debt-stale`).

## Stop conditions

- Product-brief or data-architecture at non-terminal status.
- A module in Section 1 has no trace to brief or data-architecture entities.
- A Section 3 flow step has no declared mechanism or no measurable-property rationale.
- A drift challenge surfaces an unresolved contradiction.
- Extract mode invoked but no source tree reachable.

## Failure modes

- **Subagent unreachable.** Persist session state; retry later.
- **Terminal-state side-effect commit fails partway** (e.g., one stub fails validator). The atom rolls back the in-progress write and halts with the validator error; the engineer fixes or routes through `/hstack:configure`. The artifact stays at `current` only when ALL three side effects land successfully.

## Anti-patterns

- Never name frameworks, ORMs, hosting providers, or specific runtimes in the artifact body or frontmatter. Stack-agnostic is load-bearing for portability across Phase 4 stack decisions.
- Never write authored content into module-spec stubs. Headers + `status: draft` + body note only.
- Never let Section 3's per-step declaration collapse to "the AI handles it end-to-end." Each step is named with mechanism + measurable-property rationale.
- Never bypass the end-of-atom coherence check on section-targeted re-entry.
- Never write surfaces into `hstack/config.yaml` outside the terminal-state atomic commit.
