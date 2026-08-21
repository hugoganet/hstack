---
id: ADR-0012-say-it-once-one-rule-one-place
type: adr
status: accepted
owner: hugoganet
decision-date: 2026-08-21
supersedes: null
superseded-by: null
related-change-specs: []
related-modules: []
promoted-from-kernel-fit: []
created: 2026-08-21
updated: 2026-08-21
schema-version: 2
---

## Title

Every rule in the corpus has exactly one normative statement. The kernel **owns** each rule, the single file where the rule can actually be violated **states** it operationally, and every other file **references** it in one line. The 52 `## Anti-patterns` sections — 362 bullets, 7,134 words, almost all of them negations of a rule stated earlier in the same file — are removed, and the duplicated protocol restatements, session-start load lists, session-boundary blocks and telemetry-sidecar paragraphs collapse to their canonical home. No rule is deleted. Where the duplicated copies have already diverged, the kernel is corrected to carry the reconciled version *before* the copy is removed.

## Status

Accepted on 2026-08-21. Ships as one PR touching 52 files (36 `SKILL.md`, 16 agent files) plus `template/KERNEL.md` and `template/templates/telemetry-sidecar.md`. Fourth in the context-engineering sequence: ADR-0010 (kernel rename, ~15k in 46% of sessions), ADR-0009 (per-phase instrumentation, which makes the sequence measurable), ADR-0011 (the always-loaded routing index, ~27k in 100% of sessions). ADR-0011 explicitly deferred this work — *"body deduplication and the removal of the 52 `## Anti-patterns` sections (blocked on `validate-spec.ts`; until the validator exists the repeated prose is the only enforcement net)"*. v0.12.0 shipped that validator. This ADR spends the unblock.

## Context

ADR-0011 fixed the **always-loaded** surface: 19,234 words of frontmatter descriptions paid at turn zero of every session. It deliberately did not touch the **bodies** — the text a Skill or subagent loads when it is actually invoked. Measured on the dev repo at v0.12.0 (2026-08-21):

| Body surface | Files | Words | Bytes | ≈ tokens (4.83 b/tok) |
|---|---|---|---|---|
| `SKILL.md` bodies | 36 | 48,690 | 353,602 | ≈ 73k |
| Subagent bodies | 16 | 24,828 | 175,521 | ≈ 36k |
| **Total** | **52** | **73,518** | **529,123** | **≈ 110k** |
| `KERNEL.md` (for scale) | 1 | 8,262 | 61,404 | ≈ 12.7k |

Bodies are progressive-disclosure-correct: they load on invocation, not at turn zero. So this is not the same token argument ADR-0011 made, and it should not be sold as one. A single per-change workflow does load a large fraction of it — `hstack-test-plan` + `test-strategist` + `hstack-change-plan` + `planner` + `hstack-implement` + `implementer` + `hstack-verify` + `verifier` + `hstack-adversarial-review` + `adversarial-reviewer` is ≈ 40k of body text for one change — but the case here is a correctness case first and a token case second.

### The corpus states the same rules many times

Six duplication classes, each measured:

**1. `## Anti-patterns` — 52 sections, 362 bullets, 7,134 words, 48,174 bytes (≈ 10k tokens).** Present in every one of the 52 files. Almost every bullet is the negation of a rule stated earlier in the *same file*. `implementer.md` is representative: 17 anti-pattern bullets, of which 15 negate a Behavior rule, a Forbidden-tools entry, or a Stop condition that appears above it in the file, and 2 (`Never claim a phase complete when tests fail or types are stale`, `Never invent a migration filename`) are the only statement of their constraint. The section is not a summary — it is a second, differently-worded copy, and a differently-worded copy is how a rule drifts from itself.

**2. Test immutability — 17 substantive restatements across 6 files, on top of the kernel's canonical one.** The kernel's § Test immutability is 1,900 words: the definition, the four canonical authorization phrases, the carve-outs, the forbidden list, the enforcer map. Beyond it: `implementer.md` restates the protocol 8 times (Behavior rules, Forbidden tools, Stop conditions, 5 anti-pattern bullets), `hstack-implement` 4 times, `verifier.md` 2, `test-strategist.md` 2, `adversarial-reviewer.md` 1. The four phrases (`Ok to change test <name>`, …) appear in full in three files. This is the highest-stakes rule in the framework, and it is also the one with the most copies to keep in sync.

