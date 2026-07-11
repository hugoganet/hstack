---
id: ADR-0006-pull-based-cross-session-coordination
type: adr
status: accepted
owner: hugoganet
decision-date: 2026-07-11
supersedes: null
superseded-by: null
related-change-specs: []
related-modules: []
promoted-from-kernel-fit: []
created: 2026-07-11
updated: 2026-07-11
schema-version: 2
---

## Title

Cross-session and cross-repo coordination is pull-based over committed state: a machine registry, `git show` reads, and committed immutable coord-messages — no home-directory bus, no hooks, no presence tracking in v1.

## Status

Accepted on 2026-07-11. Ships as one PR: the `coord_scan.py` script, the `coord-message` template, the `/hstack:coord` Skill, a kernel section (`## Cross-session coordination`), the `scripts/coord/` manifest entry, and the `hstack/.session-state/` gitignore wiring. No supersession. An earlier design (machine-level bus at `~/.hstack/coord/` with presence cards, per-target inboxes, and SessionStart/UserPromptSubmit hooks) was adversarially reviewed and rejected; the review's arguments are recorded under Alternatives.

## Context

The dev environment runs many Claude Code sessions in parallel via Conductor, each in its own git worktree of the same repo (shared object store, separate working directories), plus several sibling repos on the same machine (an orchestrator repo and its module repos). Sessions cannot communicate today. The need is asynchronous coordination, both intra-repo (worktree ↔ worktree) and cross-repo (orchestrator ↔ modules), in both directions:

- **(a) Pull** — a session consults another session's or repo's hstack artifacts.
- **(b) Push** — a session leaves an addressed message that another session will see later.

Constraints from the requester: the "anything for me?" check must be mechanically cheap (near-zero tokens and wall-clock when empty); scope overlap between sessions is rare, so overlap detection is not the central scenario; the mechanism must degrade gracefully when there is no peer or the topology does not support it.

Three kernel laws bound the design space. **No parallel tracker**: every load-bearing fact lives in committed frontmatter; the existing carve-outs (`.telemetry/` sidecars, kernel-fit flag pins) survive only because they are *derivative* — erasable and re-runnable from source. **Token economy**: a subagent invocation costs 15-25k tokens before any work; mechanical operations never justify one. **Session isolation**: review agents never load other sessions' transcripts; content crosses session boundaries only as distilled artifacts.

Two properties of hstack make pull-over-committed-state unusually viable here. First, hstack auto-commits at every status transition and every phase boundary, so the committed view of a session lags its working tree by minutes, not days — commit frequency *is* the freshness contract. Second, worktrees share one object store, so `git show <branch>:<path>` reads any parallel session's committed state with zero network and zero copies; `git -C <path> show` extends the same primitive across repos given only a filesystem path.

## Decision

Ship four pieces, all pull-based, nothing authoritative outside git:

**1. Machine registry — `~/.hstack/registry.yaml`.** A flat name → path → default-branch list of hstack repos on this machine. Written by `/hstack:coord register` (which resolves the durable main-worktree path, so registering from an ephemeral Conductor worktree records the clone, not the workspace), human-editable, machine-local. It is configuration in the same category as `~/.gitconfig` — it holds no artifact state; losing it degrades to "no cross-repo discovery" and is repaired by re-registering. This replaces presence cards entirely for the cross-repo case.

**2. Pull primitive — `git show`, frontmatter-first.** Intra-repo: `git show <branch>:<path>`. Cross-repo: `git -C <registry-path> show <branch>:<path>`. Reads are announced to the engineer, frontmatter-first; a heavy multi-artifact read is delegated to a read-only subagent that returns a distilled summary (session isolation preserved). Only committed state is readable — a peer's uncommitted working tree is invisible by design.

