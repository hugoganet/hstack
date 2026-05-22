---
id: ADR-0004-kernel-fit-closed-loop
type: adr
status: proposed
owner: hugoganet
decision-date: 2026-05-22
supersedes: null
superseded-by: null
related-change-specs: []
related-modules: []
promoted-from-kernel-fit: []
created: 2026-05-22
updated: 2026-05-22
schema-version: 2
---

## Title

Kernel-fit closed-loop system for self-improvement of the hstack kernel.

## Status

Proposed on 2026-05-22. No supersession.

## Context

The kernel is the single source of truth for hstack workflows, but it has no mechanism to detect when its own contracts — status lifecycles, template fields, Skill preconditions, halt-enum coverage, frontmatter flags — are mismatched with how engineers and AI agents use them in practice. ADR-0001 (mechanical ops by Skills) and ADR-0002 (`/hstack:verify` owns the `ready-for-review` transition) were both reactive fixes: each codified a gap that engineering practice had already revealed through friction or adversarial-review findings. Neither could have been surfaced earlier; the kernel does not look at itself.

The triggering observation. An engineer noticed during change planning that the `internal-tooling: true` flag conflated two semantically distinct cases: (A) true internal tooling that never ships on a user path (engineering scripts, CI tooling, dev dashboards), and (B) production code that ships to users but whose user-observable behavior is deferred to a downstream consumer change-spec (foundational prerequisites, plumbing changes). The audit-cost difference was real: Category B has user value that lives elsewhere in the change graph, and an auditor reconstructing user-value flow could not follow that link if the kernel never recorded it.

