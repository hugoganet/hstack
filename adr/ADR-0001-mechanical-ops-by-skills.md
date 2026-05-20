---
id: ADR-0001-mechanical-ops-by-skills
type: adr
status: accepted
owner: hugoganet
decision-date: 2026-05-19
supersedes: null
superseded-by: null
related-change-specs: []
related-modules: []
created: 2026-05-19
updated: 2026-05-19
schema-version: 1
---

## Title

Mechanical frontmatter operations are performed by Skills, not subagents.

## Status

Accepted on 2026-05-19. No supersession.

## Context

hstack's per-change workflow was burning tokens faster than expected. The engineer (Hugo) flagged unusual cost on `/hstack:tech-debt-resolve` runs and asked for an audit before committing to optimizations.

### Investigation method

The audit ran in four passes:

1. **Transcript discovery.** Claude Code persists every session at `~/.claude/projects/<project-slug>/<session-uuid>.jsonl`. A Python script walked every project directory matching `moso-app` and its conductor worktrees, then parsed each JSONL record for `assistant` turns carrying a `message.usage` object. Tokens were bucketed by `cache_creation`, `cache_read`, `input_tokens`, and `output_tokens`, weighted by approximate billing cost (`cost_score = input + 1.25 * cache_creation + 0.10 * cache_read + 5 * output`).

2. **Skill / subagent attribution.** Sessions whose user messages contained `/hstack:<name>` or `<command-name>hstack-<name></command-name>` were attributed to that Skill. Subagent transcripts turned out to live in a nested location (`<project>/<parent-session-uuid>/subagents/<agent-name>.jsonl`) that the first pass missed entirely. The second pass walked these nested directories, parsed each subagent's `.meta.json` for `agentType`, and aggregated tokens by `agent × model`.

3. **Model-pinning compliance.** Each agent file declares `model: opus | sonnet | haiku` in frontmatter. The pinning commit (`9c68d9e`) landed at 08:43 on 2026-05-19; the audit split subagent turns into before-pinning and after-pinning buckets and computed per-agent compliance.

4. **Template vs. real-output audit.** Three review templates (`adversarial-review.md`, `security-review.md`, `data-review.md`) were compared against their largest real outputs to identify where the actual cost lived: template skeleton bloat, agent prose verbosity, or multi-pass artifact accumulation.

### Findings

- **Cache effectiveness is already good.** 92% of input tokens are `cache_read` rather than `cache_creation` — caching is doing its job within sessions. The original hypothesis "each subagent reloads context" was wrong.

- **Subagent transcripts were invisible in the first pass.** They live in nested `subagents/` directories, not in the main project transcript. The first audit understated subagent cost by ~23%.

- **Model pinning is partially live.** After the 08:43 commit, `adversarial-reviewer`, `implementer`, `planner`, `security-reviewer`, `test-strategist` show 100% compliance with their pinned model. `spec-author` (pinned to Sonnet) and `verifier` (pinned to Haiku) show ~60% compliance — the rest are sessions started before the commit that retained Opus. Not a kernel bug; a session-resume artifact.

- **Real cost-score split (moso-app + worktrees, 146 sessions + nested subagents):**
  - Main-thread sessions: 386M
  - Subagent fan-out: 88M
  - Combined: ~474M

- **The output-token problem.** Output tokens are billed at ~5× input cost. The dominant single line in subagent spend is `spec-author` at 24M total — and inspection revealed it is invoked for **frontmatter-only mechanical operations** (status flips, reciprocal writes, Resolution Log appends) where no interview is happening.

- **The screenshot finding.** A single `spec-author` invocation to flip `status: ready-to-plan → ready-for-implementation` (two characters changed) cost **25,993 tokens** for 4 tool uses in 23 seconds. Decomposed: ~3-5k tokens for the agent's own system prompt, ~8-12k tokens for its session-start context loads (glossary, tech-stack, module-spec), ~3-4k tokens to Read the spec.md, ~1k for the two Edits, plus orchestration overhead. The mere existence of the subagent on a fresh session costs ~20k tokens regardless of what it does.

- **Review template bloat is a smaller and different problem.** The 7576-word security-review.md was dominated by **preserved multi-pass prose** ("Second-pass rationale below carried for audit trail" sections), not by genuine LLM verbosity. The adversarial-review.md verbose Methodology sections turned out to be kernel-enforcement audit evidence (fresh-session attestation, test-immutability audit), not ritual. The data-review.md was already lean. Template trim is a real lever but not the highest one.

