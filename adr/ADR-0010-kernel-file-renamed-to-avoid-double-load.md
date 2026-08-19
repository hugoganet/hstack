---
id: ADR-0010-kernel-file-renamed-to-avoid-double-load
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

The consumer-side kernel is renamed `hstack/CLAUDE.md` → `hstack/KERNEL.md`, keeping the `@hstack/KERNEL.md` import in the consumer's root `CLAUDE.md` as its single load path. The rename exists to defeat Claude Code's nested-`CLAUDE.md` discovery, which was injecting a second full copy of the kernel — measured at ~15k tokens in 46% of sessions — on top of the copy the import already loads at launch. Nothing about the kernel's authority, content, or precedence changes.

## Status

Accepted on 2026-08-15. Ships as one PR: the template file rename, the installer's write path and idempotency probe in `src/lib/wire.ts`, the 30 path references across 24 files (14 subagent context-load lists, the Skills, README, CHANGELOG), and a `hstack doctor` migration finding for repos installed before this ADR.

## Context

hstack installs its kernel at `<consumer>/hstack/CLAUDE.md` and wires it into context by appending one import line to the consumer's root `CLAUDE.md`:

```
> **Engineering workflow:** all changes in this repo are governed by hstack. See @hstack/CLAUDE.md.
```

Claude Code loads that file by two independent mechanisms that do not know about each other:

1. **`@path` import.** *"Imported files are expanded and loaded into context at launch alongside the CLAUDE.md that references them."* The kernel is therefore in context from turn one of every session.
2. **Nested-`CLAUDE.md` discovery.** Claude Code also discovers files *named* `CLAUDE.md` in subdirectories, and injects them when a file in that subdirectory is read. `hstack/CLAUDE.md` matches on name, so the first `Read` of any artifact under `hstack/` — a `spec.md`, a `plan.md`, anything — injects the whole kernel a second time.

Measured on a controlled reproduction (`/tmp/imp-test`: a root `CLAUDE.md` importing an 85,213-byte `sub/CLAUDE.md` ≈ 21.3k tokens; Claude Code headless, Haiku, first-turn context read from the transcript `usage` field):

```
import active                          first turn = 49,375
import neutralised (wrapped in ticks)  first turn = 27,744   Δ = 21,631  → path 1 confirmed
import active, then Read sub/foo.txt   turn 1 = 51,335 → turn 2 = 73,725
                                                        Δ = 22,390  → path 2 confirmed
                                       nested_memory attachment: /tmp/imp-test/sub/CLAUDE.md
```

The same file, twice, in one session.

On this machine's real workload: `hstack/CLAUDE.md` is 59,491 bytes ≈ 15k tokens, and the nested re-injection fires in **354 of 770** moso-app sessions over 30 days (46%) — every session that reads any hstack artifact, which is every session that does per-change work. Measured session baseline is 54.5k (headless) to 77k (interactive); the duplicate copy is roughly a fifth of it.

`claudeMdExcludes` was tested as the obvious fix and rejected on evidence: with `claudeMdExcludes: ["**/sub/CLAUDE.md"]` the baseline fell to 27,750 and no `nested_memory` was injected — it suppresses **both** paths, deleting the kernel from context entirely rather than deduplicating it.

One asymmetry between the two paths decided which one to keep. Per the compaction contract, *"Project-root CLAUDE.md and unscoped rules → Re-injected from disk"* while *"Nested CLAUDE.md in subdirectories → Lost until a file in that subdirectory is read again"*. The imported copy is part of the root `CLAUDE.md` and survives compaction; the discovered copy does not. Subagents inherit *"every level of the CLAUDE.md hierarchy the main conversation loads"*, so the import also makes kernel delivery to subagents deterministic — today a subagent spawned before any `hstack/` read may run without the kernel it is required to load.

## Decision

**Rename the file so nested discovery cannot match it, and keep the import as the sole load path.**

```
hstack/CLAUDE.md  →  hstack/KERNEL.md
@hstack/CLAUDE.md →  @hstack/KERNEL.md   (consumer root CLAUDE.md, written by the installer)
```