**3. Session-start load lists — duplicated in the kernel and in all 16 agent files, and 15 of the 16 have already diverged.** The kernel's § Product context carries a one-line load list per subagent. Each agent file carries its own `## Session start protocol`. They disagree in fifteen cases. Two examples the audit surfaced:

- `security-reviewer` — kernel names 5 documents (threat-model, hardening-checklist, tech-stack, ci-cd, infrastructure). The agent file lists 8: those five plus the change-spec, the In-Scope diff, and the kernel itself. The agent file is right; a security review that does not load the change-spec is not a review.
- `implementer` — kernel names change-spec, plan, test-plan, security-review, data-review / ui-brief / figma-handoff when present, tech-stack, and `infrastructure.md` when `surfaces` includes infra. The agent file adds the tech-debt artifacts named by `resolves-tech-debt` (required by AR-07, which audits the implementer's diff against each TD's Acceptance section) and the relevant module-spec (required by the module-invariant rule) — and omits `infrastructure.md` entirely. **Each list contains something the other is missing.** Neither is a superset. Deleting either one loses a real load.

The remaining thirteen diverge more mildly: twelve agent files declare `hstack/KERNEL.md — always loaded` where the kernel names it for only five, and eleven add mode-conditional loads (session-state on resume, extract-mode sources, prior-precedent artifacts) that the kernel's one-liner does not carry. `stack-architect` is the single agent whose two lists agree. **A duplicated list that has diverged fifteen times out of sixteen is not documentation; it is two systems of record.**

**4. `## Session boundary` — a ~1,880-byte section in 7 Skills whose last 1,491 bytes are byte-identical.** `hstack-adversarial-review`, `hstack-change-plan`, `hstack-finalize`, `hstack-implement`, `hstack-ship`, `hstack-test-plan`, `hstack-verify` each carry the same cut-notice format, the same kickoff-prompt template, the same "only facts no artifact already carries / three bullets maximum" rules, and the same "never cut mid-phase" paragraph. Only the opening paragraph differs per Skill. 6 of the 7 copies of the shared tail are pure redundancy — and the rule they state appears nowhere in the kernel, so the corpus has seven copies of a rule and no owner for it.

**5. Telemetry sidecar prose — two byte-identical paragraphs in 5 Skills, over a document that already declares itself canonical.** `template/templates/telemetry-sidecar.md` opens with *"This file is the canonical schema. The five emitting Skills restate it; when they disagree with this document, this document wins."* That sentence is an admission that five copies exist and a prediction that they will disagree. The step-0 phase-window paragraph (576 bytes) and the three-field explanation (661 bytes) are byte-identical in all five — 4,948 redundant bytes — and every word of both is already in the canonical document's § The phase window.

**6. Rule-specific repetition inside single files.** `hstack-finalize` states the TDs-first-then-change-spec ordering rule, with its rationale, 5 times (Purpose, step 2, step 3, Idempotency contract preamble and third bullet, Failure modes) — plus once in the kernel. `hstack-implement` states the scope-lock constraint 7 times. The "never invoke `spec-author` for a mechanical write, it costs ~25k tokens" justification appears in the kernel twice and in 9 Skills. The "Defensive Resolution/Triage Log check" — *if the log section is absent from a legacy artifact, append the header before writing the entry* — appears 6 times across 6 Skills in 4 slightly different wordings, which is what a copied paragraph looks like after two rounds of independent editing.

### Why the repetition was rational, and why it stopped being rational

Until v0.12.0 the repeated prose was the enforcement net. There was no executable check on any artifact rule, so a rule stated once in the kernel and violated in a Skill produced a malformed artifact that nothing caught. Restating the rule at every site where it could be violated was a real mitigation, and ADR-0011 correctly refused to remove it on those grounds.

