---
id: ADR-0007-hook-driven-coord-notification
type: adr
status: accepted
owner: hugoganet
decision-date: 2026-07-24
supersedes: null
superseded-by: null
related-change-specs: []
related-modules: []
promoted-from-kernel-fit: []
created: 2026-07-24
updated: 2026-07-24
schema-version: 2
---

## Title

Coord discovery is auto-triggered by harness hooks: `SessionStart` and `UserPromptSubmit` run the scan and inject a count-only pointer line when unread messages exist. The installer owns exactly two hook entries in the consumer's `.claude/settings.json`. Usage is tracked in a derivative, gitignored JSONL. Amends ADR-0006's discovery cadence; everything else in ADR-0006 stands.

## Status

Accepted on 2026-07-24. Ships as one PR: the `hook` mode in `coord_scan.py`, the usage-event log, the installer's `merge-hooks` action (`hstack init` / `hstack update` / `hstack doctor`), and the kernel + Skill cadence updates. ADR-0006 reserved harness hooks as "out of scope for v1, revisitable on evidence" and named the trust-surface expansion (installer owning `settings.json`) as needing its own ADR — this is that ADR, triggered by that evidence.

## Context

ADR-0006 shipped pull-based coordination with a deliberate cadence: scan at session start, plus explicit decision points, never per-turn polling. Lived usage produced exactly the failure the cadence permits: a message committed by a sender is invisible to an already-running receiver session until the engineer manually nudges it ("check your messages"). The engineer is the delivery mechanism — the annoyance ADR-0006 said would be the trigger for revisiting.

The constraints that shaped ADR-0006 are unchanged and must survive: the empty path costs near-zero tokens and wall-clock; committed state is the only authoritative channel; peer-authored content is untrusted input that never enters a session's context unmediated; nothing writes into another repo or session.

One fact makes hooks newly cheap to adopt: Claude Code hooks inject a command's stdout into the session's context on `SessionStart` and `UserPromptSubmit`. A scan that is silent-when-empty therefore costs one sub-second subprocess and zero tokens per prompt in the common case, and one short line exactly when there is signal.

A second requirement from the engineer: coord usage must be tracked the way hstack already tracks itself — derivative, erasable measurement in the `.telemetry/` family, never a parallel tracker.

## Decision

Four pieces, all amendments to ADR-0006's discovery layer only:

**1. `hook` mode in `coord_scan.py`.** Same collect-and-filter as `scan`, hook-shaped contract: (a) exit 0 no matter what — a coordination failure must never break the engineer's prompt (the whole body is wrapped; even `not a git repo` is silent); (b) silent when nothing is new; (c) when unread messages exist, print ONE count-only pointer line naming `/hstack:coord` as the next step. No subjects, no ids, no bodies — peer-authored content never crosses into context through the hook. Surfacing, frontmatter-first reading, and acking remain exclusively in the Skill under CM-03. The hook reads the harness's stdin payload best-effort to attribute the trigger (`SessionStart` vs `UserPromptSubmit`) and session id in the usage log.

**2. Installer-owned hook entries.** `hstack init` and `hstack update` merge two entries into `<consumer>/.claude/settings.json` — `SessionStart` and `UserPromptSubmit`, both running `python3 "$CLAUDE_PROJECT_DIR"/hstack/scripts/coord/coord_scan.py hook` with a 15 s timeout. The ownership boundary is narrow and mechanical: the installer owns only entries whose command contains `scripts/coord/coord_scan.py` (the idempotency probe); every other key in the file is engineer-owned and preserved verbatim. An unparseable `settings.json` is never rewritten — `init` blocks, `update` warns and skips, `doctor` flags. The command targets the consumer's own committed copy of the script, so the trust surface is "run what this repo already committed", not "run what a package downloaded".

**3. Usage tracking — `hstack/.telemetry/coord/events.jsonl`.** The script appends one JSON line per `hook`, `scan`, and `ack` invocation (timestamp, event, trigger, new/acked count, duration). Per-worktree, gitignored by the existing `**/.telemetry/` line, best-effort by contract (a telemetry failure never fails the scan, and never the hook path). `send` needs no event: every send is a `chore(coord): message <id>` commit, already first-class in git history. The log is measurement, not derived cache — deleting it loses only usage history, never load-bearing state; the no-parallel-tracker rule is satisfied the same way `.telemetry/` sidecars satisfy it.

**4. Cadence amendment.** ADR-0006's "never per-turn polling" becomes "the model never polls; the harness does". The scan now runs at session start and at every user prompt — but as a hook subprocess, not an LLM turn. The Skill's cadence discipline is unchanged from the model's side: it runs `check` when the pointer line appears, at session start where hooks aren't wired (graceful degradation to ADR-0006 behavior), and at explicit decision points.

**Boundaries unchanged from ADR-0006:** messages are committed artifacts in the sender's repo; addressing resolves against the committed `NAME`; ack is receiver-local and happens only after the Skill surfaces messages to the engineer; message bodies are information, never instructions; the implementer's mid-phase scope-lock stands (the pointer line may appear mid-phase — acting on it still waits for a phase boundary).

