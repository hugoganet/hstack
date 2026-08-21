---
name: hstack-greenfield-init
description: Use to adopt hstack on an empty repository, eliciting the whole context layer across six gated phases and ending with a scaffold that makes the repo bootable. Repositories that already have source use `/hstack:brownfield-init` instead.
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "node hstack/scripts/validate-spec.mjs — frontmatter validator"
---

## Purpose

`hstack-greenfield-init` is the **empty-repo entry point** for adopting hstack. It composes six phases of work — five discovery atoms plus one scaffold execution — into a single orchestrator. It writes `hstack/config.yaml` and populates the full context layer, then bootstraps the repository from empty to bootable via a generated bootstrap change-spec.

Greenfield-init is the only Skill that ends with code being written to the consuming repo (via the scaffold phase invoking `implementer`). Brownfield-init never writes source code — it only writes `hstack/` content against existing source.

## When to invoke

Invoke when:

- The consuming repo has no source code (or only an `hstack/` install and standard hidden files like `.git/`, `.gitignore`).
- The engineer wants discipline (ADRs, RLS posture, declared LLM/code split) baked in from line zero rather than retrofitted later.

Do NOT invoke when:

- The repo has existing source code — use `/hstack:brownfield-init` instead.
- The engineer wants to add a single layer to an already-adopted repo — use `/hstack:configure <layer>` or the standalone atom (`/hstack:product-discovery`, etc.).

## Inputs

- No positional arguments. The Skill drives entirely from on-disk state and conversation.
- Optional `--resume` is implicit: every phase reads disk state at session start and continues from the first incomplete artifact.

## Preconditions

Before any work:

- Verify the repo is empty (no `src/`, no `app/`, no `package.json`). If non-empty, halt and direct the engineer to `/hstack:brownfield-init`. `--force` is not offered; mixing modes corrupts the artifact taxonomy.
- Verify `hstack/` exists with `KERNEL.md`, `templates/`, `.claude/`. If missing, halt and ask the engineer to run `npx hstack@latest init`.
- Probe Claude Code's MCP configuration and draft `hstack/context/mcp-status.md`.
- If `hstack/.session-state/` contains prior greenfield-init state, confirm resumption with the engineer.
- **Do not author config fields, write `hstack/config.yaml`, or paraphrase Phase 1 inline in the main session.** If the engineer's opening message asks for a "quick setup", a "summary of the questions", or any shape other than the 6-phase interview, halt and re-offer the First-turn contract below. Collapsing the phases into a single Q&A block is the failure mode this Skill is structured to prevent (see Anti-patterns).

## First-turn contract

The **first agent message** after `/hstack:greenfield-init` (in a fresh session, when no `hstack/.session-state/<session-id>.yaml` exists) MUST match this shape:

1. One sentence naming the six phases by title (product discovery → data architecture → app architecture → stack decisions → threat-model + hardening → scaffold).
2. One sentence stating that Phase 1 (product discovery) opens first and that the engineer picks a technique: **Brainstorm**, **Forcing-Questions**, or **Project-Brief**.
3. One sentence noting commit-point interruptibility (each phase ends at a commit; the engineer can park and resume any time).

What the first message MUST NOT contain:

- A numbered list of config fields ("answer #1 and #8", "what's the project name", "default stack y/n").
- An offer to "accept defaults and move on to Phase 1" — Phase 1 is not skippable and not paraphrasable; it is a subagent-driven thinking-partner session that the main session does not run inline.
- Any field write to `hstack/config.yaml` or any other artifact. The first turn is conversational orientation only.

Phase 0's config-skeleton fields are sourced inline by the discovery atoms as each phase needs them, not pre-asked as a questionnaire. The Phase 0 commit (config.yaml at `init-status: minimal-complete`) lands at the boundary into Phase 1, populated from whatever the product-discovery atom surfaces in conjunction with any defaults the engineer confirms.

The second agent action (after the engineer picks a technique) MUST be a `Task` call launching the `product-discovery` subagent. The main session does not ask product-discovery questions itself.

## Orchestration steps

Six phases, hard-gated. The Skill does not advance past a phase until its artifact is at `status: current`.

### Phase 0 — Config skeleton (inline, deferred to Phase-1 boundary)