v0.12.0 shipped `template/scripts/validate-spec.mjs`: **72 checks over 68 mechanized rule ids, with 11 deferred entries named rather than dropped.** Every artifact-shape rule the repeated prose was compensating for — SP-04/05/06/09/13/14, TD-01/04/05/06/07, AD-01..04, PL-02..05, TS-01..06, SR-01..05, DR-01..06, V-01..05, AR-01/02/05/06/07, KF-01..05, MS-01..03, UI-01/02, ST-01..03, INF-01..03, FL-01/02, CM-01, FM-01 — now fails a command the Skill already runs after every write. The prose is no longer the net. It is a second copy of a net.

**This unblock is partial, and the ADR is built on the partial version.** The validator checks artifacts on disk. It does not check behaviour. Test immutability, scope-lock, the forbidden-tools enumeration, session isolation, the branch-hygiene halt — none of these has a validator id, and the registry names why (TD-03 and CM-02 need git history; INF-04/05 and the judgment rules need a model). For those rules the prose is still the only net, and this ADR does not delete a single one of them. It reduces each from N statements to one.

### The precedent this repo has already run twice

ADR-0010 removed a second copy of the kernel that the harness was loading silently. ADR-0011's context section names the kernel-vs-Notion divergence — a "authoritative" schema doc that had drifted from the kernel it claimed to describe, discovered only when the validator was written against both. Both are the same failure: a second copy of a truth, maintained by intention rather than by mechanism, that diverged. The fifteen diverged session-start lists are the third instance, and the first one where **both** copies are partly right.

Anthropic's *The new rules of context engineering for Claude 5-generation models* names the pre-Claude-5 habit directly — "repeat yourself" becomes "say it once", on the grounds that a restated instruction reads as a *new* instruction and the model spends attention reconciling the two. The same article reports removing over 80% of Claude Code's own system prompt with no measured regression. hstack's bodies are the last surface in the framework where the old habit is still fully intact.

## Decision

**One rule, one place. The kernel OWNS it, the enforcement point STATES it, everything else REFERENCES it.**

The three roles are exclusive and every rule gets exactly one file in each role (the first two may be the same file).

- **OWNS — `KERNEL.md`.** The normative statement: what the rule is, why it is load-bearing, what its carve-outs are. This is the text that changes when the rule changes. If a rule has no kernel statement and is not local to one file, it is *added* to the kernel by this PR rather than left with N owners.
- **STATES — the single file where the rule can be violated.** The operational restatement: the halt, the protocol, the exact phrasing the model must produce. Chosen by asking *which file's execution could break this rule?* — not *which file cares about it?* Test immutability is stated in `implementer.md`, because the implementer is the only subagent that writes code. Scope-lock is stated in `implementer.md` and re-stated in `hstack-implement` exactly twice: once as the precondition the Skill checks before invoking, once in the subagent invocation itself.
- **REFERENCES — every other file.** One line naming the rule and its home. Never the rule's content, never its rationale, never its exceptions. `verifier.md`, `adversarial-reviewer.md` and `test-strategist.md` keep their own *detection duties* (the verifier's diff-vs-prior-run refusal, the reviewer's spec-compliance finding, the strategist's read-only posture) — those are distinct rules, not restatements — but they lose the copy of the protocol.

**`## Anti-patterns` sections are removed from all 52 files.** A bullet survives only if it is the sole statement of its constraint in that file, in which case it moves into the section that owns it (Behavior rules, Forbidden tools, Stop conditions, or Failure modes) rather than being deleted. The test is mechanical: grep the file for the constraint; if it appears above the anti-patterns section, the bullet goes.

**Reconciliation precedes deletion, always.** For every duplicated passage that has diverged, the divergence is *arbitrated* first — the canonical home is edited to carry the reconciled content — and only then is the copy removed. A divergence is never resolved by deleting the side that is easier to delete. Each arbitration is one row of the PR's ledger, with the direction of the correction named. The default arbitration direction is **toward the file that runs the rule**: an agent file's session-start list reflects what that agent actually needs, and where it contradicts the kernel's one-liner the agent file is presumed right unless the kernel's version names something the agent's omits — in which case the reconciled list is the union, and the union is what the kernel gets.

