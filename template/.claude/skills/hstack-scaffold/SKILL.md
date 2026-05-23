---
name: hstack-scaffold
description: |
  Use this skill as Phase 6 of `/hstack:greenfield-init` to bootstrap the consuming repository from empty to bootable. The Skill generates a **bootstrap change-spec** from `hstack/templates/bootstrap.md` (a change-spec variant with `area: bootstrap`, `surfaces: [infra]`), enumerates `in-scope` explicitly from the upstream artifacts (Module Map from app-architecture, Migration Sketches from data-architecture, stack ADRs from Phase 4), runs `data-review` and `security-review` in `--mode foundational` against the proposed posture, then drives the implementer through the planner's phased execution to produce the actual source files, migrations, CI config, and module shells. This is the only Skill (besides `/hstack:greenfield-init` which composes it) that ends with executable code landing in the consuming repo as part of init. Examples:

  <example>
  Context: Phases 1–5 of greenfield-init are complete; all context artifacts and stack ADRs are at terminal status.
  user: "/hstack:scaffold"
  assistant: "Generating bootstrap change-spec at hstack/specs/changes/<YYYY-MM>-bootstrap/spec.md. in-scope enumerated from app-architecture Section 1 (module shells) + data-architecture Section 5 (migration files) + standard infra files (package.json, tsconfig, CI workflow). Running foundational-mode security-review and data-review against the proposed posture. Then planner phases → implementer phase-by-phase → verifier. At terminal state the repo is bootable; build and test commands exit 0."
  <commentary>
  Scaffold's distinct property: it scores against a proposed posture (no diff yet) using --mode foundational on security-reviewer and data-specialist. After the bootstrap ships, those reviewers go back to per-change diff-scoring mode.
  </commentary>
  </example>

  <example>
  Context: Scaffold was started two days ago; phase-3 (module shells) landed but phase-4 (CI workflow) hit a verifier failure.
  user: "/hstack:scaffold"
  assistant: "Resuming the bootstrap change-spec. plan.md shows phase-3 complete; phase-4 had verifier discrepancies. Re-running /hstack:verify on phase-4 outputs to identify what failed; then either re-implementing phase-4 (if the implementer's output was incorrect) or revising the plan (if the expectation was wrong)."
  <commentary>
  Scaffold inherits the standard per-change idempotency contract because bootstrap IS a change-spec. The planner and implementer's existing resume semantics apply unchanged.
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
  - "{{TODO-SKILL: /hstack:change-new — scaffolds the bootstrap change-spec folder}}"
  - "{{TODO-SKILL: /hstack:test-plan — produces test-plan.md for the bootstrap}}"
  - "{{TODO-SKILL: /hstack:security-review — invoked in --mode foundational}}"
  - "{{TODO-SKILL: /hstack:data-review — invoked in --mode foundational}}"
  - "{{TODO-SKILL: /hstack:change-plan — invokes planner}}"
  - "{{TODO-SKILL: /hstack:implement — invokes implementer phase-by-phase}}"
  - "{{TODO-SKILL: /hstack:verify — invokes verifier after the last implement phase}}"
  - "{{TODO-SKILL: /hstack:adversarial-review — runs in a fresh session for the bootstrap}}"
  - "{{TODO-SKILL: /hstack:ship — final scorecard; bootstrap ships with a PR like any change}}"
  - "{{TODO-SKILL: /hstack:finalize — post-merge cleanup}}"
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — frontmatter validator}}"
---

## Purpose

`hstack-scaffold` is the Phase 6 execution Skill of `/hstack:greenfield-init`. It bridges discovery to working code: the upstream phases (product-brief, data-architecture, app-architecture, stack ADRs, threat-model, hardening-checklist, infrastructure, incident-runbook) declare the design; this Skill executes it. The execution path is the **standard per-change workflow** applied to a one-off change-spec with `area: bootstrap` — there is no special-cased "bootstrap workflow"; the kernel's per-change discipline applies in full, with two adjustments: (a) `security-review` and `data-review` run in `--mode foundational` (score against proposed posture, not diff), and (b) the change-spec uses the `hstack/templates/bootstrap.md` variant.

## When to invoke