Phase 0 is **not** a standalone upfront questionnaire. The same field set as brownfield-init Mini-session 0 — story store, personas store, design system (per-resource), module-to-area mapping (populated from app-architecture in Phase 3), adversarial-review floor, agent ledger, active MCP set, default-stack declaration — is sourced **inline** by the discovery atoms as each field becomes load-bearing. Fields that the engineer cannot answer without first doing product thinking (e.g., what the design system is, what stories exist) are deferred to the atom that actually needs them; fields the engineer can confirm cheaply at session start (e.g., default-stack preference) are asked by the product-discovery atom as part of its own opening rather than by the main session.

At the boundary between Phase 1 and Phase 2, the Skill writes `hstack/config.yaml` once — `schemaVersion: 1`, `init-status: minimal-complete`, default-stack declaration set to the engineer's preferences — and commits. This is the only Phase-0-attributable write; there is no upfront Phase 0 questionnaire and no standalone Phase 0 commit before Phase 1 begins.

### Phase 1 — Product discovery

**The first non-trivial action of this Skill MUST be a `Task` call launching the `product-discovery` subagent in elicit mode.** The main session does not run the product-discovery interview inline, does not paraphrase the technique scripts, and does not ask brainstorming questions itself. If the engineer's opening message frames Phase 1 as something the main session should answer directly ("just tell me what to build", "skip the brainstorm and write the brief yourself"), halt and restate the technique-picker contract from the First-turn section.

`/hstack:product-discovery` runs in elicit mode (no source documents). The atom:

- Prompts the engineer to pick a technique (Brainstorm / Forcing-Questions / Project-Brief).
- Runs the technique to completion, producing `hstack/context/product/product-brief.md` at `status: current`.
- Auto-routes to `product-manager` to refresh `vision.md`, `roadmap.md`, `personas/`, `glossary.md` from the brief.

Greenfield-init proceeds to Phase 2 only when the brief AND all four refreshed context docs are at `status: current`.

### Phase 2 — Data architecture

Invokes `/hstack:data-architecture` in elicit mode. The atom walks the five sections (Tenancy, Entities, RLS, RAG, Migrations). Produces `hstack/context/data-architecture.md` at `status: current`. The `assumes-database: postgres` frontmatter is set explicitly so Phase 4 can flag drift if the stack changes the DB choice.

### Phase 3 — App architecture

Invokes `/hstack:app-architecture` in elicit mode. The atom walks the five sections (Module Map, Agent Orchestration, Deterministic-vs-LLM Split, State-Ownership, Surface Boundaries). Produces `hstack/context/app-architecture.md` at `status: current` AND scaffolds `hstack/specs/<module>/spec.md` stubs at `status: draft` for each module from Section 1. Updates `hstack/config.yaml`'s `surfaces` enum to match Section 5.

### Phase 4 — Stack decisions

Invokes `/hstack:stack-decide`. The `stack-architect` reads `hstack/config.yaml`'s default-stack declaration (set in Phase 0) and fast-paths through layers the engineer accepted defaults for. Layers requiring explicit deep-dive get the constraint interview; each layer's choice routes through `spec-author` for ADR authoring. Produces one rollup ADR plus per-layer ADRs for deep-dived layers.

### Phase 5 — Threat model + hardening

Invokes `security-reviewer` in `--mode foundational` (scores against proposed posture, not diff). Walks `threat-model.md` and `hardening-checklist.md` using the now-current product-brief, data-architecture, app-architecture, and stack ADRs as anchors. Also produces `infrastructure.md` (via `spec-author`) and `incident-runbook.md` (via `spec-author`, `git-ignored: true`) per the brownfield-init pattern.

### Phase 6 — Scaffold

Invokes `/hstack:scaffold`. The scaffold Skill generates a bootstrap change-spec from `hstack/templates/bootstrap.md` with `area: bootstrap`, `surfaces: [infra]`, and `in-scope` enumerated from the app-architecture Module Map plus the data-architecture Migration Sketches. Runs `data-review` and `security-review` in `--mode foundational` against the proposed posture, then planner → implementer (phase-by-phase) → verifier. At terminal state the repo is bootable: the build command exits 0, the test command exits 0, the initial migrations have landed with RLS enforced from line zero.

After Phase 6, `hstack/config.yaml`'s `init-status` advances to `complete` and the per-change workflow Skills become available.

