---
id: ADR-0009-per-phase-token-instrumentation
type: adr
status: accepted
owner: hugoganet
decision-date: 2026-08-15
supersedes: null
superseded-by: null
related-change-specs: []
related-modules: []
promoted-from-kernel-fit: []
created: 2026-08-15
updated: 2026-08-15
schema-version: 2
---

## Title

Phase cost becomes measurable: the telemetry sidecars gain a session id and a phase time-window, and the report parser sums transcript usage between those bounds. Skill attribution stops matching free text and reads only structured invocation markers. Amends ADR-0001's sidecar payload and the `token_economics` insight; the sidecar's derivative, gitignored, never-authoritative status is unchanged.

## Status

Accepted on 2026-08-15. Ships as one PR: the sidecar schema addition in `template/templates/telemetry-sidecar.md` and the five emitting Skills, the summation in `template/scripts/telemetry/parsers/transcripts.py`, the attribution fix in `classify_session`, the new rows in `insights/token_economics.py`, and the UI's `TelemetryReport` type. Triggered by a token-consumption audit that could not answer "what does a phase cost?" from the existing instrumentation.

## Context

A context-engineering audit of this machine's Claude Code transcripts established that consumption is driven by per-session context size, not by session count: 8% of sessions peak above 400k tokens of context and account for 57% of all context tokens consumed; 2% above 600k account for 23%. Average context per turn rose from 114k (May) to 328k (August) while cost per turn stayed flat. The lever is where context accumulates inside the per-change workflow — which phase, on which change.

The existing instrumentation cannot answer that. Two independent defects:

**1. No phase end-marker.** `classify_session` assigns one Skill per session, taken from the first hstack invocation, and `token_economics` attributes the session's whole usage to it. A Skill has a start marker and no terminal marker, so every token spent after the invocation — including all subsequent phases and unrelated work — lands in the first bucket. Measured consequence: `/hstack:flag`, a Skill that completes in under a second, is credited with 24M tokens and 43 turns; `/hstack:ship`, read-only, with 34.3M per invocation. TE-1's own note already concedes the limit ("v1 attribution is per-Skill, not per-change") but understates it — the attribution is not coarse, it is wrong.

**2. Text-matched attribution.** `classify_session` (`parsers/transcripts.py:103`) runs `HSTACK_SLASH = /hstack:([a-z][a-z0-9\-]*)/` against the flattened text of the first user message. Any prompt that *mentions* a Skill captures the session. Session-kickoff prompts routinely contain "Run `/hstack:coord` at session start", and ADR-0007's hook injects a line naming `/hstack:coord`. Measured on 30 days of moso-app transcripts: 72 of 436 classified sessions (17%) are captured by `coord`, and because those are the long orchestration sessions, TE-2 credits `coord` with 6.3 billion cache-read tokens — roughly half the measured total, ahead of every real Skill. The number is an artifact of a regex, and it is currently the headline row of the token-economics table.

The constraint that shaped ADR-0001's sidecars is unchanged and must survive: the sidecar is derivative of git plus frontmatter, re-runnable from source, gitignored in the consumer, never authoritative. Nothing here may become a parallel tracker.

One fact makes the fix cheap: Claude Code transcripts already carry a per-turn `usage` object and an ISO timestamp on every assistant record, under a stable path derived from the working directory. `/hstack:flag` already locates the active session id this way. Bounding a phase therefore requires no new measurement channel — only two timestamps and a session id written where the sidecar already lands.

## Decision

Four pieces.

**1. Sidecar gains a phase window.** The five emitting Skills (`test-plan`, `implement`, `verify`, `adversarial-review`, `finalize`) add three fields to their sidecar at `hstack/specs/changes/<id>/.telemetry/<skill>-<event>.json`:

```json
{
  "session_id": "062b8fe8-649f-4d73-b4fb-b0a28a800552",
  "phase_opened_at": "2026-08-15T09:12:44Z",
  "phase_closed_at": "2026-08-15T11:03:07Z"
}
```

`session_id` is resolved the way `/hstack:flag` already resolves it — the most recently modified `*.jsonl` under `~/.claude/projects/<encoded-cwd>/`. `phase_opened_at` is stamped when the Skill's preconditions pass, before any subagent invocation; `phase_closed_at` when the Skill reaches its terminal state, in the same write that lands the sidecar. Both are best-effort by contract: an unresolvable session id writes `null` and the phase is reported as unmeasured, never as zero. The sidecar rides the same `git add && git commit` as its canonical artifact, unchanged from ADR-0001.

**2. Summation in the parser.** `parsers/transcripts.py` gains `phase_usage(sidecar)`: open the transcript for `session_id`, sum `input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens` over assistant records whose `timestamp` falls in `[phase_opened_at, phase_closed_at]`. A missing transcript (retention sweep, other machine) yields `null`, not zero. The computation reads; it never writes.

**3. Attribution reads structure, not prose.** `classify_session` drops `HSTACK_SLASH` against message text. It matches only `<command-name>` tags and `Skill` tool-use blocks — markers the harness emits, which no quoted prose can forge. Sessions with no structured marker classify as unattributed rather than being captured by the first plausible string. This makes the v1 per-session heuristic honest; the sidecar window supersedes it wherever a sidecar exists.

