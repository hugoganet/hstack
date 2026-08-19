---
id: ADR-0011-descriptions-are-routing-triggers
type: adr
status: accepted
owner: hugoganet
decision-date: 2026-08-19
supersedes: null
superseded-by: null
related-change-specs: []
related-modules: []
promoted-from-kernel-fit: []
created: 2026-08-19
updated: 2026-08-19
schema-version: 2
---

## Title

A Skill or subagent `description` is a routing trigger, not documentation. The 52 frontmatter descriptions — 19,234 words and 123 `<example>`/`<commentary>` blocks, loaded unconditionally into every session in every consuming repo — are cut to a one-sentence trigger under a 40-word budget, with named carve-outs for autonomous invocation and for confusable Skill families. Everything removed is either already stated in the body or deleted as a duplicate. No body, no rule, no gate, and no invariant changes.

## Status

Accepted on 2026-08-19. Ships as one PR touching only frontmatter in 52 files (36 `SKILL.md`, 16 agent files), plus a progressive-disclosure split of `hstack-kernel-fit-scan` to bring it under the per-Skill size guidance. Third in the context-engineering sequence after ADR-0010 (kernel rename, ~15k in 46% of sessions) and ADR-0009 (per-phase instrumentation, which makes this measurable).

## Context

The harness loads a Skill in two stages. The `description` is the routing index: it is injected into every session, unconditionally, for every installed Skill and subagent, whether or not anything invokes it. The body is loaded only when the Skill is actually invoked. That split *is* progressive disclosure, provided by the harness for free — the description is meant to answer "should this be invoked?" and nothing else.

hstack inverted it. Measured on the dev repo at v0.10.0 (2026-08-19):

| Always-loaded surface | Files | Words | Bytes | `<example>` blocks |
|---|---|---|---|---|
| Skill descriptions | 36 | 12,575 | 94,196 | 85 |
| Subagent descriptions | 16 | 6,659 | 49,213 | 38 |
| **Total index** | **52** | **19,234** | **143,409** | **123** |

Calibration: session A's `/context` reported **10,197 tokens** for the 16 subagent descriptions, i.e. 4.83 bytes/token for this corpus. At that ratio the Skill index is **≈19.5k tokens** and the whole index is **≈29.7k tokens paid at turn zero of every session**. For comparison, the kernel — the file whose duplicate ADR-0010 spent a release removing — is 60,283 bytes ≈ 12.5k. **The routing index is roughly twice the kernel, and unlike the kernel it is mostly not read by anything.**

Individual descriptions run 209 to 608 words (`hstack-change-plan` to `hstack-kernel-fit-promote`; subagents 301 to 575). A representative one, `planner`, spends 303 words to say what fits in twelve: *use when a change-spec is at `ready-to-plan` and needs decomposition into atomic phases*. The remaining 291 words are two `<example>` blocks with scripted `user:` / `assistant:` / `<commentary>` turns.

Three things make this worse than a simple size problem.

**The routing decision these words inform is, in most cases, already made deterministically.** Skills are invoked by an explicit slash command — `/hstack:change-plan <change-id>` — and the phase sequence is named by the kernel and by each Skill's terminal-state guidance. Subagent routing is not a model decision at all: **20 of the 36 `SKILL.md` files contain a literal `subagent_type: <agent>`** (`planner`, `implementer`, `verifier`, `spec-author`, `test-strategist`, …). The 10.2k tokens of subagent examples inform a choice a string literal has already made.

**The examples pre-write the first turn.** Each block contains a scripted `assistant:` reply — *"I'll invoke adversarial-reviewer. Findings floor is 5 because area=billing…"* — which anchors the wording and the posture of the response before the model has read the actual change-spec, the actual `area`, the actual diff. This is precisely the failure mode Anthropic names in *The new rules of context engineering for Claude 5-generation models*: "give Claude examples" becomes "design interfaces", because examples constrain exploration. The same article reports removing **over 80% of Claude Code's own system prompt** with no measurable regression, and replaces "put it all upfront" with "use progressive disclosure" — the exact affordance the description/body split already provides and that hstack is declining to use.

**The `<example>` convention is inherited, not chosen.** It is the pre-Claude-5 subagent-description idiom, copied uniformly into all 52 files including the 36 Skills, where it was never the convention. Nothing in hstack decided that a Skill index entry should contain dialogue.

Two second-order costs land on top. `hstack-kernel-fit-scan` is 20,742 bytes ≈ 4.3–5.2k tokens depending on the estimator — at or over the per-Skill guidance of 5k — and truncation keeps the head, so the end of the file disappears in silence after compaction. And every description that restates a rule the body also states is a second copy of a truth: ADR-0010's own context section and the divergence found between the kernel and its "authoritative" Notion schema doc are the two most recent demonstrations in this repo that second copies drift.