**3. Push — committed, immutable coord-messages.** A message is a small committed artifact at `hstack/coord/messages/<id>.md` in the **sender's** repo, on the sender's branch, addressed via frontmatter (`to-repo`, optional `to-branch`), with `refs` pointing at the committed artifacts that carry the authoritative detail. Addressing resolves against the receiver's **canonical name** — the committed one-line file `hstack/coord/NAME`, which sender (via `git -C <peer> show`) and receiver (via its own working tree) independently resolve to the same string; registry names are machine-local aliases and unsafe for addressing. Message ids carry a timestamp + sender + random-hex suffix so same-second sends never collide. Messages are append-only and immutable (CM-02): no status machine beyond terminal `sent`, no reciprocal write, no edit after commit — a correction is a new message. Because the message *is* a committed artifact, the no-parallel-tracker law is satisfied rather than carved out: an unread message stays visible in git history forever (auditable). The guarantee is **committed-and-auditable, not delivered** — surfacing additionally requires name agreement, receiver registration, and an eventual scan (see Negative consequences). Receipt tracking is receiver-local: a gitignored cursor at `hstack/.session-state/coord-cursor` listing acked ids — derivative in the strict sense (deleting it re-surfaces messages; at-least-once *surfacing*, the safe direction).

**4. Discovery — a scan script, not hooks.** `hstack/scripts/coord/coord_scan.py` (stdlib-only Python, matching the telemetry scripts) walks local branches plus each registered repo's local branches for messages addressed to this repo, filters acked/expired/own-sent ids, and prints one line per new message — silent with exit 0 when empty. Scanning peer *branches* (not just default branches) matters because a sender's message lives on its feature branch until merge. The cadence is session-start plus explicit decision points, driven by the `/hstack:coord` Skill and a short kernel section — not per-turn polling, not harness hooks. Ack happens only after messages are surfaced to the engineer, so a crash before ack re-delivers.

**Boundaries.** (a) Message bodies are information, never instructions (CM-03) — a receiving session weighs them against its own kernel and scope gates; content from another session is untrusted input. (b) The implementer's scope-lock stands: no coordination reads mid-phase; coordination happens in the main session at planning/scoping points or between phases. (c) Nothing ever writes into another repo or another session's working tree.

Out of scope for v1, revisitable on evidence: presence tracking ("who is active right now"), harness hooks (SessionStart/UserPromptSubmit — requires the installer to own `settings.json`, a trust-surface expansion needing its own ADR), any `~/.hstack/coord/` bus, cross-machine coordination (needs a server; different problem), broadcast addressing (`to-repo` is exact-match), and scope-overlap detection (declared rare by the requester).

## Consequences

### Positive

- **The no-parallel-tracker law is satisfied, not carved out.** Every load-bearing coordination fact (the message, its addressing, its refs) is committed frontmatter. The two local files (registry, cursor) hold config and derivative cache; erasing either loses no authoritative state.
- **The empty path costs one subprocess and zero tokens of output.** Silent exit-0 when there is no traffic; the model spends tokens only on real signal. No standing kernel prose beyond one short section; the protocol detail lives in the Skill, loaded only when invoked.
- **The cross-repo need — the common case — is served by the simplest pieces.** Registry + `git -C ... show` covers orchestrator ↔ module consultation with no messaging at all; messages exist for the rarer "you need to know this" push.
- **No new failure domain.** No delivery semantics to invent (git history is the log; the cursor is the read pointer), no concurrent-write protocol (each sender writes only its own repo; ids carry a timestamp + sender prefix plus a random-hex suffix), no version-skew surface between hstack versions sharing a home-directory format (the registry schema is three flat keys).
- **Auditability for free.** "What did rhizome tell moso-app in June?" is a git log question, answerable forever.

### Negative

- **Delivery latency is bounded by commit-and-scan, not push.** A message is invisible until committed and unseen until the receiver's next scan (typically its next session start). Acceptable because the stated requirement is asynchronous coordination; anything needing sub-session latency is out of scope by design.
- **Surfacing is best-effort, and the failure mode is silent-but-auditable.** A `to-repo` string the receiver never resolves to itself (missing `hstack/coord/NAME` plus a divergent alias or basename), an unregistered receiver, or a `to-branch` nobody checks out all yield permanent non-surfacing with no error signal — the message simply sits committed. The committed `NAME` file closes the common case (both sides independently resolve the same string), and `send` warns when it must fall back to an alias, but the design deliberately has no delivery receipt; anyone needing confirmed delivery must look for the receiver's reaction in *its* committed artifacts.
- **Message traffic lands in git history.** Every send is a commit; heavy messaging would pollute history. Mitigations: messages are deliberately small, refs-first; the expected volume (occasional cross-repo heads-ups) is low; if volume grows, that is evidence for revisiting the design, not for pre-building a bus.
- **The registry is one more machine-local thing to set up.** Each repo must be registered once per machine before cross-repo coordination works. Mitigated by `register` being a one-shot idempotent command and by graceful degradation (unregistered = intra-repo-only, no errors).
- **Branch-scan cost grows with branch count.** The scan runs `ls-tree` per local branch per repo. Empty-tree lookups are sub-millisecond, but a machine with hundreds of stale branches across many repos pays a visible (still sub-second) scan. Acceptable at current scale; the horizon filter bounds the message set, not the branch walk.