### The mechanical pattern across the workflow

A systematic read of all 23 Skills + 11 agent files showed five distinct mechanical-operation patterns in the workflow:

1. Change-spec status advance (`ready-to-plan → ready-for-impl`, `ready-for-review → ready-to-ship`, `ready-to-ship → shipped`).
2. Tech-debt status flip + reciprocal write + Resolution Log append.
3. Reciprocal back-reference write (paired with new artifact creation).
4. Frontmatter `updated:` date bumps.
5. Resolution Log appends (templated prose at known transitions).

All five currently route through `spec-author` because of an inherited interpretation of the kernel rule. The actual kernel text says *"spec-author is the only **subagent** permitted to write under `hstack/specs/`, `hstack/adr/`, `hstack/tech-debt/`."* The Skill orchestrator running in the main Claude Code session is not a subagent — `/hstack:change-new` already exploits this for its scaffolding step ("The Skill does not invoke any subagent. Scaffolding is mechanical."). Other Skills did not.

### Per-change cost of the current pattern

A typical non-trivial change resolving one tech-debt pays roughly:

| Operation | Calls | Tokens | Addressed by this ADR? |
|---|---|---|---|
| Engineer-initiated status flips between phases | 3-5 | 75-125k | No — deferred to future `/hstack:advance` |
| `/hstack:tech-debt-new` reciprocal write | 1 | 25k | Yes |
| `/hstack:tech-debt-resolve` TD status flip | 1 | 25k | Yes |
| `/hstack:finalize` change-spec flip | 1 | 25k | Yes |
| `/hstack:finalize` per TD resolution | N | 25k × N | Yes |
| **Total per change with 1 TD** | **7-9** | **~175-225k** | **Mixed** |

**Honest savings breakdown:**

- **What THIS ADR delivers**: ~75-100k per change with 1 TD (4 mechanical writes × ~25k — the `tech-debt-new` reciprocal write, the `tech-debt-resolve` TD flip, the `finalize` change-spec flip, and 1 `finalize` TD resolution).
- **What `/hstack:advance` would additionally deliver (deferred)**: ~75-125k per change (3-5 engineer-initiated status flips between phases).
- **Combined potential if both ship**: ~150-225k per change.

At ~5 changes/week, this ADR reclaims roughly **375-500k tokens/week**; the full combined target is ~750k-1.1M tokens/week and requires the deferred `/hstack:advance` Skill.

## Decision

Mechanical frontmatter operations — status flips, reciprocal back-reference writes, Resolution Log appends, and `updated:` date bumps — are performed by Skills directly in the main Claude Code session, not by invoking `spec-author` as a subagent. `spec-author` is reserved for authoring interviews where field values come from a conversation with the engineer.

The boundary: **if the Skill knows the value to write before invoking, the Skill writes directly. If the value comes from a conversation, spec-author runs the conversation.**

Concrete scope of this ADR:

- The kernel's `## Mechanical operations` section is added between `## AI writes, humans confirm` and `## Authoring and review never share a session`.
- `spec-author`'s behavior rules are updated to refuse mechanical-operation invocations and direct the engineer to the appropriate Skill.
- `/hstack:finalize`, `/hstack:tech-debt-resolve`, `/hstack:tech-debt-wontfix`, and `/hstack:tech-debt-new` (reciprocal-write half) are updated to perform their mechanical writes via the `Edit` tool directly.
- Validation discipline (`validate-spec.ts` after every write) and auto-commit discipline (one commit per status transition, atomic for reciprocal pairs) are preserved.

**Out of scope of this ADR (deferred to future work):**

