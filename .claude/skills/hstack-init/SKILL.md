---
name: hstack-init
description: |
  Use this skill when an engineer is adopting hstack on a fresh repository for the first time and needs to produce `hstack/config.yaml` and populate every required document under `hstack/context/`. Until init completes, no other hstack Skill works — every workflow Skill checks for init completion at session start and halts otherwise. Init is structured as six-to-eight mini-sessions of ten-to-fifteen minutes each (one per product-context document) rather than one ninety-minute block, so that an interruption costs at most one in-flight field. Examples:

  <example>
  Context: A fresh Moso clone has no `hstack/config.yaml` and no `hstack/context/` content; the engineer wants to bootstrap hstack from scratch.
  user: "Start /hstack:init on this repo."
  assistant: "I'll invoke the product-manager subagent for the first mini-session — vision.md. We'll commit when vision is done and resume with glossary next."
  <commentary>
  Init is the only Skill permitted to write `hstack/config.yaml` and to populate the product-context layer. It orchestrates the product-manager subagent across five-to-seven document interviews, each ending at a commit point. The "no other Skill works until init complete" rule is enforced by every downstream Skill's precondition checks.
  </commentary>
  </example>

  <example>
  Context: Init was started two days ago, three documents were committed, and a session crash dropped the fourth. The engineer wants to resume rather than restart.
  user: "Resume /hstack:init — vision, glossary, and mvp-scope are already done."
  assistant: "I'll read hstack/.session-state/<session-id>.yaml, confirm which documents are at status `current`, and resume with the next missing one — data-architecture, based on what I see on disk."
  <commentary>
  Idempotency is load-bearing here: the Skill reads disk state, recognizes which documents are already terminal, and continues at the next empty mini-session boundary rather than re-running completed interviews.
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
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — frontmatter validator run after every confirmed field write}}"
  - "{{TODO-SCRIPT: hstack/scripts/init-detect-mcps.sh — probes the consuming repo's Claude Code config for available MCPs and writes hstack/context/mcp-status.md}}"
---

## Purpose

`hstack-init` is the first-run, conversational bootstrap Skill. It writes `hstack/config.yaml` and populates the canonical product-context layer at `hstack/context/`. It is the longest Skill in the system by elapsed time, structured deliberately as a series of short mini-sessions so the user can stop and resume without losing work. It is not the workflow itself: it does not author change-specs, plans, or any per-change artifact. It is also not the editor of an existing config — that is `hstack-configure`'s role.

## When to invoke

Invoke when the consuming repo has no `hstack/config.yaml`, or when `hstack/config.yaml` exists but at least one required product-context document is missing or below `status: current`. Every other hstack Skill checks for init completion at session start; if init is incomplete, those Skills halt with a message directing the engineer here. Init runs once per repo lifetime, although `hstack-configure --migrate` may re-invoke targeted slices of it on schema-version upgrades.

## Inputs

- No positional arguments. The Skill drives entirely from on-disk state and conversation.
- Optional flag `--resume` is implicit: the Skill always reads `hstack/.session-state/<session-id>.yaml` when present and continues from the next un-confirmed field.

## Preconditions

Before any work:

- Verify `hstack/` directory exists at the repo root. If not, halt and ask the engineer to confirm they are in the right directory.
- Read `hstack/CLAUDE.md` (kernel) and `hstack/templates/` — both must be present. If either is missing, halt and ask the engineer to install or restore the hstack source. **The kernel describes the framework, not the consuming repo's product.** Treat it as behavioral rules, never as content to be configured.
- **Load the consuming-repo context layer.** Read every artifact in the consuming repo (the working directory, NOT `hstack/`) that hints at its product, stack, or design system: `CLAUDE.md`, `README.md`, `package.json`, `docs/` if present, `.claude/agents/` and `.claude/skills/` for sibling tooling. This is the product being configured. Every interview prompt below frames against THIS context, not against `hstack/CLAUDE.md`.
- Probe Claude Code's MCP configuration for the consuming repo and write a draft `hstack/context/mcp-status.md` listing which MCPs are wired (Notion, Linear, GitHub, Figma, Supabase) and which are absent. Run `{{TODO-SCRIPT: hstack/scripts/init-detect-mcps.sh}}` for this; if absent, the Skill produces the file by interviewing the engineer instead.
- If `hstack/.session-state/` contains a prior init session-state file, read it and confirm with the engineer that resumption is the intent.