**Every rule id removed from a body must be verifiable somewhere else.** Before an `SP-*`, `TD-*`, `AR-*`, `PL-*`, `TS-*`, `SR-*`, `DR-*`, `V-*`, `KF-*`, `MS-*`, `UI-*`, `ST-*`, `INF-*`, `FL-*` or `CM-*` reference is deleted from a body, it must be present either in the validator's rule registry (`node hstack/scripts/validate-spec.mjs --rules`) or in the kernel. The PR ledger cites which, per row. A rule id that is in neither is not a duplicate — it is the last copy, and it stays.

**New kernel sections.** Two rules currently have N copies and no owner, and the kernel acquires them:

1. **§ Session boundaries** — the cut-notice format, the kickoff-prompt template, the context-block rules, and the never-cut-mid-phase rule. The 7 Skills keep their own one-sentence "this phase is a natural cut, and here is the durable state the next phase loads" and a pointer.
2. **§ Mechanical operations → Resolution Log appends** gains one clause: *if the log section header is absent from a legacy artifact, append it before writing the entry.* The 6 Skills carrying the Defensive-check paragraph keep the action inline (it is executable) and lose the explanation.

**The telemetry sidecar document is the schema's only owner.** Its self-description changes from *"the five emitting Skills restate it"* to *"the five emitting Skills reference it"*. Each of the five keeps: its own JSON schema block (Skill-specific fields are not duplication), the executable step-0 call, and a one-line pointer for the field rules. Per ADR-0009 the three phase-window fields must read identically in all five — so all five get the *same* pointer sentence, byte-for-byte. Half-pointer / half-restatement across the five would be worse than either.

**Sequenced for attributability, as in ADR-0011.** Kernel reconciliation first (nothing is deleted yet), then the 16 agents, then the 36 Skills, then the release. If an adherence regression appears afterwards, the three halves are separately revertable.

**What does not change.** Every rule, every gate, every stop condition, every halt, every status lifecycle, every "when not to invoke" line ADR-0011 migrated into the bodies, every schema. Frontmatter descriptions are not touched — ADR-0011 settled that surface and reopening it here would confound two changes. **In case of doubt about whether a passage is a duplicate: keep it.** A retained duplicate costs tokens; a deleted last copy costs a rule.

## Consequences

### Positive

- **Fifteen diverged session-start lists get arbitrated instead of accumulating.** This is the change's real payload. Two of the fifteen were materially wrong in a way that affects output: the kernel was telling `security-reviewer` to review a change without loading the change-spec, and `implementer.md` was omitting `infrastructure.md` for infra-surface changes. Both are corrected by the reconciliation step, and neither would have been found without doing this dedup.
- **≈ 25–30k tokens off the per-change body load**, concentrated in the files a change actually invokes. Smaller and less certain than ADR-0011's ≈ 27k, and paid only by sessions that invoke Skills — but it is paid at the moment the model is doing the work, not at turn zero.
- **362 negated restatements stop competing with their own positive statements.** A rule stated once as a requirement and again as a prohibition is two instructions; the model reconciles them. Where the two wordings have drifted, it reconciles them wrongly.
- **The corpus becomes maintainable by grep.** After this change, "where is the test-immutability rule?" has two answers (kernel, `implementer.md`) instead of eight. Changing it means editing two files, not eighteen with no list of which eighteen.
- **The validator's registry becomes the visible enforcement surface.** Today a reader cannot tell which of the 362 anti-pattern bullets are backed by an executable check and which are prose hope. After this change, artifact rules live in the registry and behavioural rules live at their enforcement point; the distinction is legible.
- **Zero migration surface**, as with ADR-0010 and ADR-0011: framework-owned files under `.claude/`, overwritten by `hstack update`. No installer, manifest, symlink or `doctor` change.

### Negative

