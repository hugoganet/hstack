---
id: ADR-0013-the-kernels-diet
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

`KERNEL.md` keeps ownership of every rule and gives up the mode d'emploi. ADR-0012 established that the kernel **OWNS** each rule; this ADR fixes what OWNS costs: the statement of authority — what the rule is, why it is load-bearing, what its carve-outs are — plus a pointer to the file that runs it. Not the step-by-step. The procedural detail that duplicates a Skill's own orchestration steps moves to that Skill, in the same commit that removes it from the kernel. The kernel goes from 8,940 words (≈ 13.7k tokens, paid in 100% of sessions and by every subagent) to roughly half that. No rule loses its owner, and no rule id leaves the kernel without landing in the validator registry or at its enforcement point.

## Status

Accepted on 2026-08-21. Ships as one PR against `main` at v0.13.0. Fifth in the context-engineering sequence: ADR-0010 (kernel rename), ADR-0009 (per-phase instrumentation), ADR-0011 (always-loaded descriptions, ≈ 27k), ADR-0012 (bodies, one rule / one place). ADR-0012 shipped yesterday and made this possible: before it, the kernel's procedural passages were load-bearing because the Skills' own copies had diverged and there was no arbitration. ADR-0012 arbitrated them. What is left in the kernel is now, in the cases this ADR names, a second copy of a Skill's own steps.

This ADR **amends ADR-0012; it does not contradict it.** The OWNS / STATES / REFERENCES model stands unchanged. The amendment is one clause on the definition of OWNS.

## Context

ADR-0012's own arithmetic is the setup for this one. It reported the kernel at 8,262 words / ≈ 12.7k tokens as the *scale reference* against which the 52 bodies were measured — the small thing the big thing was compared to. It then added two sections to the kernel (§ Session boundaries, and the Resolution-Log clause) and reconciled sixteen session-start lists into it, and named the cost in its own Negative consequences:

> **Two new kernel sections make the always-loaded kernel bigger** to make 52 sometimes-loaded bodies smaller. […] Net-positive on total tokens only if the average session invokes more than roughly two of the seven Skills.

Measured at HEAD (c33525b), post-ADR-0012:

| Surface | Words | Bytes | ≈ tokens (4.83 b/tok) | Paid |
|---|---|---|---|---|
| `KERNEL.md` | 8,940 | 66,213 | ≈ 13.7k | every session, every subagent |
| 36 `SKILL.md` bodies | — | — | ≈ 62k | on invocation |
| 16 agent bodies | — | — | ≈ 31k | on invocation |

The kernel is the only body in the corpus with no progressive disclosure at all. It is loaded at turn zero of the main session and again, in full, inside every one of the sixteen subagents — so a single per-change workflow that spawns `test-strategist`, `planner`, `implementer`, `verifier` and `adversarial-reviewer` pays for it six times. Per-section:

| Section | Words | ≈ tokens |
|---|---|---|
| § Mechanical operations | 1,600 | 2,521 |
| § Tech-debt resolution | 1,067 | 1,654 |
| § Product context | 999 | 1,666 |
| § Test immutability | 719 | 1,023 |
| § How hstack improves itself | 649 | 1,022 |
| § Cross-session coordination | 535 | 813 |
| § Frontmatter contract | 487 | 748 |
| § Stop conditions | 426 | 593 |
| everything else (16 sections) | 2,458 | ≈ 3,700 |

### The kernel is carrying three different kinds of text

**Authority.** "Once a test file exists in the working tree, no hstack subagent may edit or delete it without per-test, per-conversation human authorization." "One module per change-spec." "The human gates promotion to a kernel change." This is what the kernel is for, and it is a minority of its bytes.

**Enumeration.** Twelve bullets naming which Skill writes which frontmatter field. Fourteen bullets describing what each context document contains. Six ordered steps of `/hstack:tech-debt-resolve`. Each of these is a second copy of a list the destination file already carries — verified, file by file, in the ledger. Unlike ADR-0012's cases, these have *not* diverged, because they were written from each other. They are simply paid twice, and one of the two payments is charged to every subagent in the framework.

**Mode d'emploi.** "The Skill runs a two-question interview: *Why won't this be fixed?* and *What are we accepting as the alternative?* Both answers are required and become non-null `wontfix-reason` and `wontfix-accepted-alternative` frontmatter fields (TD-06)." That is `hstack-tech-debt-wontfix`'s steps 2, 4 and 6, in the kernel, where the only readers are fifteen subagents that will never run it.