- **`hstack/scripts/validate-spec.ts` implementation (blocker-priority).** The kernel's Mechanical operations Discipline-preserved list mandates `validate-spec.ts after every write`, but the script is still a `{{TODO-SCRIPT}}` placeholder. Until it ships, the new pattern relies on the proposed-diff preview as the only contract check. A minimal v1 validator (frontmatter schema + TD-01/TD-04/TD-05/TD-06 reciprocity + FM-01 floor) would close this gap; should be the next change after this ADR ships. File as tech-debt via `/hstack:tech-debt-new` once moso-app picks up the ADR.
- A `/hstack:advance` Skill that would mechanically flip change-spec status with precondition checks, eliminating the engineer-initiated `spec-author` invocations between workflow phases (largest remaining savings, ~75-125k tokens per change).
- `/hstack:adr-new` reciprocal-write half: when an ADR supersedes another, the `superseded-by` write on the older ADR is mechanical and should follow the pattern this ADR establishes. The Skill currently still routes through `spec-author` for that write. Same shape of fix as `/hstack:tech-debt-new`.
- Multi-module `change-spec.parent-change` ↔ `parent-change-spec.children` reciprocal writes: when a parent coordination change-spec exists, the reciprocal back-reference write is mechanical. The pattern is identical; no Skill currently handles it.
- A migration to backfill the `## Resolution Log` section into pre-template-update tech-debt artifacts. The three resolution Skills now check-and-create defensively, so this is convenience-only.
- A v2 substrate replacement for `/hstack:tech-debt-wontfix` step 3's keyword-heuristic deferral check — LLM-graded rationale assessment is the long-term answer (see Consequences/Negative).

## Consequences

### Positive

- Per-change savings of roughly **~75-100k tokens** on the mechanical-operation surface this ADR addresses (4 mechanical writes × ~25k each: tech-debt-new reciprocal, tech-debt-resolve TD flip, finalize change-spec flip, finalize TD resolution). For ~5 changes/week, that is roughly **375-500k tokens/week reclaimed**. The larger ~175-225k per-change figure (and ~1M/week) would require landing the deferred `/hstack:advance` Skill in addition — see Out of scope below.
- The Skill orchestrator becomes the authoritative writer for mechanical operations, which matches the precedent already set by `/hstack:change-new`.
- The kernel's rule reading is sharper and the boundary between authoring and mechanical work is now explicit, with a third category (structured-elicitation loops) honestly carved out for the per-question y/n + bounded-answer pattern that recurs in `/hstack:tech-debt-resolve` Pre-conditions walks and `/hstack:tech-debt-wontfix` interviews.
- `spec-author` invocations now reliably indicate genuine open-ended authoring work, making subagent traces easier to interpret in future audits.

### Negative

- Mechanical-write logic is duplicated across multiple Skills (each Skill carries its own "flip status + bump updated + run validator + commit" sequence). The duplication is small and the logic is templated, but it is real.
- Skills now carry more responsibility for atomicity. The previous "spec-author writes all of it in one call" pattern naturally produced one atomic write; the new pattern requires each Skill to be careful that reciprocal pairs land in the same commit and partial writes roll back cleanly.
- The kernel rule has to be read precisely. A future engineer reading "spec-author is the only subagent permitted to write" without the Mechanical operations section's clarification might re-introduce subagent-driven mechanical writes thinking they are required.
- **The new pattern depends more heavily on `hstack/scripts/validate-spec.ts`, which is still a `{{TODO-SCRIPT}}` placeholder in v1.** `spec-author` was a soft enforcer — it would refuse malformed input mid-interview and surface issues conversationally. Skills doing direct writes have no such soft layer; the post-write validator is the only contract check between the Edit and the auto-commit. Until the validator ships, mechanical writes that produce malformed frontmatter would land in the auto-commit unvalidated. The kernel's Mechanical operations section has been tightened to require the proposed-diff preview (not a summary) as the compensation mechanism until the validator exists — the engineer sees exactly what will be written before saying Y/n. The validator should be promoted to blocker-priority for this ADR's full realization; see "Out of scope, deferred to future work" below.
- **The wontfix deferral check (`/hstack:tech-debt-wontfix` step 3) is the most exposed discipline regression in this change.** Under the old pattern, spec-author's per-field conversational interview would re-engage the engineer if a wontfix-reason felt thin. Under the new pattern, the keyword heuristic ("later", "not a priority", etc.) running in the main session is narrower and more brittle — a determined engineer can pass with phrasing like "cost of fixing exceeds value, given current priorities" that is a deferral in substance, not vocabulary. The v2 substrate should replace the keyword check with an LLM-graded rationale assessment; until then, the engineer's own honesty is the load-bearing safeguard. This is the negative consequence to watch most carefully.
- **`/hstack:tech-debt-new` relies on spec-author obeying a per-invocation deferred-commit instruction.** Step 2 of the Skill explicitly instructs spec-author not to auto-commit at terminal author-state under this Skill, so both halves of the reciprocal pair (TD body + change-spec `creates-tech-debt` append) can land in one atomic commit by the Skill. This is a narrow tension with the rejection of Option C (general agent-wide flag) under Alternatives Considered. The two are distinguishable: Option C proposed an agent-wide conditional behavior change affecting all invocations; this is an explicit single-instruction context override on one invocation, and the audit trail is self-checking — a single commit at terminal state means atomicity held, two commits means spec-author auto-committed prematurely and the reciprocal pair split. The v2 substrate should add a spec-author behavior contract (`under-skill-orchestration: defer-commit: true`) that makes the override mechanical rather than prompt-obedient. Until then, the audit-checkable nature of the failure mode makes this an acceptable v1 risk; surface in adversarial-review if the commit pattern ever shows two commits where one was expected.