- **This bets that a pointer is obeyed as strongly as a restatement, and we have no evidence for the bet.** Repetition is a real recall mechanism; the Anthropic guidance is about system-prompt bloat and about instructions that compete, not a proof that within-file redundancy is inert. If pointer-only weakens adherence to test immutability, the failure mode is an edited assertion in a shipped PR — precisely the failure the rule exists to prevent, and one hstack cannot currently detect. This is the same unmeasurable-risk trade ADR-0011 named, taken a second time on a higher-stakes surface.
- **The reconciliation step makes this a behaviour change wearing a dedup's clothes.** Fifteen session-start lists get a winner picked. Every arbitration silently changes what a subagent loads. Shipping semantic changes inside a 52-file PR whose headline is "delete duplicates" is the exact shape in which a real change survives review unnoticed — which is why the ledger exists, and the ledger is prose read by a human, the weakest enforcement the framework has.
- **The validator's coverage is narrower than the deletion.** It backs artifact-shape rules only. For test immutability, scope-lock, forbidden tools and session isolation the net is still prose, and this ADR thins that prose from N statements to one on the argument that N statements were not N nets. That argument is sound but untested.
- **52 files, ~50 hunks, uniformly boring** — the same review-hazard shape ADR-0011 called out, on a larger diff.
- **Consumers diverge until they run `update`**, and cross-repo body-token comparisons are meaningless inside that window.
- **Two new kernel sections make the always-loaded kernel bigger** to make 52 sometimes-loaded bodies smaller. Session boundaries adds ≈ 250 words to a file loaded in 100% of sessions, to remove ≈ 1,100 words from 7 files loaded in some of them. Net-positive on total tokens only if the average session invokes more than roughly two of the seven Skills; net-positive on *correctness* unconditionally, which is the argument actually being made.

### Neutral

- ADR-0009's TE-4/TE-5 will show this as a per-phase step change, not a baseline one — the opposite shape from ADR-0010 and ADR-0011, and the first of the four that instrumentation can attribute to a phase rather than to startup. The first honest before/after needs one full change run in moso-app on each side.
- The dev repo is not a consumer, so this ships blind here and is exercised in moso-app first, as with ADR-0011.
- The word counts in the PR are the measurement of record. The audit's indicative targets (Skills 47k → ~30k, agents 31k → ~22k) are estimates made before the reconciliation step was scoped; the PR reports what it actually found, including the cases where "keep on doubt" won.

### Challenge prompt — name two consequences that look bad

1. **The strongest evidence in this ADR argues against its own method.** The finding that carries this change is that fifteen of sixteen duplicated lists diverged — which is an argument that duplication is dangerous. But it is equally an argument that *the agent files were being maintained and the kernel was not*. In eleven of the fifteen cases the agent file is the more accurate document, and it is more accurate precisely because it sits where the work happens. Centralising into the kernel moves every one of those rules further from the file whose author would notice it going stale, and the mechanism that will keep the kernel current is the same one that failed for the last fifteen: intention. A more honest reading of the evidence would delete the *kernel's* copy and let the enforcement point own it outright — and this ADR chose the other direction mostly because "the kernel wins all conflicts" is already the framework's constitutional rule, not because the evidence pointed there.
2. **It removes the corpus's only redundancy on the one rule that has ever mattered.** Test immutability exists because the dominant failure mode of LLM implementation is editing the test instead of the code. The seventeen restatements are ugly, they have drifted, and at least five of them are pure noise — but they also mean that a model which skims `implementer.md`'s Behavior rules still meets the rule again in Forbidden tools, again in Stop conditions, and again in five anti-pattern bullets before it writes a line. This ADR replaces that with one statement and four pointers, on a rule whose violation is silent, lands in a shipped PR, and is caught by nothing in the framework. If exactly one of the six duplication classes should have been left alone, it is this one, and the ADR's answer — that the kernel's canonical statement is loaded in every subagent session anyway — is a defence of the *availability* of the rule, not of its *salience*, and salience is what the seventeen copies were buying.

## Alternatives Considered

**Option A — Status quo.** Keep the repetition as an enforcement net. Rejected: the net is now executable for every artifact rule that has an id, and for the rules it does not cover the fifteen diverged lists are direct evidence that N copies is not N nets — it is one net plus fourteen opportunities to drift. The status quo also has no stopping condition: the 52nd anti-patterns section was added because the 51 before it existed.

**Option B — Delete the duplicates without reconciling.** Cheapest, mechanical, reviewable by diff alone. Rejected outright, and it is the failure mode this ADR is most concerned with: eleven of the fifteen diverged lists would lose the more accurate side, and two would lose a load that a rule elsewhere in the corpus requires (`resolves-tech-debt` TDs for AR-07, `infrastructure.md` for infra surfaces). Any dedup that does not arbitrate is a silent regression generator. The reconciliation-first sequencing in the Decision exists to make this option unavailable.