### Why ADR-0012's model permits this and why it did not do it

ADR-0012 defines OWNS as *"the normative statement: what the rule is, why it is load-bearing, what its carve-outs are. This is the text that changes when the rule changes."* That definition already excludes a six-step orchestration. But ADR-0012 was scoped to the 52 bodies and explicitly held the kernel constant except where reconciliation forced an edit — it was correcting the copies, not the original. Its Decision even says *"if a rule has no kernel statement and is not local to one file, it is added to the kernel by this PR"*, which moved text in exactly one direction. This ADR runs the other direction, under the same definition.

The amendment, stated once: **OWNS = the statement of authority plus a pointer. A passage belongs in the kernel only if changing the rule would change that passage.** If the passage would survive verbatim through a rewrite of the rule's procedure, it is procedure, and procedure lives with the executor.

### The other two things this file still gets wrong

**The Notion "template schemas" doc is cited as authoritative and has diverged.** The kernel names it three times, once as a hard gate: *"Read it before any template instance is authored."* An audit on 2026-08-15 found the doc pre-dates the Categories work (SP-09 there is the two-category version), still carries `mvp-scope` (removed by ADR-0008), and is missing roughly nine artifact types the repo now ships templates for. v0.12.0's validator registry already ruled on this independently — its deferred list says of AR-03 and SP-01..SP-03: *"The id exists only in the diverged Notion schema doc, which is not authoritative."* The kernel and the validator currently disagree about which document is canonical, and the validator is right. This is the same failure ADR-0010 and ADR-0011 both hit: a second copy of a truth, maintained by intention, that diverged.

**Reads are unbounded for local artifacts and bounded for remote ones.** The kernel already requires frontmatter-first reads of a *peer's* committed state (§ Cross-session coordination), for the good reason that a peer's artifact is expensive and mostly irrelevant. It says nothing about the local tree. A transcript audit of the dev repo found **277 individual file reads over 8k characters — 28% of the total text volume across sessions**, with `spec.md` read end-to-end 41 times where the reader needed `status` and `in-scope`. The rule exists; it is scoped to the one case that happens least.

## Decision

**Amendment to ADR-0012: OWNS is authority plus a pointer, not a manual.** The kernel states the rule, its rationale, its carve-outs and the name of the file that runs it. The steps live with the runner. ADR-0012's three roles, its reconciliation-before-deletion sequencing, and its "in doubt, keep" tiebreak all stand.

**Nothing ADR-0012 consolidated into the kernel yesterday is a candidate.** The sixteen reconciled session-start load lists, § Session boundaries and § Halt sentinel are explicitly out of scope. They were arbitrated one commit ago; re-litigating them in the next PR would make the arbitration meaningless and would be the exact move ADR-0012's ledger existed to prevent.

**Landing precedes deletion, in the same commit.** Every passage removed from the kernel is present in its destination file at the moment of removal, and both edits are in one commit. No commit in this PR leaves a rule without a home. Where the destination already carries the passage — the common case, verified per row — the commit removes from the kernel only.

**The subagent-load check is mandatory and per-row.** The kernel is loaded by all sixteen subagents; a `SKILL.md` is not loaded by any of them. So for each passage the question is not only *does it land somewhere* but *did a subagent need it?* Where a subagent needed it, the passage stays in the kernel or moves into that subagent's file — never into a Skill. Three rows in the ledger resolved this way.

### The arbitrations

**§ Tech-debt resolution — 1,067 → 244 words. Moved.** The kernel keeps the three terminal exit paths, both reciprocal pairs with their atomicity guarantee, the prohibition on manual edits to the status machine, and the "one change-spec, one bounded contract" ruling on partial resolution. It gives up the six-step resolution flow, the wontfix two-question interview, the stale one-question interview, and the per-Skill write enumerations — all of which are the orchestration steps of `hstack-tech-debt-resolve`, `-wontfix`, `-stale` and `hstack-finalize`, already stated there. Subagent check: no subagent runs any of the four Skills; `implementer` needs each referenced TD's Acceptance section (kept, in the § Product context load list), `adversarial-reviewer` needs AR-07 (its own file, plus the validator registry), `spec-author` needs TD-03 immutability (its own file). Passes.