### Neutral

- No change to the audit trail's commit-message granularity or content. The same auto-commits land at the same status transitions; only the writer changes.
- No change to validator behavior. `validate-spec.ts` runs post-write either way.

### Challenge prompt — name two consequences that look bad

1. **Duplication of mechanical-write logic across Skills.** Five Skills now each carry their own four-step write sequence. If TD-04 ever gains a new reciprocity requirement (a new field that must always co-write with `resolved-by`), every Skill that performs a TD resolve must be updated. The mitigation would be a shared utility script under `hstack/scripts/` that Skills invoke via Bash for common transitions — deferred until duplication becomes painful.
2. **Loss of the spec-author confirmation-gate discipline.** spec-author's session-start protocol forces field-by-field confirmation with the engineer; mechanical operations do not have that gate. The engineer's invocation of the Skill IS the confirmation, but a misinvoked Skill (wrong change-id, wrong TD id) lands a status flip without per-field acknowledgement. The mitigation is the precondition checks each Skill already performs before any write.

## Alternatives Considered

**Option B — Lightweight new subagent (`spec-mechanic`).** A new subagent pinned to Haiku with a narrow tool surface (Read + Write + Edit + Bash) and a session-start protocol that loads only the kernel and the file being edited. **Rejected** because it still pays per-invocation context startup (~5k tokens on Haiku) for what could be a zero-token main-session write. The cleanest separation of concerns, but not the cheapest answer.

**Option C — `spec-author --mechanical` mode flag.** Same agent, conditional session-start behavior gated by an invocation flag. **Rejected** because LLM compliance with subtle conditional rules in prompts is unreliable; the agent might forget to skip context loads under pressure. The behavior would not be mechanically verifiable.

**Option D — Templated transitions in a shared script.** A shared `hstack/scripts/transitions.ts` that Skills invoke via Bash, encoding the mechanical patterns once. **Considered for future.** Worth doing once duplication across Skills becomes painful enough to maintain; not necessary for v1 since each Skill's transition logic is short and stable. Listed in the Decision's "out of scope" as a follow-up.

**Option E — Status no longer auto-committed; engineer edits frontmatter manually.** Rejected immediately; would break the kernel's "no parallel tracker" rule (the artifact's frontmatter is the state machine), the auto-commit-at-status-transition audit trail, and the validate-spec.ts discipline.

## Methodology references for future improvement audits

For the next engineer (or LLM) doing a similar audit, the reproducible steps are:

1. Walk `~/.claude/projects/<project-slug>/*.jsonl` for main-thread sessions; walk `<project>/<session-uuid>/subagents/*.jsonl` for subagent transcripts.
2. Parse `message.usage` per assistant turn; weight by `cost_score = input + 1.25 * cache_creation + 0.10 * cache_read + 5 * output` to get a billing-realistic ranking.
3. Attribute sessions to Skills via `/hstack:<name>` or `<command-name>` in user messages.
4. Read `.meta.json` for subagent attribution.
5. Compare pre-commit vs post-commit windows for model-pinning compliance.
6. For artifact-shape audits, compare template skeleton word count vs largest real output word count; if the ratio is >10×, investigate where the bloat lives (multi-pass preserved prose? per-item rationale? challenge prompts?).

The script used in this audit is preserved at `hstack/scripts/audit-token-usage.py`. Run with `python3 hstack/scripts/audit-token-usage.py` from the hstack repo root; output is a ranked table of Skills + their cost-scores plus a cache-effectiveness ratio. Edit the `TARGET_PREFIXES` constant in the script to point at a different consuming repo.