## Decision

**A description names the trigger. The body carries everything else.**

- **Budget: ≤ 40 words / ~250 characters per description.** One sentence naming the state that should cause invocation, plus a disambiguation clause only where a sibling is confusable.
- **No `<example>`, `<commentary>`, `user:` or `assistant:` blocks in any frontmatter.** All 123 are removed.
- **Everything currently in a description that is a rule, gate, contract, ADR reference, or worked case moves to the body or is deleted as an existing duplicate.** "Moves" is the default; deletion requires that the body already says it.
- **Negative cases are preserved, not deleted.** Several of the 123 blocks encode a real boundary — the `hstack-change-plan` example that halts because `data-review.md` is missing, for instance. Each such case lands in the body's *When to invoke* section as an explicit "when not to invoke" line. A description block may only be dropped outright once its boundary case is either present in the body or provably redundant with it.

**Named carve-outs** — the places where the description does load-bearing work and keeps a larger budget:

1. **`hstack-coord`.** The only description that routes with no human typing anything: ADR-0007's hooks inject `HSTACK-COORD: N unread …` and the model must invoke `check` mode on sight. That sentence stays, verbatim in intent, and the mode list (`check` / `send` / `register` / `peers`) stays with it.
2. **Confusable families.** `tech-debt-{new,resolve,wontfix,stale}`, `kernel-fit-{scan,triage,promote}`, `{greenfield,brownfield}-init`, `{change-new,change-plan}`. Each keeps one clause that distinguishes it from its siblings — this is where routing errors actually live, and the clause is cheaper than the error.
3. **Status preconditions stated as triggers.** "Use when the change-spec is at `ready-to-plan`" is the trigger and stays. "Halt if the conditional upstream artifact is not at terminal status" is enforcement and moves to the body.

**Sequencing inside the PR:** subagents first (16 files, ~10.2k tokens, and the half where routing is already deterministic), Skills second (36 files, ~19.5k). If a routing regression appears afterwards, the two halves are separately attributable in the git history.

**Also in scope:** `hstack-kernel-fit-scan` comes under the per-Skill size guidance by moving its consumer-side Slack setup — a one-time operation loaded on every scan — into a reference file the Skill reads on demand. This is the same principle applied one level down, and it is the first progressive-disclosure split inside a `SKILL.md` body.

**Out of scope:** body deduplication and the removal of the 52 `## Anti-patterns` sections (blocked on `validate-spec.ts`; until the validator exists the repeated prose is the only enforcement net); slimming the kernel; the judgment-based rewrite of quotas, character limits and keyword blocklists; and delinking the unused bootstrap Skills in a given consumer, which is a consumer-local `rm` of a symlink and not a framework change.

**What does not change:** every rule, gate, invariant, halt condition and status lifecycle in the corpus. This ADR moves words between two parts of the same file and deletes duplicates. If a behaviour changes, the PR is wrong.

## Consequences

### Positive

- **≈24–27k tokens per session recovered**, in every session, in every consuming repo — 52 descriptions at ~40 words is ~2,100 words ≈ 3k tokens, against ~29.7k today. That is larger than ADR-0010's ~15k, it applies to 100% of sessions rather than 46%, and it is paid today by sessions that invoke no Skill at all.
- **The index becomes scannable.** 52 one-line triggers can be held at once; 123 examples in which the trigger is buried in paragraph three cannot. Rightsizing plausibly *improves* routing on the described-in-prose path even as it shrinks it.
- **It restores the harness's own two-stage design.** hstack already got this right one layer out — `hstack/templates/*.md` is a genuine deferred-detail layer that Skills pass to subagents instead of inlining. The same instinct was simply never applied to the Skills' own frontmatter.
- **123 scripted `assistant:` turns stop anchoring the first response** before the real artifact is read.
- **Second copies deleted are second copies that cannot drift** — the failure the kernel/Notion divergence already demonstrated in this repo.
- **Zero migration surface.** Descriptions live in framework-owned files under `.claude/skills/` and `.claude/agents/`; `hstack update` overwrites them. No installer change, no manifest change, no symlink change, no `doctor` finding.

### Negative

- **Autonomous invocation gets worse before it gets better, and we cannot see it.** Verbose descriptions do help the model pick a Skill when the engineer describes a situation instead of typing the command. Cutting to 40 words optimises the typed path at the expense of the described one — and ADR-0009's attribution deliberately counts only structured markers, which *are* the typed path. We are cutting a surface the instrument we just built cannot measure.
- **Disambiguation among near-identical siblings is exactly where 40 words is tightest.** Routing `tech-debt-wontfix` where `tech-debt-stale` was meant writes a wrong terminal status onto a real artifact, and no gate catches it. The carve-out is a mitigation, not a proof.
- **It is a behavioural change with no test.** ADR-0010 was mechanical and verifiable by grep and smoke test; this changes what the model sees at decision time, and nothing in the repo asserts routing correctness. `doctor` can detect a missing file; it cannot detect a bad sentence.
- **52 files in one PR, uniformly boring.** The diff is large, repetitive, and low-signal per hunk — the shape of diff in which a mistake most reliably survives review.
- **Consumers diverge until they run `update`**, the same window ADR-0010 opened, and for the same reason cross-repo token comparisons are not meaningful inside it.