**§ Mechanical operations — 1,600 → 430 words. Moved.** The kernel keeps the boundary — *if the Skill knows the value before invoking, the Skill writes; if the value comes from a conversation, `spec-author` runs the conversation* — the subagent-vs-orchestrator reading that makes it legal, the `app-architect` stub carve-out, the taxonomy of what counts as mechanical, and the four discipline rules (validator after every write, auto-commit, atomicity for reciprocal pairs including the finalize-in-progress carve-out, idempotency). It gives up the twelve-bullet skill-by-skill enumeration of direct writes, the worked examples inside the structured-elicitation bullet, the paragraph describing the validator's own capabilities, and the telemetry-sidecar paragraph. The `## Atomicity for reciprocal pairs` heading is preserved verbatim because `hstack-kernel-fit-promote` cites it by name. Subagent check: `spec-author` needs "mechanical operations are not your job" (its own file, line 60); `app-architect` needs its carve-out (its own file, line 80 — and the kernel keeps it anyway, since a carve-out is authority). The validator-capability paragraph is replaced by a pointer to `validate-spec.mjs --rules`, which is the same text generated from the registry that enforces it. Passes.

**§ How hstack improves itself — 649 → 137 words. Moved.** The kernel keeps the non-negotiable contract (the human gates promotion; auto-creation of ADRs is forbidden), one paragraph naming the loop's layers and the Skills that drive them, and — as authority, not detail — the named carve-out from the MCP-unreachable stop condition for the Slack nudge. It gives up the five layer descriptions, which restate `hstack-kernel-fit-scan` (2,086 words), `-triage`, `-promote`, `hstack-flag` and `kernel-fit-analyst.md`. Subagent check: `kernel-fit-analyst` loads the kernel *as the artifact under analysis*, so it reads whatever the kernel says by construction; its duties are in its own file. Passes.

**§ Test immutability — 719 → 611 words. Substantially kept; the arbitration is a deliberate no.** The user's brief asked explicitly whether the carve-outs and the Forbidden list could live at the enforcement point with a pointer. The answer is no, for three reasons, and the ADR records it rather than leaving it implicit. (1) ADR-0012's own challenge prompt named this the one duplication class that should have been left alone, and it thinned it from seventeen statements to two one day ago; thinning the survivor the next day is not what "in doubt, keep" means. (2) This rule has no validator id — not even a deferred one. The registry has no test-immutability entry at all, because the rule constrains behaviour, not artifacts. Prose is the whole net. (3) Four subagents enforce it from four different angles and all four load the kernel, which is precisely the case where kernel residence is cheap in *reach* terms even when it is expensive in tokens. What moves is one paragraph: the **Enforcers** map, which is a directory of four duties that are each stated in full in the file that owns them (`implementer.md` line 45, `verifier.md` line 52, `adversarial-reviewer.md` line 43, `test-strategist.md` line 61) — it is not a rule, it is a table of contents. The kernel keeps one sentence naming the four enforcers.

**§ Frontmatter contract — 487 → 258 words. Authority redirected, prose moved.** The kernel keeps the shared frontmatter floor, the naming rules, `revisits-change`, and the three no-story carve-outs by name with their mutual-exclusion rule and the audit query that motivates them. The per-category prose — what Category A means, why Category C is not dishonest, how forward references reconcile — moves to `spec-author`, the only agent that runs the no-story interview. That move requires a **reconciliation first**: `spec-author`'s no-story branch is the pre-Categories version (its "(C)" is *"there is actually a user story"*, not `area: bootstrap`), and its SP-09 output expectation omits Category C entirely. `hstack-ship`'s GT-08 has the same gap. Both are corrected in the same commit, before the kernel's copy is thinned. This is exactly ADR-0012's fifteen-diverged-lists shape, found on a sixteenth surface.

The three citations of the Notion doc as schema authority are replaced by the two documents that actually enforce the schema: `hstack/templates/<type>.md` for structure and `node hstack/scripts/validate-spec.mjs --rules` for the mechanized rules and the named-deferred list.