**4. New rows, honest denominators.** `insights/token_economics.py` gains TE-4 (cost per phase: skill, change-id, tokens, turns, wall-clock) and TE-5 (cost per change: the sum across that change's phases, with a coverage fraction naming how many phases were measurable). TE-1 and TE-2 keep their per-session shape and gain an explicit note that they are session-scoped, not phase-scoped, and are superseded by TE-4/TE-5 for any change that carries sidecars.

**Out of scope:** attributing subagent usage separately from its host (moso-app transcripts still show `isSidechain: false` throughout, so the split is not observable from this side); any change to what the sidecar means (it stays derivative and gitignored); cost in currency (REC-0005 territory, and wrong under a subscription); and any live in-session budget display — this is post-hoc measurement, matching the rest of the telemetry layer.

## Consequences

### Positive

- **"What does this change cost?" becomes answerable**, per phase and per change, from data the harness already writes. That is the question the audit could not answer, and it is the one that decides where context engineering effort goes next.
- **The headline row of the token table stops being a lie.** `coord` returns to its real scale, and the Skills that actually carry cost become visible for the first time.
- **The `HSTACK-CUT` session-boundary guidance becomes verifiable.** Phase windows make "did cutting between phases actually reduce cost per change?" a measurable before/after, rather than a belief imported from external benchmarks.
- **No new measurement channel.** Two timestamps and an id, written where a file was already being written, summed by a parser that already opens these transcripts.
- **Graceful degradation.** No sidecar, no session id, or an expired transcript → the phase reports as unmeasured. Nothing regresses to a wrong number, which is the failure mode being fixed.

### Negative

- **Coverage is partial by construction.** Only five Skills emit sidecars; `change-new`, `change-plan`, `security-review`, `data-review`, `ship` and the whole `configure` family stay invisible. A per-change total is a sum over the measured subset, and the coverage fraction has to be read alongside it or it will be mistaken for a total.
- **The window over-counts a shared session.** A session that runs `implement` and then answers an unrelated question before `verify` credits that detour to whichever window contains it. Bounding on the Skill's own start and end narrows this to intra-phase noise, but does not eliminate it — the measurement is "what the session spent during the phase", not "what the phase required".
- **It couples telemetry to Claude Code's transcript layout.** Path encoding, the `usage` shape, and `timestamp` are harness implementation details, not a contract. A harness change silently degrades every phase to unmeasured. The `null`-not-zero rule keeps the failure visible rather than silent, but the dependency is real and new.
- **`cleanupPeriodDays` becomes load-bearing for history.** Transcripts are swept on a retention period (365 days on this machine, 30 by default). Any repo left at the default loses the ability to recompute phase cost for changes older than a month, and the sidecar keeps pointing at a file that no longer exists.
- **Session ids leak into a committed-adjacent artifact.** The sidecar is gitignored, so nothing lands in git — but the discipline now depends on that gitignore line holding. A consumer that commits `.telemetry/` publishes local session identifiers.

### Neutral

- The sidecar gains three fields; its schema version bumps and older sidecars read as unmeasured.
- `/hstack:flag`'s session-id resolution becomes shared code rather than a one-off inside one Skill.
- The dev repo is not a consumer (no `hstack/` tree, no `specs/`), so this ships blind here and is exercised in moso-app.

### Challenge prompt — name two consequences that look bad

1. **Measuring phases invites optimizing phases, and phase cost is the wrong objective.** A cheap `adversarial-review` is not a better one; the Skill exists to find things, and finding things costs tokens. Once TE-4 puts a number on each phase, the number becomes a target, and the phases that look expensive are exactly the critique-heavy ones the kernel deliberately made expensive. Nothing in this ADR pairs cost with an outcome measure, so the table can only ever argue for spending less — never for spending well. TE-5's per-change total is the mitigation only if it is read next to QO-4 (observed vs promised) and the adversarial-review findings density, and nothing enforces that pairing.
2. **The fix makes the instrumentation look trustworthy while its blind spot grows.** Replacing a visibly absurd number (a sub-second Skill credited with 24M tokens) with a plausible one removes the very signal that prompted this audit. Partial coverage plus a plausible total is more dangerous than obvious nonsense: six Skills stay unmeasured, subagent spend still lands in the host bucket, and a reader who skips the coverage fraction will treat a subset as a total. The coverage fraction is printed, but printed is weaker than enforced — the same gap ADR-0007 named between "surfaced" and "acted on".

## Alternatives Considered

**Option A — Status quo plus a caveat.** Widen TE-1's existing note to say the numbers are session-scoped and unreliable. Zero cost, and it keeps a wrong headline number in the UI that the brain's weekly analysis reads as input. Rejected: the recommendations layer consumes these tables, so a known-wrong row propagates into proposed kernel changes.

**Option B — Fix the attribution regex only.** Restricting `classify_session` to structured markers removes the `coord` artifact for a few lines of diff, and is a strict improvement. But it leaves the no-end-marker defect untouched: a session's whole spend still lands on its first Skill. Adopted as piece 3 of this decision rather than as the whole of it.

**Option C — Emit a sidecar from all 27 Skills.** Full coverage, no partial-total caveat. Rejected on the same grounds ADR-0001 used to limit emission to five: each emission is a write plus a commit in a Skill whose job is not measurement, and the five chosen cover the high-signal lifecycle events. A sixth emitter remains a follow-up change, not a unilateral Skill edit.

**Option D — Live token accounting inside the Skill (read `usage` from the transcript mid-session and write a running total).** Would give in-session budget awareness and could drive an automatic cut. Rejected: it makes every Skill depend on parsing its own transcript while it is being written, turns a post-hoc derivative into a live one, and the harness already exposes the number to the engineer through `/context`. Post-hoc measurement matches the rest of the telemetry layer.

**Option E — Wrap phases in subagents so usage is attributable by process boundary.** Structurally cleaner than timestamps. Rejected on two grounds: the transcripts show `isSidechain: false` throughout, so the boundary is not currently observable from the parser's side anyway; and ChainSWE's result that delegating sequentially-dependent edits degrades outcomes argues against moving `implement` behind a subagent purely for measurement.
