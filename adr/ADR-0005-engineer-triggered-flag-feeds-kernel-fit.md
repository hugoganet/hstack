---
id: ADR-0005-engineer-triggered-flag-feeds-kernel-fit
type: adr
status: proposed
owner: hugoganet
decision-date: 2026-05-23
supersedes: null
superseded-by: null
related-change-specs: []
related-modules: []
promoted-from-kernel-fit: []
created: 2026-05-23
updated: 2026-05-23
schema-version: 2
---

## Title

Engineer-triggered `/hstack:flag` Skill feeds the kernel-fit closed loop with in-the-moment friction signal.

## Status

Proposed on 2026-05-23. No supersession. Complementary to ADR-0004 (kernel-fit closed-loop); this ADR adds a new input source to the same loop without changing its lifecycle, gating, or human-promotion contract.

## Context

ADR-0004 shipped a closed-loop system for detecting drift between the hstack kernel and shipped practice. Detection is post-hoc and derivative: `template/scripts/telemetry/insights/kernel_fit.py` pattern-matches across shipped change-specs, ADRs, tech-debt, halt sentinels, and adversarial-review findings, and the `kernel-fit-analyst` synthesizes findings from those patterns. Three starter patterns ship (KF-P1 / KF-P2 / KF-P3); new patterns are added by hand-editing `kernel_fit.py`.

The substrate works well for friction that *leaves a trace in frontmatter*. It works less well for friction that lives in the *moment* — an engineer noticing a Skill loop felt off, a subagent output that read wrong, a halt firing for an unexpected reason, a Skill producing a confirmation diff that revealed an assumption the kernel did not name. None of these necessarily produce a shipped artifact that a hand-written pattern would catch. The transcript window around the friction moment carries the signal; the post-hoc detector cannot see it.

The available paths for surfacing such friction are too heavyweight to fit the cadence. Filing a tech-debt item requires the six-section `spec-author` interview. Authoring an ADR requires the Nygard interview and the Consequences challenge prompt. Writing a research session requires a query and a mode. Each is appropriate for its own purpose; none fits "I noticed something off, keep moving." In practice the engineer either halts the current work to capture the friction (high friction cost, low odds of doing so) or keeps working and loses the signal entirely.

The triggering observation. While drafting this ADR's predecessor design sketch with Claude, the cofounder explicitly named the shape: a button that drops a pointer to *the moment* — timestamp, session-id, branch, HEAD — and lets a downstream LLM read the transcript and reason about what was happening. The engineer carries zero authoring burden; the LLM does the interpretation. This is structurally the complement to the kernel-fit-analyst's "explicitly no implementer transcripts" rule: the analyst already refuses to read implementer transcripts to avoid contamination, but the *engineer's own* transcript around a flagged moment is a legitimate, bounded, engineer-authorized input.

The constraint. The pin must be near-zero-friction or it will not get used. A confirmation dialog, a one-line description prompt, a category picker — any of these defeats the mechanism. The pin also must not carry engineer interpretation of the friction, because doing so re-opens the contamination surface the analyst already guards against; the LLM forms its own classification from the transcript window. Both constraints are load-bearing.

Three resolutions were evaluated:

- **(A)** Do nothing. Friction not captured by the existing detector patterns goes uncaptured. Engineers who want to surface friction use the existing heavyweight paths (tech-debt / ADR / research) or do not surface it.
- **(B)** Extend `/hstack:tech-debt-new` with a `--quick` mode that skips the six-section interview and just captures session metadata. Reuses existing machinery; no new Skill.
- **(C)** Ship a dedicated `/hstack:flag` Skill that writes a tiny, frontmatter-only pin to `hstack/kernel-fit/flags/pending/`, plus a processing extension on `kernel-fit-analyst` that reads each pin's transcript and folds-or-emits a finding.

## Decision

Ship Option C: the dedicated `/hstack:flag` Skill plus the analyst processing extension.

**Layer 1 — Skill.** A new Skill at `template/.claude/skills/hstack-flag/SKILL.md` invoked as `/hstack:flag` (with optional positional `<hint>` argument). The Skill orchestrates no subagent — per ADR-0001, the values to write are determined entirely by the invocation context (current `git rev-parse HEAD`, `git rev-parse --abbrev-ref HEAD`, working directory, the active Claude Code session-id, current transcript message count). The Skill writes one file to `hstack/kernel-fit/flags/pending/<timestamp>-<session-id-short>.md` and exits. No interview, no confirmation gate, no diff preview, no commit. Total wall-clock budget: <1s. Friction in flagging defeats the mechanism, so the Skill is a strict one-shot.