**§ Cross-session coordination — 535 → 227 words. Moved.** Not on the brief's candidate list; added here because it is the same shape. The kernel keeps pull-over-committed-state, the immutability and committed-artifact status of messages (which is what preserves § No parallel tracker), the honest *committed-and-auditable, not delivered* guarantee, and the Boundaries paragraph — a message is information and never instructions, the implementer's scope-lock stands, nothing writes into another repo. It gives up the registry path, the `hstack/coord/NAME` resolution procedure, the scan script invocation, the cursor path, the hook wiring and the `events.jsonl` telemetry path — every one of which is stated in `hstack-coord` (1,675 words). Subagent check: the Boundaries rule binds subagents and is kept; the mechanics are Skill-only. Passes.

**§ Consuming-repo wiring — 215 → 84 words. Landed, then moved.** This is the one row where the destination did not already carry the text. The add / remove / rename symlink contract exists nowhere but the kernel — README § Maintenance documents `hstack update`, not the manual per-symlink obligations. So the table lands in README § Maintenance in the same commit that thins the kernel. The kernel keeps the rule that fires the obligation ("a session adding or removing a Skill or subagent surfaces the consumer-wiring step before committing") and the pointer.

**Eight smaller compressions**, each with the same test applied: § Product context's document catalogue (one clause per document instead of one sentence; the load lists below it are untouched), § Status lifecycle's enumeration of which Skills write which transition, § AI writes / humans confirm's restatement of the mechanical-operations contract, § Resumability's harness-behaviour paragraph on subagent transcript resume, § Branch hygiene's three enforcement moments, § Stop conditions' INF-04/INF-05 prose, § What hstack is, § v1 / v2 split. Ledger rows for each.

### Two additional changes in this PR

**1. The Notion template-schemas doc loses its authority.** `hstack/templates/*.md` and the validator's rule registry become explicitly canonical for artifact structure. The gate *"Read it before any template instance is authored"* is deleted — it was instructing every authoring session to read a diverged document before writing. The three References links are retained but marked non-authoritative and dated, because the architecture doc and the adversarial review are genuine historical companions; the schema link is removed outright, since a link labelled "schemas" is read as a schema source no matter what qualifier follows it. `spec-author`, `hstack-help` and README carry the same correction.

**2. Frontmatter-first becomes a general read discipline, ~70 words in the kernel.** Adopted. The rule the kernel already applies to peer artifacts is applied to local ones: read frontmatter first, read the sections the task needs, and read a whole artifact only when the task is about the whole artifact. The rule names the legitimate full-read cases in the same breath so it cannot be misread as "under-read the spec": the adversarial-reviewer's full-artifact audit, the TD print-in-full step that exists so a human re-reads it, and code within `in-scope`. Applied at the three heaviest sites — `hstack-help --change`, `hstack-ship` step 1, and `hstack-implement`'s precondition sweep, all of which currently say "read every artifact" where they need six frontmatter fields.

**3. Hygiene: `hstack-version: v0.6.0` in the kernel's frontmatter is deleted, not corrected.** The field has been wrong through seven releases, which is the evidence that nothing reads it: no Skill, no subagent, no script, and no installer greps for it (verified). The root `VERSION` file is the single source, `hstack update` diffs the tree rather than the field, and a version string that nothing validates is a fact maintained by intention — the failure mode this whole ADR sequence is about. Deleting it removes the drift surface; `authority: kernel` stays.

## Consequences

### Positive

- **≈ 6.5k tokens off every session and every subagent invocation.** Unlike ADR-0012's saving, which is paid only by sessions that invoke Skills, this one is unconditional and multiplied: a change that spawns five subagents pays the kernel six times, so the per-change saving is ≈ 39k, not ≈ 6.5k. It is the largest single reduction of the four context-engineering ADRs and the only one that compounds with subagent count.
- **The amendment gives OWNS an operational test.** "Would this passage change if the rule changed?" is checkable by a reviewer in one read, which is more than "is this a duplicate?" ever was. It also gives the kernel a stopping condition it has never had — every prior ADR in this sequence *added* to the kernel, and none of them named a criterion for when it is too big.
- **The kernel and the validator stop disagreeing about who owns the schema.** They have contradicted each other since v0.12.0, in the direction that costs most: the kernel told authors to read the diverged doc, and the validator refused to implement ids that exist only there.
- **A sixteenth diverged copy gets caught.** `spec-author`'s no-story interview and `hstack-ship`'s GT-08 are both pre-Categories. Neither would have surfaced without doing this pass; ADR-0012's audit did not look at the kernel's side of the pair.
- **Zero migration surface**, as with ADR-0010 / -0011 / -0012. Framework-owned files under `template/`, overwritten by `hstack update`. No installer, manifest, symlink or `doctor` change.