Discovery keys on the literal filename `CLAUDE.md`; `KERNEL.md` is invisible to it. The import keys on the path the engineer wrote and is indifferent to the name. After the rename the kernel loads exactly once, at launch, and is re-injected from disk after compaction as part of the root `CLAUDE.md`.

**Scope of the change:**

- `template/CLAUDE.md` → `template/KERNEL.md`.
- `src/lib/wire.ts`: the appended line becomes `See @hstack/KERNEL.md.`, and the `matchOn` idempotency probe becomes `@hstack/KERNEL.md`. Both `init` and `update` call sites.
- 30 path references across 24 files: the 14 subagent session-start context-load lists that name `hstack/CLAUDE.md`, the Skills that reference it (notably `brownfield-init` and `kernel-fit-scan`), `README.md`, `CHANGELOG.md`.
- `hstack update` performs the migration in an installed consumer: `git mv hstack/CLAUDE.md hstack/KERNEL.md`, rewrite the root `CLAUDE.md` line (probe-matched, everything else preserved verbatim), single commit. An unparseable or hand-edited root `CLAUDE.md` where the probe does not match is never rewritten — `update` warns and `doctor` flags it, mirroring ADR-0007's settings-ownership contract.
- `hstack doctor` gains a `kernel-filename` finding: a consumer with `hstack/CLAUDE.md` present, or with a root import line still pointing at the old path, is flagged with the one-command fix.

**What does not change:** the kernel's content, its authority ("in any conflict between this kernel and another document, this kernel wins"), its precedence relative to the consumer's own root `CLAUDE.md`, the "everything under `hstack/`" layout rule, and the `.claude/` symlink wiring. This is a filename, not a boundary.

**Out of scope:** shrinking the kernel (15k is worth attacking on its own merits and is independent of this bug); the consumer's own root `CLAUDE.md`, which is theirs; and any change to how Skills or rules load.

## Consequences

### Positive

- **~15k tokens per session recovered in 46% of sessions**, across every consuming repo, for a filename change. It is the largest single-item saving found in the context audit — larger than removing all global subagents and delinking every unused Skill combined.
- **Kernel delivery becomes deterministic.** One path, firing at launch, always. Today the kernel's presence depends on whether a file under `hstack/` happened to be read, which varies by session and is invisible from inside the session.
- **Subagents reliably inherit the kernel.** They inherit the CLAUDE.md hierarchy the main conversation loads; an import loaded at launch is always in that hierarchy, an on-demand nested file is not. The kernel's own stop condition — a subagent that cannot reach a required context document must halt — becomes enforceable rather than accidental.
- **Post-compaction behaviour improves.** The surviving path is the one the compaction contract re-injects from disk. The path being removed is the one it drops.
- **The migration surface is already probe-based.** `wire.ts` matches on `@hstack/CLAUDE.md` for idempotency, so the rewrite reuses machinery ADR-0007 already established for narrow, merge-only ownership of a file engineers also edit.

### Negative

- **The redundancy being removed was an accidental safety net.** Today a broken import — a typo, someone wrapping the path in backticks, an external-import approval declined — still leaves nested discovery to deliver the kernel on the first `hstack/` read. After this change, a broken import means the kernel is never loaded, and nothing announces it: the session looks completely normal and runs unkerneled. Wasteful-but-fail-safe becomes efficient-but-fail-silent. `doctor` covers the misconfigured case; it does not cover the mid-session case.
- **`CLAUDE.md` is itself documentation, and the rename spends it.** A contributor opening `hstack/` sees `CLAUDE.md` and knows immediately what it is. `KERNEL.md` is hstack vocabulary that means nothing to a newcomer. Convention-scanning tooling — other coding agents, IDE integrations, `/import` from another agent's config — looks for `CLAUDE.md` and `AGENTS.md`, and will now walk past the most load-bearing file in the repo.
- **30 references across 24 files, plus a migration in 5 live consumers.** Every subagent's session-start context-load list names the path; a missed one produces a subagent that halts on an unreachable required document (the loud failure) or silently loads nothing (the quiet one). The blast radius is mechanical but wide.
- **It hard-codes a dependency on `@path` import semantics.** Imports are a harness feature with their own rules — four-hop recursion limit, an approval dialog for paths resolving outside the working directory, parsing that skips code spans. The measurement above is a snapshot of current behaviour, not a contract. If import expansion ever moves out of launch-time, the single remaining path moves with it.
- **Consumers on older hstack versions diverge until they run `update`.** Between this release and each consumer's migration, some repos double-load and some do not, which makes any before/after token comparison across repos non-comparable for that window.