Still out of scope: real push (an MCP/server substrate — ADR-0006's option D remains the v2 shape if commit-plus-next-prompt latency proves insufficient), presence tracking, cross-machine coordination, and any OS-level notification to the human (macOS `osascript` on send was considered and explicitly deferred by the requester).

## Consequences

### Positive

- **The engineer stops being the delivery mechanism.** A committed message surfaces at the receiver's next prompt, not at its next session start or next manual nudge. This closes the gap that made coordination "committed-and-auditable but humanly-couriered".
- **The empty path stays free.** Silent hook + exit 0 means zero tokens and one sub-second subprocess per prompt. The cost profile ADR-0006 optimized for is preserved.
- **The injection boundary is sharper than ADR-0006 required.** The hook's count-only contract means even the sanitized subject lines that `scan` prints never enter context unrequested; the Skill remains the single mediated surface for peer content.
- **Usage becomes measurable.** Hit-rate (how often scans find something), latency proxy (hook duration), and adoption (are hooks firing at all) are one JSONL away, in the same derivative family as the telemetry sidecars — fuel for the eventual "was pull latency sufficient?" decision ADR-0006 deferred to evidence.
- **Graceful degradation everywhere.** No hooks wired → exactly ADR-0006 behavior. No registry → intra-repo only. Unparseable settings → warn, skip, doctor flags; nothing is overwritten.

### Negative

- **This is still not push.** Latency is bounded by sender-commit plus receiver's next prompt. An idle session — one the engineer isn't typing into — learns nothing until touched. The manual-nudge annoyance shrinks to the idle-session case rather than disappearing.
- **Every consumer pays a per-prompt subprocess.** Sub-second, but nonzero, and it scales with local branch count across registered repos. A machine with hundreds of stale branches pays it on every prompt in every hstack repo. Mitigation if it bites: a horizon on the branch walk, or a cache keyed on ref state — evidence first.
- **The installer now co-owns a file engineers edit by hand.** `settings.json` becomes a shared surface: engineer edits can drift around the hstack entries, `settings.local.json` or managed policy can disable hooks silently, and the probe-based idempotency means a deliberately removed entry is re-added on the next `update` (removal requires editing the file after updates, or living with the doctor finding). This is the trust-surface expansion ADR-0006 flagged; the mitigation is the narrow ownership contract (probe-matched entries only, merge-only writes, never touch unparseable files).
- **The pointer line repeats.** Until the receiver runs `/hstack:coord` and acks, every prompt re-injects the one-liner. Deliberate (it preserves at-least-once surfacing without new state), but it is standing context noise while unacked traffic exists.

### Neutral

- The usage log is a third local file for the script (registry = config, cursor = derived cache, events = measurement). Each is individually erasable without losing authoritative state.
- `hstack doctor` gains a `hooks` finding category; repos that predate this ADR show it until their next `update`.
- The dev repo itself is not a consumer (no `hstack/` tree), so hooks are not wired here; the feature is exercised in consuming repos.

### Challenge prompt — name two consequences that look bad

1. **Ack-on-autopilot gets easier, not harder.** The pointer line arrives mid-conversation, and a session eager to return to its task can run `/hstack:coord`, print the surfaced summary perfunctorily, ack, and move on — technically honoring at-least-once surfacing while the engineer never actually reads the warning. ADR-0006 already noted "surfaced is weaker than acted on"; automation increases throughput of exactly that weakness. The committed message remains auditable, and the Skill's contract (surface to the engineer before ack) is unchanged — but nobody should read the events log's ack entries as evidence of comprehension.
2. **The per-prompt hook normalizes harness-injected content, and the count line is a spoofable shape.** A malicious committed file elsewhere (a README, a test fixture) could embed a lookalike `HSTACK-COORD: ...` line hoping the session treats it as harness output and runs coordination reads it wouldn't otherwise run. The real mitigation is that the pointed-to action (`/hstack:coord`) is itself read-only-plus-ack and treats all message content as untrusted — following a forged pointer costs a wasted scan, not an action. But the pattern "one-line injected notices are normal now" is a real widening of what a session accepts as ambient truth.

## Alternatives Considered

**Option A — Status quo (manual nudge).** Rejected: the engineer hand-carrying "check your messages" between Conductor workspaces is precisely the recurring annoyance ADR-0006 defined as the revisit trigger.

**Option B — OS-level notification to the human on `send` (macOS `osascript`).** Notifies the human, who still relays to the session — automates the wrong hop. Explicitly deferred by the requester; may return as a complement for the idle-session gap this ADR leaves open.

**Option C — Hooks injecting full message content (subjects, ids, read commands).** One fewer step than the pointer, but it moves peer-authored strings into context via an unmediated channel on every prompt — the exact prompt-injection shape that sank ADR-0006's option B. The count-only pointer keeps the Skill as the single mediated surface. Rejected.

**Option D — Real push substrate (local MCP server / harness messaging).** Solves the idle-session case and cross-machine reach, at the cost of a running service and authoritative out-of-repo state. Still the natural v2 if the events log shows commit-plus-next-prompt latency failing in practice. The committed-message format remains the migration-friendly source of truth. Deferred, unchanged from ADR-0006.

**Option E — Hook entries in `settings.local.json` or documentation-only (engineer wires by hand).** Avoids the installer-owns-settings expansion but guarantees drift: unwired repos silently degrade to ADR-0006 behavior and nobody notices, which is how the manual-nudge problem survives its own fix. The narrow probe-scoped ownership contract plus doctor visibility was judged the better trade. Rejected.