**Status update (post-PR-#5).** This specific gap was structurally closed by PR #5 (`feat(kernel): split internal-tooling carve-out into Category A + Category B (enables)`), which introduced `enables: []` / `enabled-by: []` fields, SP-13 (mutually exclusive) and SP-14 (reciprocity). This ADR proceeds anyway because the seed case is exemplary, not exhaustive. The user explicitly asked for a *general* mechanism for detecting gaps like this rather than a one-off flag-splitting fix — the conflation pattern recurs across every controlled-vocabulary field in the kernel, and per-case fixes do not generalize. PR #5 and this ADR are complementary: PR #5 closes one named case; this ADR ships the detector that catches future cases (including the post-PR-#5 failure mode where an engineer claims Category A but the in-scope reveals Category B — see KF-P1's retargeted logic).

The substrate already exists. `template/scripts/telemetry/` ships five insight modules (token-economics, workflow-shape, quality-outcomes, overengineering, contract-drift) that evaluate engineering practice against the kernel. None of them evaluate the kernel itself. The data they operate on — git commits, frontmatter, transcripts, halt sentinels, sidecars — is exactly the substrate that would support detection of kernel-fit gaps. The kernel's "no parallel tracker" rule is preserved by reusing this substrate because every detection is reconstructible from git and frontmatter; nothing new becomes a parallel source of truth.

The constraint. The user explicitly required that the loop never auto-create ADRs or change-specs. Detection and synthesis can be automated; promotion to a kernel change must remain a human-invoked, human-gated step. The kernel's "AI writes, humans confirm" contract applies particularly forcefully at the kernel-modification layer, where the cost of a bad ADR cascades through every subsequent change.

Three resolutions were evaluated:

- **(A)** Add a per-flag fix to split `internal-tooling` into `internal-tooling | foundational-prerequisite`. Solves the immediate case via a targeted template edit and a validator-rule addition.
- **(B)** Bundle kernel-fit detection into `/hstack:telemetry` as a section in the existing report. No new Skills, no new template, no new artifact type.
- **(C)** Ship a five-layer closed-loop subsystem (detection → synthesis → finding artifact → triage → human-gated promotion) with three new Skills, one new subagent, one new insight module, one new template, and a kernel section addition.

## Decision

Ship Option C: the five-layer kernel-fit closed-loop system.

**Layer 1 — Detection.** A new Python insight module at `template/scripts/telemetry/insights/kernel_fit.py` with a `compute(commits, changes, tech_debt, adrs, module_specs, session_rows, findings_dir) -> dict` signature consistent with the five existing insight modules. Three starter patterns: **KF-P1** (`category-a-claim-spans-production-paths`) detects engineers claiming Category A (`internal-tooling: true`) when in-scope reveals Category B (production paths AND empty `enables`) — the post-PR-#5 evolution of the seed case; **KF-P2** (`halt-reason-cluster-uncovered-by-enum`) for missing halt-sentinel enum coverage; **KF-P3** (`skill-precondition-violated-and-recoverable`) for the ADR-0002 pattern. Detection is pure read; no writes. Wired into `report.py` at the existing insights import block.

**Layer 2 — Synthesis.** A new subagent at `template/.claude/agents/kernel-fit-analyst.md`, model `opus`, that loads kernel + telemetry report + every prior finding + all change-specs at `status: shipped` + all ADRs + all tech-debt + all module-specs, and explicitly *not* implementer transcripts (mirroring `adversarial-reviewer`'s session-isolation rule). The analyst produces one finding file per pattern that fires (atomic, no bundling), each with a mandatory two-bullet counter-explanation. The analyst never writes ADRs, change-specs, or edits existing findings except to mark them `superseded`.

**Layer 3 — Finding artifact.** A new template at `template/templates/kernel-fit-finding.md` with frontmatter carrying `id: KF-NNNN-<slug>`, `status` lifecycle (`open → acknowledged → promoted` for actionable findings; `open → dismissed` for non-actionable; `open → superseded` for restated findings), `confidence` enum, `evidence-rows` array, `promoted-to` back-reference. Five validator rules KF-01..KF-05. Findings live at `hstack/kernel-fit/findings/KF-NNNN-<slug>.md` in the consumer repo; the directory is user-owned (added to `src/manifest.ts USER_CONTENT_PATHS`) so `npx hstack update` never overwrites triage state.

**Layer 4 — Skills.** Three new Skills, all following the patterns established by `hstack-research` (orchestration + promotion routing) and ADR-0001 (mechanical writes by Skill orchestrator). `/hstack:kernel-fit-scan` orchestrates detection + synthesis + Slack nudge. `/hstack:kernel-fit-triage <id> --action acknowledge|dismiss --reason <text>` is a mechanical status flip. `/hstack:kernel-fit-promote <id> --slug <adr-slug>` routes to `/hstack:adr-new --from-kernel-fit <id> --slug <slug>` (mirroring the `--from-research` pattern at `hstack-research/SKILL.md:92`). The promote Skill writes the reciprocal `promoted-to` back-reference atomically with the ADR commit, per the kernel's reciprocal-pair atomicity rule.

**Layer 5 — Notification.** Slack nudge via `mcp__claude_ai_Slack__slack_send_message` at the tail of `/hstack:kernel-fit-scan`. Threshold-gated (notify on `high` and `medium` confidence; `low` lands silently on disk). De-duplicated (14-day window per `pattern`). Graceful degradation: if Slack MCP is unreachable or unwired, log to stderr and exit 0 — the disk write is the load-bearing action, Slack is a side-channel. This is a deliberate carve-out from the kernel's general MCP-unreachable stop condition (CLAUDE.md line 337) and is documented as such in the Skill's Failure modes section.

**Kernel integration.** One new section in `template/CLAUDE.md` — `## How hstack improves itself` — inserted before `## References`, ~250 words describing the five-layer loop and the human-gate-on-promotion contract. One new entry in the subagent load-at-session-start list (`kernel-fit-analyst`, between `adversarial-reviewer` and `researcher`). One new optional frontmatter field on `template/templates/adr.md` (`promoted-from-kernel-fit: []`); schema-version bumped 1 → 2 to make the reciprocal back-reference (KF-04) mechanically checkable once `validate-spec.ts` ships. No new halt-sentinel enum value is required — the existing enum covers all kernel-fit needs.

The boundary that defines what kernel-fit is and is not: the system detects *patterns in the kernel's contracts* misaligning with *patterns in shipped practice*. It does not detect bugs in individual changes, code-quality issues, or security gaps — those are owned by the existing telemetry insights, adversarial-review, and security-review respectively. Kernel-fit is meta-machinery about the kernel itself.

Concrete scope:

- Six new artifacts created (template, subagent, insight module, three Skills) plus this ADR.
- Five files modified (kernel, ADR template, two telemetry files, manifest.ts, hstack-telemetry SKILL.md one-liner).
- Six atomic implementation phases, ordered bottom-up (contract first, detection next, automation last); each phase ships value standalone.
- v1 honesty: the analyst's output is an LLM-strategized judgment, not measured truth; the counter-explanation challenge prompt is the false-positive mitigation. Same framing rule as `test-strategist` and `security-reviewer`.

Out of scope:

- ML-based pattern detection. Patterns are hand-written Python rules in v1; adding a pattern requires editing `kernel_fit.py`. v2 substrate could move detection to LLM-judge classifiers for patterns the rules don't cover.
- False-positive feedback loop. Dismiss-reasons are recorded but do not feed back into detector tuning.
- Cross-repo aggregation. Each consumer repo runs its own loop in isolation.
- Coverage measurement. The system cannot answer "what fraction of kernel surfaces are covered by at least one detection pattern."
- Semantic-similarity dedup. Dedup is based on `pattern` field equality only; semantic clustering is v2.
- Auto-execution of the promotion. The human-invoked `/hstack:kernel-fit-promote` is the contract; no cron or event-driven promotion exists.

## Consequences

### Positive

- The kernel becomes a learning artifact rather than a frozen one. Drift between kernel and shipped practice surfaces within roughly one telemetry window rather than after enough friction to motivate an ad-hoc ADR. ADR-0001 and ADR-0002 were both reactive; ADR-0004 and later can be proactive when the loop is running.
- The detection-synthesis-finding-triage-promotion pattern is reusable. Future closed-loop subsystems (security-fit, performance-fit) could follow the same five-layer shape without inventing new architecture.
- The `kernel-fit-analyst`'s explicit no-implementer-transcripts rule mirrors `adversarial-reviewer` and inherits the same v1 honor-system / v2 session-id verification path. No new enforcement substrate is required.
- Zero changes to engineer-facing per-change workflow. Engineers who never run `/hstack:kernel-fit-scan` see no difference in their day-to-day. The system is opt-in by Skill invocation.
- The Slack nudge respects the kernel's "the disk artifact is canonical" rule — Slack is a side-channel pointer, not the authoritative state. Findings still land on disk if MCP is unreachable, preserving the no-parallel-tracker discipline.
- The human-gated promotion contract closes the loop without ceding kernel-change authority to the LLM. `/hstack:adr-new`'s existing `spec-author` interview is the gate, exactly as the user required.

### Negative

- Five new pieces of machinery (Skills × 3, subagent, insight module, template) plus kernel-section addition. Maintenance surface grows. Mitigation: every new piece follows an existing pattern (Skill from `hstack-research`, subagent from `adversarial-reviewer`, template from `tech-debt.md`, insight from `contract_drift.py`), so the cognitive cost is incremental rather than novel.
- False-positives are likely in the first 4–8 weeks of operation. Synthesis is LLM-driven; the counter-explanation challenge mitigates but does not eliminate. The engineer will spend time triaging dismissals. Mitigation: dismissals are recorded and visible to future scan runs; the dedup gate prevents repeat-notification on the same pattern within 14 days.
- The system adds a meta-loop to a workflow whose existing structure is already complex. Engineers who don't read the new `## How hstack improves itself` section may be confused by Slack messages referencing patterns they haven't seen before. Mitigation: Skill output is verbose by design (citing prior findings, evidence, kernel surfaces) which costs reading time but reduces interpretive ambiguity.
- The cold-start cost is real. Pattern detection needs N≥5–10 shipped changes per pattern before findings are statistically meaningful. On a brownfield repo with a fresh hstack adoption, the loop produces little value for the first month or two; on a fully-bootstrapped consumer it produces value immediately. This is documented in the Skill's preconditions (≥3 shipped changes minimum to run).

### Neutral

- No change to the canonical workflow's commit-message granularity. New `kernel-fit:` commit prefixes appear in the git log only when the new Skills are invoked.
- No new validator rules executable until `validate-spec.ts` ships (still a `{{TODO-SCRIPT}}` placeholder); KF-04 and KF-05 are bypassable via direct frontmatter edit in v1. Same limitation every other Mechanical-ops Skill carries today; proposed-diff-preview gate (CLAUDE.md line 184) is the v1 substitute.
- The ADR template's schema-version bump (1 → 2) requires consumers running `npx hstack update` to migrate existing ADRs only if they want to populate `promoted-from-kernel-fit`. The field is optional with default `[]`, so existing ADRs remain valid under schema-version 2 without rewrites.

### Challenge prompt — name two consequences that look bad

1. **The new subsystem is the first piece of hstack machinery whose primary purpose is to suggest changes to hstack itself.** Every other Skill and subagent produces artifacts for the consumer repo's domain (change-specs, tech-debt, security-reviews, etc.). The `kernel-fit-analyst` produces findings about the kernel — that is, about its own infrastructure. This creates a circular dependency in the audit chain: an adversarial reviewer asked "did the kernel-fit-analyst correctly identify this gap?" must reason about the kernel itself, but the kernel is what produced the analyst's instructions. There is no neutral ground for evaluation. The mitigation is the human-gated promotion contract: humans remain the deciders. But the analyst's framing (which patterns it surfaces and which it doesn't) shapes the human's decision space in ways the human cannot audit independently. This is structurally identical to the meta-problem ADRs face — ADRs decide architecture but cannot themselves be evaluated outside the architecture they exist within — and the kernel-fit-analyst inherits the same epistemic limit.

2. **The Slack nudge is the first hstack mechanism whose successful operation depends on a side-channel the kernel does not control.** The disk write is canonical and the Slack send is best-effort, but the *engineer's reading of the disk* depends on noticing that findings exist. Without Slack, no notification fires; findings can accumulate silently for weeks on a repo where no engineer happens to run `/hstack:help` or `/hstack:kernel-fit-scan` manually. The risk is that the loop appears to be running (the analyst writes findings; the Skill exits 0) but the human side of the loop never closes (no triage, no promotion, no kernel change). The mitigation is that `/hstack:help` should surface open findings — this is a small future addition implied by the new artifact type but not in scope for this ADR. Until that lands, the system can silently fail to close the loop on a repo whose Slack MCP is unwired, in a way the kernel does not surface and no validator will catch.

## Alternatives Considered

**Option A — Per-flag fix for `internal-tooling`.** Split the flag into Category A (`internal-tooling: true`) and Category B (`enables: [...]`), add validator rules that require reciprocity and mutual exclusivity, and ship a kernel-section addition naming the distinction. **Shipped separately as PR #5** (1b329fd) under the slug `category-b-enables-field`. PR #5 closed the named gap structurally — engineers can no longer accidentally conflate the two cases at authoring time because SP-13 catches mutual-exclusivity violations and SP-09 expansion routes story-less changes to one of the two categories explicitly. This ADR **complements rather than competes with PR #5**: A fixes the case the engineer pointed to; this ADR ships the general detector that catches future cases of the same shape (including KF-P1's retargeted logic, which catches the post-PR-#5 failure mode where the engineer mis-classifies Category B as Category A by claiming `internal-tooling: true` despite production-path in-scope). The original framing of A as "rejected" was based on the framing question "which one fix?" — once both can ship, the right answer is both.

**Option B — Bundle kernel-fit detection into `/hstack:telemetry` as a section.** Add a `_render_kernel_fit_section` function to `render.py`; emit kernel-fit candidates in the standard report at `hstack/telemetry/reports/<date>.md`. No new Skills, no new subagent, no new template, no new artifact type. **Rejected** because telemetry's report is *derivative* (re-runnable, never authoritative). Kernel-fit findings need to be *durable* (engineer-triaged, with status transitions, with promotion lineage). Putting them in the same report would mix lifecycle-managed and ephemeral content and violate the kernel's no-parallel-tracker rule by making the canonical state of a finding ambiguous (is it the dated report row or the latest report row?). The compromise adopted in Option C: the standard report's existing watch-list gains a one-paragraph kernel-fit subsection linking out to `hstack/kernel-fit/findings/`, but the findings themselves live as their own artifact type.

**Option C — Five-layer closed-loop subsystem.** **Adopted, alongside PR #5's Option A.** The structure scales beyond the `internal-tooling` case; the human-gated promotion respects the user's explicit constraint; the substrate reuses existing telemetry infrastructure; every component follows a pattern that already exists in the kernel. The cost is real (new machinery to maintain) and acknowledged in the Consequences. The benefit is that hstack becomes self-aware in a bounded, auditable, human-supervised way. The relationship to Option A: PR #5 closes one named gap; this ADR ships the detector that catches the *class* of gap PR #5's case belongs to. KF-P1 is retargeted post-PR-#5 to detect the new failure mode the new schema can have (Category-A claim with production-path in-scope — engineer mis-classified Category B as A) rather than the pre-PR-#5 conflation.

**Option D — Auto-create ADRs when a high-confidence finding fires.** Skip the human triage step; let the loop be fully closed from detection through ADR creation. **Rejected explicitly by the user** ("agent should ask a human before creating ADR at all"). The kernel's "AI writes, humans confirm" contract is most load-bearing at the kernel-modification layer. An auto-created ADR that ships a bad kernel change cascades through every subsequent change; the cost of a bad ADR vastly exceeds the friction of an extra human-invocation step. The contract is non-negotiable.