### Negative

- **This is the second consecutive PR to thin the same corpus, and the second consecutive bet with no measurement between them.** ADR-0012 shipped yesterday and has not been exercised in a real change run in moso-app. If adherence regressed there, this PR's diff is layered on top of an unvalidated one and the two are hard to attribute apart. The honest description is that both are being run on judgment, and ADR-0009's per-phase instrumentation will attribute the pair, not each half.
- **The kernel is loaded by every subagent, which is exactly why some of its bloat was load-bearing.** A passage removed to a `SKILL.md` is invisible to all sixteen. The per-row subagent check is the mitigation, and it is a human reading a ledger — the weakest enforcement the framework has, as ADR-0012 already said of its own ledger. The check found three cases; it cannot prove it found all of them.
- **Kernel residence buys salience, not just availability, and this trades salience for tokens on ten sections at once.** The argument that a Skill's step-6 states the rule at the moment of use is strong for Skills and weak for the main session's model, which reads the kernel once at turn zero and then reasons from it for an hour. This is the same unmeasurable bet ADR-0012 named; taking it a second time in two days does not make it better-evidenced.
- **The frontmatter-first read rule is an instruction to read less, given to a model whose failure mode under uncertainty is to read less.** It is stated with its carve-outs for exactly this reason, but a rule that says "don't read the whole file without a reason" will sometimes be obeyed when there was a reason. Under-reading a spec is silent and produces a plausible wrong answer; over-reading one costs tokens and produces a right one. The asymmetry does not favour the rule.
- **Deleting `hstack-version` gives up a diagnostic that was never used but was cheap.** If a consumer's `hstack/KERNEL.md` and their `hstack/VERSION` ever disagree, there is now one fewer place to notice it. The field would have had to be *maintained* to serve that purpose, and it was not — but the argument is "it was already broken", which is a weaker defence than "it was unnecessary".

### Neutral

- The kernel's section headings are all preserved, including `§ Mechanical operations → Atomicity for reciprocal pairs`, so every existing `KERNEL.md § X` pointer in the 52 bodies still resolves. Verified by grep in the PR.
- Word counts in the PR body are the measurement of record. The brief's target was ~4,500 words; the PR reports what the arbitrations actually produced, including § Test immutability, where "keep" won and cost roughly 150 words against that target.
- The dev repo is not a consumer; this ships blind here and is exercised in moso-app, as with ADR-0011 and ADR-0012.

### Challenge prompt — name two consequences that look bad

1. **The kernel's authority rests partly on its weight, and this ADR is spending that.** "In any conflict between this kernel and another document — the architecture doc, a template schema, an ADR, any source — this kernel wins" is the first substantive line in the file, and it is a claim that has been backed by the kernel visibly containing the most detail about everything. After this change the kernel wins conflicts it no longer participates in: a reader comparing `hstack-tech-debt-wontfix` against the kernel on the wontfix interview will find the kernel silent, and silence is not a conflict the precedence rule can resolve. The failure mode is not that a Skill contradicts the kernel — it is that a Skill *extends* into the vacuum and nobody notices, because there is no longer a kernel sentence for the extension to contradict. Every one of the ten thinned sections creates that vacuum deliberately, and the framework's only detector for it is the kernel-fit loop, which reads shipped practice and would take months of change-specs to notice.

2. **The evidence for the read-discipline rule is a measurement of cost, not of harm.** 277 reads over 8k characters is a token fact. Nothing in the audit shows that any of those reads produced a worse outcome, and the plausible causal story runs the other way: sessions that read `spec.md` in full 41 times were sessions doing careful work. Adding a rule that discourages the behaviour, on evidence that only establishes it is expensive, is optimising a metric that was never the objective — and it is being added to the same file this ADR is arguing should contain less. The rule earns its place only if under-reading is genuinely rare, and hstack has no instrument that would detect it.

## Alternatives Considered

**Option A — Status quo.** Ship ADR-0012 and stop. Rejected, but the strongest alternative on the list: it is the one that gets a measurement between two bets. What defeats it is that the two changes are the same change — ADR-0012 removed the copies and left the originals, and several of those originals are procedural passages that only existed because the copies did. Stopping now leaves the kernel at its all-time maximum size, right after an ADR whose own Negative section flagged that it had made the always-loaded surface bigger.