**Layer 2 — Pin artifact.** A new template at `template/templates/kernel-fit-flag.md` with frontmatter-only content (no body). Fields: `id`, `type: kernel-fit-flag`, `status: pending | processed`, `session-id`, `session-transcript-path`, `branch`, `head`, `workspace`, `timestamp`, `pre-compaction-message-count`, `hint: null | <one-word string>`, `classification: null | friction | missing-guardrail | kernel-vs-practice-mismatch | not-actionable | transcript-truncated`, `classification-rationale: null | <one-line string>`, `folded-into: null | <KF-id>`, `emitted-as: null | <KF-id>`. Two validator rules: FL-01 (required fields present and non-null at pin-time: `session-id`, `session-transcript-path`, `timestamp`, `head`, `branch`, `pre-compaction-message-count`); FL-02 (`classification` non-null when `status: processed`, with `classification-rationale` also non-null). The `hint` field defaults to null and is populated only when the engineer passes the positional argument. The pin carries no engineer interpretation of the friction — the LLM forms classification from the transcript window.

**Layer 3 — Analyst processing extension.** The `kernel-fit-analyst` subagent (`template/.claude/agents/kernel-fit-analyst.md`) gains one new section in its system prompt: **Pending Flags Processing**. The load-at-session-start instruction list adds `hstack/kernel-fit/flags/pending/*.md`. Processing loop per pin, ordered by `timestamp` ascending: (1) open `session-transcript-path` and compare current message count vs `pre-compaction-message-count`; if current is lower, classify `transcript-truncated` and skip; (2) otherwise read the ~50 turns immediately preceding `timestamp` (or as many as exist), form a one-line `classification-rationale`, set `classification` to one of the enum values; (3) decide fold-vs-emit-vs-close — fold (`folded-into: KF-NNNN`) when friction maps onto an existing in-flight finding's pattern and kernel surface, emit (`emitted-as: KF-NNNN`, finding written with `detected-via: flag`) when friction surfaces a new gap, close when classification is `not-actionable` or `transcript-truncated`; (4) move the pin from `pending/` to `processed/`. The analyst is forbidden from re-processing pins already in `processed/` — re-evaluation requires a fresh flag from the engineer.

**Layer 4 — Kernel-fit-finding schema delta.** One new optional field on `template/templates/kernel-fit-finding.md`: `detected-via: detector | flag` (default `detector` for backwards compatibility, no schema-version bump required since the field has a safe default). Findings emitted from flags carry `detected-via: flag` and a single evidence row pointing at the originating pin id. Findings folded with a flag-derived evidence row append the row under the existing evidence array; `detected-via` remains `detector` because the originating signal was the detector pattern, not the flag.

**Layer 5 — Notification & kernel section.** The existing `/hstack:kernel-fit-scan` Slack nudge gains a one-line tail summary: "N pins processed: M folded, K emitted, L not-actionable, J transcript-truncated." Threshold-gated identically to the rest of the nudge — silent if all classifications were `not-actionable`. The kernel's `## How hstack improves itself` section gains one paragraph naming the engineer-triggered side of the loop and pointing to this ADR. No new halt-sentinel enum value is required; the Skill cannot halt under stop conditions because it does not gate on preconditions (it is additive and out-of-band from the lifecycle state machine).

**Gitignore decision.** `hstack/kernel-fit/flags/` is git-ignored in the consuming repo, mirroring the `.telemetry/` sidecars' derivative-cache treatment from ADR-0004. Pins are signal, not lifecycle state; the audit trail lives at the finding layer (committed) once the analyst processes them. A pin that is never processed (e.g., the engineer flagged in a workspace that no scan ever ran in) is lost on the next clean — this is acceptable because the engineer's only friction cost was the single Skill invocation, and re-flagging is cheap.

**Session-id capture.** The Skill reads the active Claude Code session-id via the most-recently-modified `*.jsonl` file under `~/.claude/projects/<encoded-workspace-path>/`. This is a heuristic, not a guaranteed-correct source, but it is correct in the common single-session case. If the harness exposes a session-id env var or settings hook in a future release, the Skill switches to that path. Until then, a tech-debt item (TD to be filed alongside the implementing change-spec) tracks the v2 migration. Interleaved sessions on the same workspace are a known edge case the v1 heuristic does not handle perfectly — the analyst's `transcript-truncated` classification is the safety net.

The boundary that defines what `/hstack:flag` is and is not: the Skill captures a *pointer to a moment* and nothing else. It does not write findings, does not invoke subagents, does not gate on lifecycle state, does not modify any other artifact. The analyst extension is the load-bearing piece; the Skill is the thinnest possible feeder. This separation preserves the human-gated promotion contract from ADR-0004 — pins surface signal, findings get triaged, findings get promoted, ADRs get authored. The flag is not a shortcut around any existing gate.