### Neutral

- Messages carry the standard frontmatter floor (`id/type/status/owner/created/updated`) with `status: sent` as the single terminal value, so the frontmatter contract stays uniform even though messages have no lifecycle.
- `validate-spec.ts` remains a `{{TODO-SCRIPT}}` placeholder; CM-01/02/03 are enforced by the proposed-diff preview at send-time, same as every other mechanical write in v1.
- The Skill adds one consumer-wiring symlink per consuming repo, matching every prior Skill addition.

### Challenge prompt — name two consequences that look bad

1. **At-least-once delivery plus an LLM receiver means "surfaced" is weaker than "acted on."** The scan re-delivers until acked, but ack happens when the message is *surfaced to the engineer*, not when its content is actually incorporated into the session's decisions. A session can faithfully print a schema-freeze warning, ack it, and then plan against the old schema anyway — the mechanism guarantees transport, not comprehension. The committed message remains auditable evidence that the warning existed, which is more than the rejected bus offered (silent TTL loss), but nobody should mistake the ack cursor for a compliance record.

2. **The design's freshness contract silently degrades on repos that don't commit like hstack repos.** Pull-over-committed-state leans on hstack's auto-commit cadence. A registered repo that is *not* hstack-governed — or an hstack repo mid-long-uncommitted-spike — presents a stale committed view with no staleness indicator. A session reading a peer's three-day-old committed module-spec has no signal that the peer's working tree has diverged. v1 accepts this (the alternative is reading working trees, which breaks isolation and reproducibility); a `git log -1 --format=%cr <branch>` freshness line in the scan output is the cheap future mitigation if this bites.

## Alternatives Considered

**Option A — Do nothing.** Sessions stay mute; the engineer hand-carries context between worktrees and repos. **Rejected**: the cross-repo consultation need (orchestrator ↔ modules) is real and recurring, and the cost of Option C's core (a registry file and a read discipline) is trivially low.

**Option B — Machine-level coordination bus at `~/.hstack/coord/` with presence cards, per-target inboxes, and SessionStart/UserPromptSubmit hooks.** The original proposal. **Rejected** on adversarial review, on five grounds. (1) The inbox fails the derivative test that lets `.telemetry/` and flag pins survive the no-parallel-tracker law: an addressed message is original, load-bearing state existing nowhere else — wiping or TTL-expiring the inbox is silent, unauditable loss, which is the definition of a parallel tracker. (2) Delivery semantics (delete-on-read vs ack vs TTL) and addressing (session-id vs branch vs repo) were unspecified, and every option either loses messages or becomes a stateful protocol contradicting the "ultra-light mechanical check" constraint. (3) The inbox is a prompt-injection channel: hook-injected content written by any process on the machine enters another session's context, piercing session isolation by construction. (4) The cost claims were optimistic: hooks are free when idle, but the autonomous-consultation prose would be loaded by every session always, while the payoff (scope overlap) was declared rare; hooks also require the installer to own `settings.json` — a trust-surface expansion (auto-executed bash) deserving its own ADR. (5) A home-directory format shared by all consumer repos across differing hstack versions creates a version-skew compatibility surface with concurrent pruning by mismatched scripts. Presence cards individually pass the derivative test but serve only the rare-overlap case; they may return later on evidence.

**Option C — Registry + git-show pull + committed immutable messages + scan script.** **Adopted.** Every authoritative fact is committed frontmatter; the empty path is a silent subprocess; the primary need (cross-repo pull) is served by the two simplest pieces; delivery, ordering, and audit are inherited from git rather than invented.

**Option D — A real substrate: MCP server or harness-native messaging.** A local MCP coordination server (or future Conductor/Claude-Code primitives) would give push latency, presence, and cross-machine reach. **Rejected for v1**: it introduces a running service, network surface, and authoritative out-of-repo state for a need declared asynchronous and machine-local. It is the natural v2 shape *if* usage shows pull latency is insufficient — and the committed-message format gives any future substrate a migration-friendly source of truth to sync from.