### Neutral

- The dev repo is not a consumer (no `hstack/` tree, no root `CLAUDE.md`), so this ships blind here and is exercised in moso-app first.
- ADR-0009's per-phase instrumentation will show the saving as a step change in baseline, not as a phase cost — the two ADRs are independent but the second makes the first legible.
- The `.telemetry/` and `.session-state/` naming conventions are unaffected; nothing else under `hstack/` is named after a harness file.

### Challenge prompt — name two consequences that look bad

1. **This optimises the wrong number and may bank a rounding error.** The audit that produced this ADR also established that in a 396k-token session, 344k (86%) is conversation and ~56k is startup — the kernel duplicate is ~15k of that, under 4% of a working session. Meanwhile a filename change ripples through 24 files, 5 repos, the installer, and doctor, and permanently removes a fallback. If the same effort went into the `HSTACK-CUT` session-boundary discipline from ADR-0009's sibling commit, it would attack the 344k instead of the 15k. The honest defence is that this is a bug, not a tuning knob, and that bugs get fixed regardless of their share — but "we spent a release renaming a file to save 4%" is a fair reading.
2. **Single-path loading makes the kernel's absence unfalsifiable from inside a session.** With two paths, a session missing the kernel would usually acquire it on the next artifact read, which is why this bug survived unnoticed for months — the redundancy masked every misconfiguration. With one path, a session either has the kernel from turn one or never has it, and the model cannot tell the difference: nothing in its context says "the kernel should be here". Every hstack guarantee that rests on the kernel being loaded — scope-lock, test-immutability, the stop conditions — becomes silently conditional on one line in a file the installer co-owns with the engineer. A `SessionStart` hook asserting the kernel is present would close this, and is deliberately not in scope here; it should be the follow-up.

## Alternatives Considered

**Option A — Status quo.** Pay ~15k in 46% of sessions, keep the fail-safe redundancy and the conventional filename. Rejected: the cost is per-session and permanent across every consuming repo, and the "redundancy" is unintentional — nothing designed it as a fallback, so nothing maintains it as one.

**Option B — `claudeMdExcludes: ["**/hstack/CLAUDE.md"]` in the consumer's settings.** Tested and rejected on measurement: it suppresses both load paths (baseline 27,750, no nested injection in the reproduction), removing the kernel from context entirely. It excludes files, it does not deduplicate them.

**Option C — Drop the import, rely on nested discovery alone.** Zero-cost for sessions that never touch `hstack/`, which is arguably the correct cost profile. Rejected on correctness, not cost: the discovered copy is dropped by compaction and never re-injected, subagents spawned before the first `hstack/` read do not inherit it, and the kernel's authority claim is incompatible with "loaded if a file happened to be read".

**Option D — Shrink the kernel below the point where duplication matters.** Worth doing on its own merits — 15k for a file loaded into every session in every repo is a lot regardless of how many times it lands. Rejected as a *fix*: halving the kernel halves the waste but leaves the double-load in place, and the waste returns as the kernel grows again (49,175 → 60,283 bytes between May and July).

**Option E — Move the kernel to `.claude/rules/hstack-kernel.md` (no `paths:` frontmatter), symlinked to `hstack/KERNEL.md`.** Unscoped rules load at launch at the same priority as `.claude/CLAUDE.md` and are re-injected after compaction, so this has the same properties as the import while reusing the symlink wiring hstack already uses for Skills and agents. Genuinely close. Rejected for now on two grounds: it puts the kernel in two namespaces (`hstack/` for authorship, `.claude/rules/` for loading), weakening the "everything under `hstack/`" rule that makes the tree legible; and it swaps a dependency on import semantics for a dependency on rules-loading semantics without evidence that the latter is more stable. This is the designated fallback if `@path` import behaviour proves fragile.