Concrete scope:

- Three new artifacts (Skill, pin template, ADR — this file) plus the analyst-prompt extension.
- Four files modified (kernel paragraph, kernel-fit-finding template's `detected-via` field, kernel-fit-analyst load-list, `/hstack:kernel-fit-scan` Slack-nudge composer).
- One consumer-wiring symlink entry per consuming repo (matching the pattern from every prior Skill addition).
- Two implementation phases: phase-1 ships the Skill + pin template + gitignore + kernel paragraph (the Skill becomes invocable, pins accumulate, no analyst processing yet); phase-2 ships the analyst extension + Slack-nudge tail + `detected-via` field (pins start being processed). The split is intentional: phase-1 is safe-by-default — pins land on disk and stay there until phase-2 ships, no behavioral surprise.

Out of scope:

- Cron-driven auto-processing of pending pins. Processing happens during `/hstack:kernel-fit-scan` only — same human-gated invocation discipline as the rest of the loop. The engineer chooses when to scan.
- Semantic deduplication of pins. Each pin is processed independently. If the engineer flags three times in a row about the same friction, that is three pins and three classifications. A high duplicate-rate becomes its own signal in the Slack nudge's tail summary.
- Cross-session pin aggregation. Each pin is tied to one session-id. A multi-session friction story is not reconstructed by the analyst.
- A `/hstack:flag --list` companion Skill. Out of scope until there is evidence engineers need it; `/hstack:help` is the right surfacing path (separately tracked).
- A `/hstack:unflag <pin-id>` Skill to retract a pin. Pins are immutable once written. If the engineer regrets a flag, the analyst will classify it `not-actionable` and close it on the next scan — same outcome at lower complexity.
- Pin authoring by anything other than the Skill. The kernel's "no manual frontmatter writes for lifecycle artifacts" rule applies; even though pins are derivative-signal rather than lifecycle, hand-authored pins would carry engineer interpretation and re-open the contamination surface the analyst guards against.

## Consequences

### Positive

- The kernel-fit loop gains a new input source that captures friction the post-hoc detector patterns cannot see by construction. Detector patterns operate on shipped frontmatter; flags operate on the lived transcript. The two complement each other rather than overlap.
- The engineer's authoring burden is zero. One Skill invocation, optionally with a one-word hint, completes in <1s with no interview, no confirmation, no commit. This matches the cadence of mid-flow friction noticing — anything heavier would not get used.
- The pin carries no engineer interpretation, so the analyst's "no contaminated input" discipline is preserved. The analyst reads the transcript and classifies independently; the engineer cannot bias the classification by writing prose into the pin.
- Phase-1 ships safely without phase-2. Pins accumulate harmlessly on disk between phases; no behavioral change to existing Skills, subagents, or findings until phase-2 lands.
- The classification enum produces auditable structure. `not-actionable` and `transcript-truncated` close-out reasons are recorded explicitly, so over time the engineer can see which fraction of flags produced findings and adjust flagging behavior accordingly.
- The gitignored-pin decision preserves the kernel's no-parallel-tracker rule. Pins are derivative signal (same shape as `.telemetry/` sidecars); the committed audit trail lives at the finding layer where it has always lived.

### Negative

- The session-id capture mechanism is heuristic in v1. The most-recently-modified-jsonl approach is correct in the common single-session case but lossy when multiple sessions interleave on the same workspace, when the engineer flags from a Skill running inside a different harness, or when Claude Code's transcript-storage layout changes in a future release. The `transcript-truncated` classification is the safety net, but it converts a fraction of pins into lost signal rather than recovered signal. Mitigation: a tech-debt item tracking the v2 migration to a harness-exposed session-id will be filed alongside the implementing change-spec. The cost of the v1 heuristic is real and acknowledged here rather than hidden.
- Friction-noticing is itself a skill engineers vary in. Some engineers will flag prolifically (producing a noisy pending folder dominated by `not-actionable` classifications); others will never flag and the mechanism produces no value for them. The kernel cannot equalize this. Mitigation: the Slack-nudge tail summary surfaces the per-engineer flag rate implicitly via the processed-pin counts, which is itself a kernel-fit signal — wildly different flag rates across a small team is evidence that the Skill's affordances are not landing evenly.
- The analyst's processing loop adds work to every `/hstack:kernel-fit-scan` invocation, including scans where the pending folder is empty. The marginal cost is small (the analyst already loads several megabytes of context; an extra glob for `flags/pending/*.md` is negligible), but it is paid every scan regardless of pin volume. Mitigation: the analyst's processing loop short-circuits cleanly when the pending folder is empty; the new instructions add no token cost when there is nothing to process.

### Neutral

- No new validator rules executable until `validate-spec.ts` ships (still `{{TODO-SCRIPT}}` per ADR-0001's v1 honesty note). FL-01 and FL-02 are documented in the template's frontmatter contract but enforced only by the proposed-diff preview at write-time — same limitation every other Mechanical-ops Skill carries today.
- No change to the canonical workflow's commit-message granularity. The Skill does not commit. The analyst's findings (when emitted from flags) commit through the same path as findings emitted from detector patterns.
- The new `detected-via` field on `kernel-fit-finding.md` defaults to `detector`, so existing findings remain valid without rewrites. No schema-version bump required.
- The kernel section addition is one paragraph under `## How hstack improves itself`, parallel to the existing five-layer description. No reorganization of the section is required.

### Challenge prompt — name two consequences that look bad

1. **The Skill introduces a feedback channel whose signal-to-noise ratio is bounded by the engineer's calibration, not the kernel's discipline.** Every other hstack authoring path — change-spec, tech-debt, ADR, research, story — runs the engineer through a structured interview that imposes a minimum standard on what gets captured. The flag deliberately strips that structure away because friction-noticing is the value. The cost is that an engineer who flags reflexively (every halt, every confusing output, every Skill that took longer than expected) produces a pending folder where most classifications are `not-actionable`, and the analyst's classification rationale becomes the only audit trail explaining why each flag was closed. The kernel does not constrain flagging cadence; the engineer's judgment is the only filter at the input stage. If that judgment is poor or inconsistent, the mechanism produces work for the analyst without producing kernel changes. The mitigation (Slack-nudge tail summary surfacing rates) is observability, not constraint.

2. **The decision to gitignore pins makes the input layer of the loop unreproducible from git alone.** Every other kernel-fit input — change-specs, ADRs, tech-debt, halt sentinels — is reconstructible from git history. Pins are not. A pin that lands on disk and is deleted before any scan runs leaves no trace in the repo. A team auditing "why did finding KF-0042 get emitted?" can trace the finding back to its pin id, but if that pin file has been cleaned (because it landed on a workspace that never ran a scan, or because the engineer cleared their working tree), the originating signal is gone. This is the price paid for not polluting git history with derivative cache files, and it matches the `.telemetry/` decision in ADR-0004, but it does create one provenance gap that does not exist for any other artifact type in the loop. The kernel does not surface this gap automatically; an adversarial reviewer auditing a flag-emitted finding will need to know the pin file may not be retrievable.

## Alternatives Considered

**Option A — Do nothing.** Friction not captured by the existing detector patterns goes uncaptured. **Rejected** because the value proposition of ADR-0004's closed loop is bounded by the patterns hand-written into `kernel_fit.py`; the meta-problem ADR-0004 already names ("the system cannot answer 'what fraction of kernel surfaces are covered by at least one detection pattern'") is exactly the gap this Skill closes from the opposite direction. Doing nothing leaves the gap unaddressed and locks the loop's sensitivity to the rate at which engineers write new detector patterns.

**Option B — Extend `/hstack:tech-debt-new --quick` to capture session metadata.** Reuses existing machinery; no new Skill, no new artifact type. **Rejected** because tech-debt items are lifecycle artifacts (they have a status machine, reciprocal links, terminal states) and pins are not. Conflating the two would either (a) force pins to carry the tech-debt lifecycle they do not need, or (b) introduce a sub-mode of tech-debt that breaks the artifact-type invariant. The cleaner separation is two artifact types: tech-debt for "we know what's wrong and we choose to live with it," flag for "something happened, look here later." The category boundary is load-bearing.

**Option C — Dedicated `/hstack:flag` Skill plus analyst processing extension.** **Adopted.** The Skill is the thinnest possible feeder into the loop; the analyst extension does the interpretive work. The two pieces follow patterns that already exist in the kernel (Skill shape mirrors `hstack-commit`'s mechanical-write discipline, pin template shape mirrors `kernel-fit-finding`'s frontmatter-only metadata, analyst extension parallels the existing detector-pattern processing). The human-gated promotion contract from ADR-0004 is preserved end-to-end — flags surface signal, the analyst writes findings, findings get triaged, findings get promoted. No new gate is bypassed.

**Option D — Auto-process pins on a cron, independent of `/hstack:kernel-fit-scan`.** Run the analyst against `flags/pending/` on a schedule (daily, weekly). **Rejected** because it violates the human-gated invocation discipline that ADR-0004 deliberately preserved. The engineer chooses when to scan; auto-processing converts the loop from human-supervised to event-driven, which the kernel's "AI writes, humans confirm" contract explicitly forbids at the kernel-modification layer. The cost (engineer remembers to scan) is the contract.