**Option B — Split the kernel into a core and an appendix, both under `hstack/`, with only the core auto-loaded.** Genuinely attractive: it keeps every word, costs nothing in authority, and is a pure progressive-disclosure move of the kind ADR-0011 already made for `hstack-kernel-fit-scan`'s Slack setup. Rejected on ADR-0012's Option E reasoning, applied to a harder case: a rule the model must obey while executing cannot depend on the model choosing to go read it, and an appendix nothing loads is a file that drifts with no reader to notice. It also splits the "this kernel wins all conflicts" claim across two files, which is worse than either file alone. Worth revisiting if the kernel grows back.

**Option C — Move the procedural detail into `hstack/templates/*.md` reference files.** Same structure as Option B with a home that already exists. Rejected for the same reason plus a specific one: the detail being moved is *orchestration*, and the templates directory is the schema surface. Putting `/hstack:tech-debt-wontfix`'s interview into a template file would put procedure in the one place the previous paragraph of this ADR just declared canonical for structure.

**Option D — Cut to ~4,500 words by also thinning § Test immutability and the reconciled session-start lists.** This is the arithmetic the brief's target implies, and it is reachable only this way. Rejected on both counts, and the shortfall against the target is the price: the load lists were arbitrated one commit ago and re-opening them makes ADR-0012's ledger a formality, and test immutability is the rule with no validator, no CI check, and a silent failure that ships. The PR lands above target and says so rather than hitting the number on the two sections least able to afford it.

**Option E — Reject the frontmatter-first read rule.** Considered seriously; it is the change in this PR with the weakest evidence, as the challenge prompt says. Kept because the kernel is already inconsistent — it mandates frontmatter-first for a peer's artifacts and is silent on the local tree, and there is no principled reason a peer's `spec.md` deserves a bounded read and the local one does not. The rule as written is the *smaller* of the two possible fixes; the alternative that removes the inconsistency in the other direction (delete the coord clause) loses a rule that ADR-0006 reasoned about explicitly.

**Option F — Correct `hstack-version: v0.6.0` to `v0.14.0` instead of deleting it.** One character-level edit, zero argument. Rejected because it re-arms a field that has been silently wrong for seven releases with nothing that would catch the eighth. A stale version string is worse than no version string: it answers the question "what version is this?" confidently and wrongly. If a per-file version marker is wanted later, it should be generated at pack time, not typed.

**Option G — Do the Notion retirement as its own PR.** It is a self-contained correctness fix with a different argument from the diet, and bundling it means one reviewer decision covers two things. Rejected on cohesion: two of the three Notion citations are inside sections this PR is already rewriting (§ Frontmatter contract, § Templates), so splitting them would mean touching the same paragraphs twice, and the second PR would conflict with the first. Kept together, with its own commit and its own ledger rows.

## Forecloses / Enables

**Enables.**

- A kernel size budget — the body-level analogue of ADR-0011's ≈ 40-word description budget and ADR-0012's per-file budget — becomes statable now that a criterion exists for what belongs. Roadmap item *hstack as a distributable framework* wants a kernel a consumer can read in one sitting.
- Extending the validator to behavioural rules gets a cleaner target: after this change the kernel is close to a pure list of rules, so the diff between "rules the machine checks" and "rules only the kernel carries" is nearly enumerable by section.
- A `doctor` check that the kernel's `§ X` pointers all resolve, and that every `KERNEL.md § Y` citation in the 52 bodies names a section that exists. Cheap, mechanical, and the natural guard for the vacuum the challenge prompt describes.
- Progressive disclosure for the kernel itself (Option B) becomes a smaller, better-scoped decision against a file that no longer contains procedure.

**Forecloses.**

- Using the kernel as the place to look up how a Skill works. That affordance is being spent deliberately; `/hstack:help --explain` and the Skill's own body are the replacements, and both are worse for a reader who does not know which Skill to look in.
- The Notion schema doc as a working reference. Once the kernel stops citing it, it has no inbound authority anywhere in the corpus and will finish diverging. Reviving it would mean re-deriving it from the templates and the registry — which is the correct direction, but it is no longer a small job.
- The "kernel contains everything, therefore kernel wins" intuition. Precedence now has to be argued from the `authority: kernel` marker and the first paragraph, not from the file's evident comprehensiveness.