If the engineer signals "start fresh, abandon the prior partial init," archive the existing session-state file before proceeding.

## Orchestration steps

Init is split into discrete mini-sessions, each commitable independently. The order is fixed because later documents reference earlier ones.

1. **Mini-session 0 — config skeleton.** Every prompt in this mini-session is about THE CONSUMING REPO (not about hstack itself). Interview the engineer for:
   - **Story store** for this repo's user stories — Notion DB, Linear, GitHub Issues, or `hstack/stories/`.
   - **Personas store** for this repo's personas — typically `hstack/context/personas/` or a Notion DB.
   - **Design system** for this repo. The schema is per-resource because partial / external states are common (Figma MCP for components, Notion for brand-guidelines, in-repo for tokens later). For each of `components`, `tokens`, `brand-guidelines`, ask:
     - `source` — controlled enum: `in-repo` | `figma-mcp` | `notion-mcp` | `submodule` | `npm` | `external-other` | `none`.
     - Source-specific follow-up: `path` for `in-repo`; `figma-file-id` for `figma-mcp`; `notion-page-id` for `notion-mcp`; `package` name for `npm`; `repo-url` for `submodule` / `external-other`.
     - Optional `notes` — especially useful for in-progress states like "via Figma MCP until vendored into the repo."
     - The `none` value is honest when the resource genuinely isn't documented yet; the agent does not invent paths to fill the field.
   - **Module-to-area mapping** for this repo — a list of module ids with their canonical path globs. Read `package.json` and the consuming repo's directory layout to propose a starting set; the engineer confirms or revises.
   - **Adversarial-review floor** — default 3, 5 for `agent`/`auth`/`billing`.
   - **Production-runtime agent ledger** — enabled or not. This logs the consuming repo's *runtime* AI agents (the orchestrator, tool calls into customer accounts, MCP-mediated actions) to `audit/agent-ledger/` at the consuming repo root. **It is NOT about hstack's own subagents** (`spec-author`, `planner`, `implementer`, etc.) — those are already audited via the kernel's auto-commit-at-status-transition rule and visible in `git log`. The v1 ledger is useful telemetry (debugging, cost attribution, per-tenant breakdowns), not defensible audit evidence; v2 substrate adds hash-chain integrity, signed records, and WORM storage. Frame the question to the engineer accordingly so the term "agent" isn't ambiguous.
   - **Active MCP set** — pre-populated from the MCP probe above; the engineer confirms.

   Write `hstack/config.yaml` with `schemaVersion: 1`. The `init-status` field starts at `minimal-complete` after this mini-session ends, advancing to `complete` only when every required context document is at `current`. Commit.

2. **Mini-session 1 — vision.** Invoke `product-manager` via the Task tool with `subagent_type: product-manager` and context = [`hstack/CLAUDE.md`, `hstack/templates/vision.md`, any pointer the engineer offers to an existing vision source]. The subagent walks the five vision sections, confirms each, writes `hstack/context/vision.md` at `status: drafted` and advances to `current` at the end. Prompt cleanup of the source per the subagent's contract. Commit.

3. **Mini-session 2 — glossary.** Same orchestration with `hstack/templates/glossary.md`. Output: `hstack/context/glossary.md` at `current`. Commit.

4. **Mini-session 3 — mvp-scope.** Same orchestration with `hstack/templates/mvp-scope.md`. Output: `hstack/context/mvp-scope.md` at `current`. Commit.

5. **Mini-session 4 — personas.** For each persona the engineer names, the `product-manager` subagent runs a persona sub-interview against `hstack/templates/persona.md`, including the challenge prompt "What is this persona explicitly not?" Personas are written to the configured store (typically `hstack/context/personas/<slug>.md`). Commit after each persona individually so partial completion is durable.

6. **Mini-session 5 — data-architecture, tech-stack, ci-cd.** These three are interview-light because the engineer has often already documented them in `CLAUDE.md`, `package.json`, or `.github/workflows/`. The Skill orchestrates by handing each in turn to `product-manager` (or `spec-author` if the engineer prefers a more code-grounded read) with the relevant existing source plus the canonical template. Output: three files at `current`. Commit after each.