- Phase 6 of `/hstack:greenfield-init` (the orchestrator calls this Skill after Phase 5 terminates).
- Standalone is **not** supported in v1 — scaffold runs once per project lifetime and assumes the full upstream discovery layer is at terminal status. Standalone invocation halts with a directive to run `/hstack:greenfield-init` instead.

## Inputs

- No positional arguments. The Skill reads upstream artifacts and the bootstrap-change-spec scaffolding from disk.

## Preconditions

- All of the following at `status: current`:
  - `hstack/context/product/product-brief.md`
  - `hstack/context/data-architecture.md`
  - `hstack/context/app-architecture.md`
  - `hstack/context/threat-model.md`, `hardening-checklist.md`, `infrastructure.md`, `incident-runbook.md`
  - `hstack/context/tech-stack.md`, `ci-cd.md`
- Stack ADRs from Phase 4 at `status: accepted`.
- `hstack/templates/bootstrap.md` present.
- The consuming repo has no source code beyond `hstack/` and standard hidden files. If non-empty, halt — scaffold is a greenfield-only operation.

## Orchestration steps

1. **Generate the bootstrap change-spec.** Invoke `/hstack:change-new` with `area: bootstrap` and a derived id (`<YYYY-MM>-bootstrap`). The change-spec folder is scaffolded with `spec.md` pre-populated from `hstack/templates/bootstrap.md`. The Skill then performs mechanical writes to populate:
   - `in-scope`: enumerated from app-architecture Module Map (one entry per module directory) + data-architecture Migration Sketches (one entry per `m_NNNN_*.sql`) + standard infra files (`package.json`, `tsconfig.json`, build config, CI workflow path, etc.). The enumeration is explicit; `["."]` is not permitted.
   - `related-adrs`: the full list of Phase 4 stack ADRs.
   - `threat-model-delta: true`.
   The change-spec lands at `status: draft` after this step; `spec-author` walks it to `ready-to-plan` via a confirmation interview (the engineer reviews the enumerated `in-scope` and confirms or revises).

2. **Test plan.** Invoke `/hstack:test-plan` for the bootstrap. The test-strategist produces `test-plan.md` covering build / lint / typecheck / migration / RLS-enforcement smoke tests. Bootstrap test plans bias toward operational-correctness assertions (build exits 0, migrations apply cleanly, RLS denies cross-tenant access) rather than feature behavior.

3. **Foundational-mode security-review.** Invoke `/hstack:security-review` with the security-reviewer in `--mode foundational`. The reviewer scores against the proposed posture (threat-model + hardening-checklist + the stack ADRs) rather than against a diff. Output: `security-review.md` at `status: passed` or `concerns-noted` per the standard contract.

4. **Foundational-mode data-review.** Invoke `/hstack:data-review` with the data-specialist in `--mode foundational`. The reviewer scores the migration sketches from data-architecture Section 5 against RLS coverage rules (DR-02) and tenant-isolation rules (DR-03), scoring proposed-DDL rather than live schema. Output: `data-review.md` at `status: passed` or `concerns-noted`.

5. **Plan.** Invoke `/hstack:change-plan`. The planner produces `plan.md` with atomic phases. A typical bootstrap plan sequence:
   - Phase 1: install dependencies (`npm install` / `pnpm install` / equivalent).
   - Phase 2: initialize framework scaffold (e.g., Next.js boilerplate, tsconfig, eslint config).
   - Phase 3: land migration files in `supabase/migrations/` per data-architecture Section 5.
   - Phase 4: scaffold module shells per app-architecture Section 1 (one directory per module with index.ts plus any per-module config).
   - Phase 5: wire CI workflow per `ci-cd.md`.
   - Phase 6: smoke tests (build, lint, typecheck, run RLS-denial test).
   Each phase declares its verifier expectations explicitly.

6. **Implement.** Invoke `/hstack:implement <bootstrap-id> <phase-id>` once per plan phase. Each invocation runs the implementer scope-locked to the `in-scope` enumeration. The implementer creates files (no edits — bootstrap is greenfield) and auto-commits at phase completion.