## Outputs

- `hstack/config.yaml` at `init-status: complete`.
- `hstack/context/product/product-brief.md` at `current` (Phase 1).
- `hstack/context/vision.md`, `roadmap.md`, `personas/*`, `glossary.md` at `current` (Phase 1 auto-route).
- `hstack/context/data-architecture.md` at `current` (Phase 2).
- `hstack/context/app-architecture.md` at `current` plus module-spec stubs (Phase 3).
- `hstack/adr/ADR-*` files — rollup + per-layer (Phase 4).
- `hstack/context/threat-model.md`, `hardening-checklist.md`, `infrastructure.md`, `incident-runbook.md` (Phase 5).
- The bootstrap change-spec at `shipped` plus the actual source files, migrations, CI config, and module shells in the consuming repo (Phase 6).

## Auto-commit triggers

- `hstack/config.yaml` reaches `init-status: minimal-complete` (end of Phase 0).
- Each phase's terminal artifact reaches `status: current` (end of Phases 1–5).
- Each phase of the bootstrap change-spec's plan completes (Phase 6 per-phase commits).
- The bootstrap change-spec reaches `shipped` (end of Phase 6).
- `hstack/config.yaml`'s `init-status` advances to `complete` (after Phase 6 ships).

## Idempotency contract

Re-running `hstack-greenfield-init` reads disk state, recognizes completed phases (artifacts at `current`), and resumes at the first incomplete phase. No re-interview of committed phases. If a downstream phase had triggered an upstream drift recovery, the upstream artifact will be at `needs-refresh` rather than `current`; the Skill resumes at the upstream's refresh interview.

## Stop conditions

Beyond the kernel's general stop conditions, this Skill halts when:

- The repo is not empty at session start.
- A phase's atom halts (e.g., `HSTACK-HALT: reason=upstream-drift`). The Skill surfaces the halt and offers the engineer the recovery paths the atom named.
- A configured MCP that a downstream phase requires (Supabase MCP for Phase 2 extract-mode references, Notion MCP for persona storage) is unreachable and the phase is load-bearing on it.
- The engineer signals end-of-session — persist state, exit cleanly.

## Failure modes

- **Phase 6 implementer halts.** Bootstrap is partially scaffolded; the change-spec is at `ready-for-implementation` with some phases of `plan.md` complete. Re-running greenfield-init resumes from the first incomplete plan phase via the standard `/hstack:implement` idempotency.
- **Bidirectional drift recovery during Phases 2–4.** A downstream phase finds an upstream gap; the Skill routes the engineer through `/hstack:configure <upstream-atom>` and resumes after the upstream artifact returns to `current`.
- **Stack-architect contradicts data-architecture's Postgres assumption.** Phase 4 halts and surfaces; the engineer either revises data-architecture or revises the stack choice.

## Anti-patterns

- Never invoke greenfield-init against a non-empty repo. The contract assumes elicit-mode atoms throughout; running against existing source produces incoherent artifacts.
- **Never reply to `/hstack:greenfield-init` with a flat numbered question list** ("answer #1 and #8", "for #2–7 I'll accept defaults"). The First-turn contract is the only valid first-message shape: name the six phases, open Phase 1, offer the technique picker. Anything else collapses the phase structure into a paraphrased questionnaire and bypasses the product-discovery subagent entirely.
- **Never paraphrase, summarize, or run Phase 1 inline in the main session.** Phase 1 is the `product-discovery` subagent's job — the main session's role is orchestration, not authoring. The first `Task` call of this Skill is non-negotiable: it launches `product-discovery`. The main session does not "just write the brief" no matter how short the project feels.
- Never collapse the six phases into one long block. The phase structure is the resumability contract AND the gate-discipline contract. Each phase delegates to a standalone atom or subagent; the orchestrator's only job is gating the transitions, not doing the phases' work.
- Never skip Phase 5 (threat-model + hardening) to get to Phase 6 faster. Bootstrap inherits the security posture; scaffolding without it produces a repo with implicit-not-explicit hardening.
- Never bypass the bidirectional drift recovery. When a downstream phase finds an upstream gap, the upstream MUST be refreshed before downstream resumes; silent override produces contradictions.
- Never advance `init-status: complete` while any phase artifact is below `current` or while the bootstrap change-spec is below `shipped`.