7. **Mini-session 6 — infrastructure.** Invoke `spec-author` via the Task tool with `subagent_type: spec-author` and context = [`hstack/CLAUDE.md`, `hstack/templates/infrastructure.md`, `hstack/context/tech-stack.md`, `hstack/context/ci-cd.md`, `hstack/context/data-architecture.md`, any existing infra source the engineer points to — cloud console screenshots, Terraform / Pulumi / CDK files, GitHub Actions YAML, Dockerfile, supabase config]. The subagent walks every H2 section of the template via interview, biasing toward grounded truth-gathering rather than aspirational design. **For engineers unfamiliar with infrastructure concepts, the subagent is expected to explain each section's intent before asking, and to spawn the `researcher` subagent for unfamiliar terms (e.g., "what is point-in-time recovery?", "what does a CDN actually do?") rather than asking the engineer to guess.** This mini-session is interview-heavy and often the longest of init for pre-prod teams. Output: `hstack/context/infrastructure.md` at `current`. The Blast-Radius Matrix must have at least one row before status advances to `current` (INF-03); the Unknowns section must be present even when empty (INF-02). Honest "we don't have this yet" answers are explicitly preferred over fabricated content; the resulting gaps land as tech-debt items in the Known Gaps section. Commit.

8. **Mini-session 7 — threat-model, hardening-checklist, incident-runbook.** The security-context triplet. By this point `infrastructure.md` is at `current`, so the security-reviewer has the operational ground truth it needs to model threats accurately. Author orchestration is per-document:
   - `threat-model.md` and `hardening-checklist.md` are authored by `security-reviewer` via the Task tool with `subagent_type: security-reviewer`. The same subagent that scores per-change security-reviews at change time also authors the slow-changing policy these reviews score against — different cadence, same security framing (bias toward CONCERNS, challenge-driven prompts). Generalist subagents (spec-author, product-manager) are NOT offered here; the security-specific framing is load-bearing.
   - `incident-runbook.md` is authored by `spec-author` from a founder-style interview — kill switches, revocation flows, comms templates are operational content, not threat-modeling.

   `incident-runbook.md` is written with `git-ignored: true` in its frontmatter; the Skill verifies an entry exists in the repo's `.gitignore` before proceeding (creating the entry with confirmation if absent). The Skill warns the engineer at the start of this mini-session that incident-runbook content will not be committed to git and will need an out-of-band sync target named in `hstack/config.yaml`. Commit each context file as it lands.

The Skill maintains `hstack/.session-state/<session-id>.yaml` continuously, updating after every confirmed field write. The state file captures which mini-session is in progress, which fields within it are confirmed, and what the next prompt should be.

### Subagent transcript resume (per mini-session)

Per the kernel's *Subagent transcript resume* contract (Resumability section), every mini-session that invokes a subagent (mini-sessions 1 through 7) follows the resume-or-spawn protocol. Init is unusual because each mini-session authors a different artifact, so resume across mini-sessions is NEVER valid — only resume *within* one interrupted mini-session is.

- **State file path per mini-session:** `hstack/.session-state/init-mini-<N>-<doc-name>.yaml` (e.g., `init-mini-6-infrastructure.yaml`, `init-mini-1-vision.yaml`). Shape:
  ```yaml
  artifact-type: <vision | glossary | mvp-scope | persona | data-architecture | tech-stack | ci-cd | infrastructure | threat-model | hardening-checklist | incident-runbook>
  artifact-id: <doc-name>
  mini-session: <N>
  subagent-type: <product-manager | spec-author | security-reviewer>
  agent-uuid: <agentId returned by Agent(...)>
  last-section-confirmed: <section name or null>
  last-resume-at: <ISO 8601 timestamp>
  ```