7. **Verify.** Invoke `/hstack:verify` after the last implement phase. The verifier runs the canonical commands from `ci-cd.md` and compares against per-phase Verifier Expectations.

8. **Adversarial review.** Direct the engineer to open a fresh Claude Code session and run `/hstack:adversarial-review`. Bootstrap inherits the standard fresh-session contract (kernel rule).

9. **Ship + finalize.** After adversarial review reaches `findings-resolved`, `/hstack:ship` produces the PR description. The engineer opens the PR, gets it merged, then runs `/hstack:finalize` to advance the bootstrap change-spec from `ready-to-ship` to `shipped` (no tech-debt resolution applies for bootstrap). `hstack/config.yaml`'s `init-status` flips to `complete` in the same finalize commit.

## Outputs

- A complete bootstrap change-spec folder at `hstack/specs/changes/<YYYY-MM>-bootstrap/` with `spec.md`, `test-plan.md`, `security-review.md`, `data-review.md`, `plan.md`, `verification.md`, `adversarial-review.md`, `pr-body.md`.
- The consuming repo's actual source files, migrations, CI workflow, build config, and per-module shells.
- `hstack/config.yaml` at `init-status: complete`.

## Auto-commit triggers

- Bootstrap change-spec advances through standard status transitions (`draft → ready-to-plan → ready-for-implementation → ready-for-review → ready-to-ship → shipped`); each transition auto-commits per the kernel.
- Each plan phase auto-commits when implementer completes it.
- `hstack/config.yaml` flips to `init-status: complete` in the finalize commit alongside the change-spec's advance to `shipped`.

## Idempotency contract

Scaffold inherits the standard per-change idempotency contract because bootstrap IS a change-spec:

- Re-running `/hstack:scaffold` reads the bootstrap change-spec's status and resumes at the next non-terminal artifact.
- Plan phases that have committed are skipped; only the first incomplete phase runs.
- A failed verifier produces `verification.md` at `status: failed-with-discrepancies`; re-running `/hstack:scaffold` does NOT silently retry — it surfaces the discrepancies and waits for the engineer to either re-implement the failing phase or revise the plan.

## Stop conditions

- Any upstream artifact at non-terminal status.
- The consuming repo is non-empty at scaffold start.
- Foundational-mode security-review or data-review lands at `concerns-noted` with unresolved CONCERNS. The engineer either resolves the concerns (revises threat-model / hardening / migration sketches) or accepts them via the standard concerns-acknowledgement path.
- Implementer halts mid-phase (file already exists outside in-scope, verifier expectation unsatisfiable, etc.). Standard implementer halt semantics apply.
- The engineer signals end-of-session — the standard per-change idempotency picks up on resume.

## Failure modes

- **Foundational-mode reviewer halts.** Foundational mode is honor-system in v1 — the reviewer is asked to score a proposed posture, not a diff. If the reviewer cannot honestly score (e.g., the threat-model is too thin), the reviewer halts with `HSTACK-HALT: reason=upstream-non-terminal` and routes the engineer back to `/hstack:configure threat-model`.
- **Implementer scope-lock fires on a path NOT in the enumerated in-scope.** This is a scaffold-spec gap, not an implementer bug. The Skill halts; the engineer revises `in-scope` (mechanical edit by the engineer per the kernel's scope-amendment path) and re-runs `/hstack:implement` for the affected phase.
- **CI runs from `ci-cd.md` haven't been authored yet for fresh projects.** The bootstrap change-spec's test-plan must define the canonical commands; otherwise verifier has nothing to run. The Skill checks this at preconditions.

## Anti-patterns

- Never run scaffold against a non-empty repo. Scaffold is greenfield-only; mixing modes produces incoherent in-scope enumeration.
- Never set `in-scope: ["."]`. Explicit file enumeration is the contract; the implementer's scope-lock does meaningful work only against an explicit list.
- Never skip foundational-mode security-review / data-review to "save time." Those gates are the v1 substrate for getting hardening and RLS posture right from line zero.
- Never bypass adversarial-review for the bootstrap. Bootstrap inherits the fresh-session contract from the kernel; ship without it is forbidden.
- Never flip `init-status: complete` while the bootstrap change-spec is below `shipped`.