**Option C — Remove the `## Anti-patterns` sections only.** ≈ 10k tokens, one mechanical rule ("delete the section, migrate the orphan bullets"), near-zero arbitration risk, and it needs no kernel edits. Genuinely attractive and close to adopted. Rejected as a stopping point because it takes the safest 30% of the win and leaves the fifteen diverged lists in place — the part of the corpus that is actually wrong, as opposed to merely redundant. Adopted as the PR's first substantive commit so that the safe part lands separately and stays revertable on its own.

**Option D — A `doctor` finding that flags duplicated paragraphs across the corpus.** Detects the class mechanically (normalized-paragraph hashing found five of the six classes in this ADR in under a second) and prevents regression. Not rejected on merit — it is the correct follow-up, and it is the mechanism the challenge prompt says the kernel will otherwise lack. Deliberately out of this PR for ADR-0011's reason: a linter for a property that 52 files currently violate reports 52 findings on day one, and the rule should be established by the edit before it is enforced by a tool. It also cannot catch the interesting case — a paragraph that has *diverged* no longer hashes equal, so the detector would have found the byte-identical Session boundary blocks and missed all fifteen session-start divergences.

**Option E — Move the shared prose into `hstack/templates/*.md` reference files that Skills read on demand.** Progressive disclosure one level further down, the pattern ADR-0011 already used for `hstack-kernel-fit-scan`'s Slack setup. Rejected for behavioural rules: a rule the model must obey while executing cannot depend on the model choosing to go read it, and "read the reference file first" is itself an instruction that competes. Adopted for exactly one case where the content is a schema rather than a rule — the telemetry sidecar, which already has such a file and already declares it canonical.

**Option F — Keep the restatements but mark them non-normative** ("*restated for convenience; see KERNEL.md § X for the normative text*"). Preserves salience, kills the ambiguity about which copy wins, costs a few words per copy. Rejected on the evidence: it is what `template/templates/telemetry-sidecar.md` already does — *"the five emitting Skills restate it; when they disagree with this document, this document wins"* — and the five copies drifted anyway in the Skills' surrounding prose. A precedence rule tells you which copy to believe once you have noticed they differ; it does nothing to make anyone notice.

**Option G — Do this before ADR-0011 rather than after.** Not available in hindsight, but worth recording: bodies are the larger surface (73,518 words vs 19,234) and the diverged lists were the more serious defect. ADR-0011 went first because it was unblocked and this was not. The ordering was forced by the validator's absence, which is the clearest argument in the sequence for building the executable check before the documentation cleanup rather than after.

## Forecloses / Enables

**Enables.**

- A `doctor` duplicate-paragraph finding (Option D) becomes implementable against a corpus that passes it, rather than one that reports 52 findings.
- A per-Skill body-size budget, the body-level analogue of ADR-0011's ≈ 40-word description budget, becomes a rule that most files already satisfy.
- Extending the validator to behavioural rules gets a legible target list: after this change, every rule with no validator id is stated in exactly one place, so the gap between "rules the machine checks" and "rules only prose carries" is enumerable.
- Roadmap item *hstack as a distributable framework*: a corpus with one statement per rule is one a consumer can fork and edit without hunting for the other seven copies.

**Forecloses.**

- Per-file customisation of a shared rule. Once the session-boundary rule lives in the kernel, a Skill that wants a different cut discipline has to amend the kernel or carve out explicitly — it can no longer diverge quietly, which is the point and also the cost.
- The redundancy-as-salience strategy for behavioural rules, corpus-wide. If test-immutability adherence regresses, the fix is not "put the copies back" — it is a mechanism (a hook, a CI check on test-file diffs, a validator extension against git history). This ADR bets on that direction being right and makes the retreat expensive.
- Cheap review of the next body change. With the anti-patterns sections gone, a reviewer can no longer check a Skill's constraints by reading its last section; they have to read the whole file or trust the kernel. The summary-at-the-bottom affordance is real, and it is being spent.