- **Resume path** — when a mini-session is re-entered (engineer re-runs `/hstack:init` mid-interview) and the matching state file exists with a non-empty `agent-uuid`, attempt `SendMessage(to: <agent-uuid>, message: <resume-brief>)`. The resume brief MUST include: (a) an instruction to re-read the partial draft at `hstack/context/<doc-name>.md` from disk (working memory may lag), (b) the first unconfirmed section to resume from, (c) the template's challenge prompts restated verbatim (e.g., the persona "What is this persona explicitly not?" challenge in mini-session 4 — challenge prompts are per-invocation directives and must NOT rely on cached context). On `success: true`, resume proceeds. On `success: false` (different Claude Code session, transcript expired, agent unknown), drop through to the spawn path.
- **Spawn path** — invoke the appropriate subagent with the existing mini-session context (as documented in the mini-session's step above), capture the returned `agentId`, write/overwrite the per-mini-session state file.
- **Never resume across mini-sessions.** A `spec-author` instance authored for `infrastructure.md` is NOT eligible to be resumed for `incident-runbook.md`. The cached context (template + reference docs) differs per artifact; cross-artifact resume would carry stale context. Each mini-session keys its own state file independently.
- **Saving target.** Mini-session 6 (infrastructure) is typically the largest, with spec-author loading kernel + infrastructure template + tech-stack + ci-cd + data-architecture + engineer-supplied infra sources. Resume after interruption saves the cache-create cost on that prefix; spawn handles cold start correctly.

## Outputs

- `hstack/config.yaml` (status field on the config carries `init-status: minimal-complete` once mini-session 0 ends, advancing to `complete` only when every required context document is at `current`).
- `hstack/context/vision.md` at `current`.
- `hstack/context/glossary.md` at `current`.
- `hstack/context/mvp-scope.md` at `current`.
- `hstack/context/personas/<slug>.md` per persona, or sync stubs when the store is Notion / Linear.
- `hstack/context/data-architecture.md`, `tech-stack.md`, `ci-cd.md`, `infrastructure.md`, `threat-model.md`, `hardening-checklist.md` — all at `current`.
- `hstack/context/incident-runbook.md` at `current` with `git-ignored: true`; corresponding `.gitignore` entry verified.
- `hstack/context/mcp-status.md` documenting active and degraded MCPs.

## Auto-commit triggers

Each of the following emits an auto-commit on the active working branch:

- `hstack/config.yaml` reaches `init-status: minimal-complete` (end of mini-session 0).
- Each product-context document's status moves to `current` (end of each mini-session).
- Each persona's status moves to `current` (end of each persona sub-interview).
- `hstack/config.yaml`'s `init-status` advances to `complete` (end of mini-session 7).

The commit message names the mini-session and the artifact. Aside from these, init does not auto-commit.

## Idempotency contract

Re-running `hstack-init` on a repo where init has progressed partway through:

- Reads `hstack/config.yaml` and every existing `hstack/context/*.md`. Any file at `status: current` is considered done; the Skill does not re-interview it.
- Reads `hstack/.session-state/<session-id>.yaml` if present and resumes the in-flight mini-session at its next un-confirmed field.
- Produces a no-op diff for completed mini-sessions; the only writes happen to the first incomplete document.
- Re-running after all mini-sessions are complete is a no-op that prints the init-status summary.

## Stop conditions

Beyond the kernel's general stop conditions, this Skill halts when:

- The `product-manager` subagent halts (e.g., because a persona answer is too vague, or because a referenced source document is unreachable). The Skill surfaces the subagent's halt message and waits.
- A configured MCP the engineer named as the story store is not wired in Claude Code. The Skill does not silently fall back to a different store; it asks the engineer to wire the MCP or pick a different store, then re-runs the relevant config field.
- The engineer signals end-of-session mid-mini-session. The Skill writes the session-state file, commits any field that has been confirmed and written, and exits cleanly.
- `incident-runbook.md` would be committed to git. Halt; verify the gitignore entry first.

## Failure modes

- **Missing kernel or templates.** Halt with a clear message; this is a hstack installation problem, not an init problem.
- **Subagent unreachable mid-mini-session.** Persist current state; instruct the engineer to retry in a moment.
- **Notion/Linear/GitHub MCP unreachable but configured as the story store.** Halt and ask the engineer to wire it; do not silently fall back to `hstack/stories/`.
- **`.gitignore` write refused.** The Skill cannot proceed past mini-session 7's incident-runbook step without it. Halt and surface the issue.

## Anti-patterns

- Never write `hstack/config.yaml` silently from inferred defaults. Every field passes through the engineer's confirmation gate via the `product-manager` subagent.
- Never collapse the eight mini-sessions into one long block. The mini-session structure is the resumability contract.
- Never advance `init-status: complete` while any required context document is below `current`.
- Never write `incident-runbook.md` content to the conversation transcript more than necessary; the file's contents are sensitive and should be confirmed in summary form rather than pasted verbatim.
- Never re-interview a completed mini-session on resume. Read the disk; trust the prior commit.