### Neutral

- The corpus does not get much smaller. Bodies keep their size; only the always-loaded fraction shrinks. Most of the 19,234 words are moved rather than removed — how much is provable duplication of body text is unmeasured, and the PR should report the split it actually found rather than assume one.
- ADR-0009's TE-4/TE-5 will show this as a baseline step change, not a phase cost, exactly as with ADR-0010. The first honest before/after needs at least one full change to run in moso-app on each side.
- The dev repo is not a consumer, so this ships blind here and is exercised in moso-app first.

### Challenge prompt — name two consequences that look bad

1. **This spends the audit's credibility on the 14%.** The same audit that produced this ADR established that in a 396k-token session, 344k (86%) is conversation and the whole startup baseline is ~56–76k. Recovering 27k of that baseline is real and permanent, but it is ~7% of a large session, and unlike the kernel rename it carries behavioural risk. If routing degrades even slightly, we have traded a measurable token win for an unmeasurable correctness loss — precisely the trade hstack's invariants exist to refuse. The honest defence is that 29.7k of dialogue in an index is a design error independent of its token price; the fair reading is that we ranked it above the 86% because it was easier to act on.
2. **It deletes the corpus's only worked examples of when *not* to invoke.** A meaningful minority of the 123 blocks are boundary cases, not illustrations — `hstack-change-plan`'s second example exists only to show the Skill halting because `data-review.md` is missing for a change whose `surfaces` include `db`. Those are the cheapest possible form of the "design interfaces" advice the article gives, and a blanket deletion of the block class takes the good ones with the bad. This ADR answers by *requiring* their migration into the body rather than assuming it — but that requirement is prose, enforced by a reviewer reading 52 hunks, which is the weakest enforcement mechanism the framework has. If one boundary case is lost, it will be lost silently and rediscovered as a mis-routed artifact.

## Alternatives Considered

**Option A — Status quo.** Keep the descriptions as documentation and accept ~29.7k. Rejected: the cost is per-session, permanent, present in every consuming repo, and paid in full by sessions that invoke nothing. It is also the single largest always-loaded surface in the framework, larger than the kernel that ADR-0010 spent a release on.

**Option B — Subagent descriptions only** (session A's original plan). ~10.2k of the ~29.7k, in the half where routing is already deterministic and the risk is therefore near zero. Rejected as a stopping point — it leaves the larger and more expensive half untouched — but adopted as the PR's internal sequencing, so that the safe half lands first and the risky half is separately attributable.

**Option C — Delink unused Skills per consumer instead of shrinking descriptions.** Real and complementary: the seven bootstrap Skills (`greenfield-init`, `brownfield-init`, `scaffold`, `app-architecture`, `data-architecture`, `stack-decide`, `product-discovery`) have zero invocations in 30 days in moso-app and are ~1.8k. Rejected as a substitute: it is a consumer-local operation, reversible per repo, it does nothing for the 29 Skills that stay linked, and it addresses which entries are in the index rather than how expensive each entry is.

**Option D — Keep the examples but move them from frontmatter into the body.** Zero routing risk, every worked case preserved, and the token saving is identical since the body is not always-loaded. Genuinely close, and rejected only as the *default*: it would preserve 123 dialogue blocks inside files that are already the largest in the corpus (`hstack-finalize` 21,002 bytes, `hstack-kernel-fit-scan` 20,742), and the article's point about examples constraining exploration applies to the body too — the body is what the model reads at execution time. Adopted for the subset that encodes a boundary case, per the Decision.

**Option E — Wait for `validate-spec.ts` and do descriptions together with body deduplication.** Rejected on independence. Body dedup genuinely depends on the executable validator — the repeated prose is today's only enforcement net — but nothing in a *description* is load-bearing enforcement, so nothing here needs the substrate. Coupling them would park ~27k per session behind ~400 lines of unrelated TypeScript.

**Option F — Set a budget and let it be enforced by `doctor`.** Add a `description-budget` finding that flags any Skill or agent whose description exceeds the limit, so the shrinkage cannot regress. Not rejected on merit — it is the correct follow-up — but deliberately out of this PR: a linter for a size that no file currently respects would flag 52 findings on day one, and the rule should be established by the rewrite before it is enforced by a tool.
