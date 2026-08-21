---
id: ADR-0014-judgment-based-rewrite
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

The micro-prescriptions come out. hstack's prose contains a layer of instruction written for a model that needed to be told how to think: finding quotas, character thresholds standing in for substance, keyword blocklists standing in for intent, and interview scripts that must be read out even when they do not fit the product. Each is replaced by one of three things — a stated goal, a rubric loaded on demand, or an executable rule in the validator. What stays is named explicitly: the areas where the exact wording *is* the mechanism.

## Status

Accepted on 2026-08-21. Ships as one PR against `main` at v0.16.0. Sixth in the context-engineering sequence — ADR-0010 (kernel rename), ADR-0011 (descriptions are routing triggers), ADR-0012 (one rule, one place), ADR-0013 (the kernel's diet), and the v0.15.0 enforcement pass that mechanized the twelve merge gates and the observed-test-count check.

It is also the first of the sequence that changes what the models **produce**, not only what they read. ADR-0010 through ADR-0013 moved bytes between files; the artifacts they described came out the same shape. This one changes the contract on three artifact types (`adversarial-review`, `kernel-fit-finding`, `kernel-fit-flag`), the closure interviews on two more, and the interview shape of two discovery atoms. That is why it is sequenced one family per commit: ADR-0009's per-phase instrumentation can attribute a regression to a family, which it could not do if all five landed together.

## Context

The Anthropic post *New rules of context engineering* draws a line through the middle of hstack's prose. Its § "Give Claude rules" → "Let Claude use judgement" argues that rules written to compensate for a weaker model's failure modes become, on a stronger model, a description of a worse policy than the one the model would have followed unprompted — and that the fix is to state the goal and let the model reach it. Its carve-out is equally explicit: *except in highly important areas*, where the exact behaviour matters more than the model's judgment about it.

hstack was written to the first half of that advice and never audited against it. Four families of prescription are the residue.

### The quota that admits it is a quota

`adversarial-reviewer.md` carries a findings floor — three findings, five when `change-spec.area` is in `{agent, auth, billing}` (AR-06), enforced as a hard validator error by AR-01. The file states its own motive in the Role section: the reviewer's terminal output is *"structurally biased against 'looks good'"*. The reasoning is sound and the mechanism is not: a number the reviewer must reach is a number the reviewer will reach, and the artifact is scored on the count rather than on whether the count was honest.

The clearest evidence that the framework already knows this is the counter-mechanisms it grew. Three of them, all in the same file, all existing only because of the quota:

1. **The sub-floor escape hatch.** `findings-fewer-than-floor: true` plus a non-null `justification-when-fewer` plus a filled `## Findings Floor Justification` section — a ritual that costs more prose than the finding it replaces.
2. **The category-spread rule.** *"Spread findings across the six categories… Clustering all findings in one category is a smell"* — a distribution constraint layered on a count constraint, which is what you write when you have noticed that a count can be met by filling one bucket.
3. **`Halt rather than padding findings`**, in Stop conditions — an instruction not to do the thing the rule immediately above it incentivises.

The telemetry sidecar names the failure mode outright: *"`category_counts` + `severity_counts` + `resolution_mix` jointly surface findings-quota-gaming patterns no single field could detect."* The framework built an instrument to detect gaming of a rule it wrote, rather than removing the incentive.

### Thresholds that measure length where they mean substance

Five character bounds live in the corpus. They are not the same kind of object.

| Bound | Where | What it actually constrains |
|---|---|---|
| commit subject ≤ 72 | `hstack-commit` step 4 | git convention — a format |
| coord `subject` ≤ 80 | `templates/coord-message.md`, CM-01 | a one-line index entry — a format |
| flag `hint` ≤ 32, one token | `hstack-flag` steps § Inputs, 4 | a filename-shaped pointer token — a format |
| `dismissed-reason` ≥ 50 | KF-05, `hstack-kernel-fit-triage` | *that the dismissal was thought about* |
| `wontfix-reason` ≤ 200 | `hstack-tech-debt-wontfix` steps 2, 72 | *that the rationale is tight and load-bearing* |
| `stale-verification-method` ≤ 300 | `hstack-tech-debt-stale` steps 2, 5, 80 | *that the evidence is structural* |

The first three are real: something downstream breaks or looks wrong if they are violated. The last three are proxies for a property the count cannot see. `dismissed-reason ≥ 50` is demonstrably weak in both directions — `"not relevant not relevant not relevant not relevant"` is 51 characters and passes, while `"the kernel gives a norm here, not a bound"` is 41 characters, is the whole answer, and fails. The rule accepts the padding and rejects the better sentence, and the only way to make the better sentence pass is to add words to it.

### Blocklists that fire on the wrong sentences

`hstack-tech-debt-wontfix` step 3 halts when the rationale contains any of `"later"`, `"not a priority"`, `"no time"`, `"we'll come back"`, `"next quarter"`, `"after X ships"`. `hstack-tech-debt-stale` step 3 halts on `"we don't care anymore"`, `"not worth it"`, `"moved on"`, `"low priority"`, `"not blocking us"`.

Both over-fire and under-fire. *"We accept the 50ms overhead permanently; the v2 substrate lands next quarter and will remove it as a side effect"* is a correct wontfix and contains `next quarter`. *"The cost-benefit does not favour action"* is a deferral wearing a suit and contains none of the eleven strings. The list is also stated inside the very Skill whose step 4 offers, as a model answer, *"We accept the 50ms latency overhead until v2 substrate lands"* — a sentence whose sibling would trip its own step 3.

### Interviews that must be read out

`stack-architect` is already the right pattern and has been since it was written. Its constraint-elicitation rule reads:

> **Constraint-elicitation interview.** For deep-dive layers, the agent runs a constraint interview before surfacing options. Example prompts: "How many users at the v1 launch?" … The agent surfaces options only after constraints are concrete.

The rule is a goal (*options only after constraints are concrete*), the questions are labelled **Example prompts**, and the one place the agent is allowed to break its own no-opinion posture is a named, reasoned exception (*"essentially load-bearing"*).

`data-architect` and `app-architect` are the same kind of agent and were not written that way. The sharpest case is `data-architect`'s tenancy rule:

> The agent walks Patterns A/B/C explicitly **even if the engineer claims to know** — the explicit walk surfaces edge cases the engineer may not have considered.

A/B/C are: tenant = customer organization, tenant = sub-team, tenant = individual user. That taxonomy covers most B2B SaaS and misses whole categories of product. A construction-management tool whose tenant is a **project**; a fleet product whose tenant is a **device**; an insurance tool whose tenant is a **contract**; a multi-site retail product whose tenant is a **store**. In each, the mandated walk spends the engineer's attention on three shapes that do not apply, and the answer it is fishing for is not on the list. The goal underneath — *the tenant is one concrete noun in this product's own vocabulary, traceable to a persona* — is right, load-bearing, and does not need the taxonomy to be enforced.

### Probes that may not be rephrased

Three artifacts carry mandatory challenge prompts: `security-review` (SR-02), `test-plan` (TS-02), and the `product-brief`'s three forcing reframes. They exist as the v1 mitigation for the asymmetry the kernel names — humans miss what is missing — and they work. The problem is one word. `hstack-security-review` step 3 and `hstack-test-plan` step 7 both say the subagent *"answers all three challenge prompts **verbatim**"*, and `test-strategist.md` says *"mandatory and verbatim"*.

A probe that cannot adapt probes worse. `"Which tenant_isolation guarantee does this change depend on? Cite the line of code that enforces it."` is exactly right for a change that touches an RLS policy and close to meaningless for a change to a pure formatting helper, where the honest sharper form is *"this change touches no tenant-scoped path — which call site would have to move for that to stop being true?"*. And the requirement is not what the rules measure: both SR-02 and TS-02 count **answers**, locating them by the `(a)` / `(b)` / `(c)` heading prefix and asserting `challenge-prompts-answered: 3`. Neither matches prompt text. The verbatim requirement is enforced nowhere and constrains the one thing that made the probe useful.

## Decision

**Every prescription in the four families is replaced by exactly one of three forms, and the choice is recorded per prescription in the ledger below.**

- **A stated goal** — the outcome the prescription was reaching for, written so the agent can reach it its own way. Used where the failure mode is broad and judgment beats enumeration.
- **A rubric loaded on demand** — the enumeration survives, as reference material the agent reads when it wants calibration, not as a rule it must satisfy. Rubrics go in `references/` alongside the Skill that loads them, per the `hstack-kernel-fit-scan/references/slack-setup.md` precedent, never inline in an always-loaded or agent-loaded body.
- **An executable rule** — a check in `validate-spec.mjs` where the property is genuinely mechanizable. This is the *upgrade* direction: a real constraint stated once in code beats the same constraint stated three times in prose.

**Prescriptions that are load-bearing as written are kept and named.** The article's carve-out — *except in highly important areas* — is applied by an operational test rather than a feeling: **a prescription is kept verbatim when the exact wording is itself the mechanism, not a description of one.** The list is closed, stated here, and is not touched by this PR:

- **Test immutability and its four canonical authorization phrases** (`Ok to change test <name>`, `Ok to delete test <name>`, `Ok to update snapshot <name>`, `Ok to refresh fixture <name>`). The phrase is not a way of asking for permission; it *is* the permission. A paraphrase-tolerant authorization protocol is not an authorization protocol, because the whole point is that the human typed something they could not have typed by accident. This rule also has no validator id — not even a deferred one — so prose is the entire net. ADR-0013 already declined to thin it; this ADR declines again, for a different reason.
- **The implementer's scope-lock.** `in-scope` is a boundary, not a suggestion, and "use judgment about what is in scope" is the failure it exists to prevent.
- **Tenant isolation** — DR-03 and TS-03. Non-empty tenant-isolation tests for `db` / `api` / `agent` surfaces stay a hard requirement. A missed cross-tenant test is silent, ships, and is a data breach.
- **Session isolation between implementer and reviewer.** The whole value of the adversarial review is that the reviewer did not write the code. This is the one thing about the adversarial-reviewer that this ADR strengthens rather than relaxes.
- **Forbidden tools.** `service_role` keys in agent code, raw shell against production, Connect against live customer accounts. An enumerated blocklist is the correct instrument when the enumerated items are individually catastrophic and the list is short — which is exactly why the tech-debt keyword blocklists are *not* comparable: those items are individually harmless.
- **The human gate on kernel changes.** Auto-creation of ADRs stays forbidden.

Note what the last two entries mean together: this ADR removes two keyword blocklists and keeps a third. The distinguishing test is not "blocklists are bad" but **whether the listed strings are the hazard or a correlate of it.** `service_role` in agent code *is* the hazard. `next quarter` in a wontfix rationale is a correlate, and a poor one.

### The ledger

Fifteen prescriptions. Column three is why that form and not another.

#### Family 1 — the findings quota (`adversarial-reviewer`, `hstack-adversarial-review`, AR-01)

| Prescription | Retained form | Motive |
|---|---|---|
| AR-01 as a hard floor: `len(findings) ≥ findings-floor` or the escape hatch | **Executable rule, restated.** AR-01 now fires only on the null result: an adversarial-review at `findings-open` / `findings-resolved` with an **empty** `findings` array must carry `findings-fewer-than-floor: true`, a non-null `justification-when-fewer`, and a filled `## Findings Floor Justification` section. Count above zero is not gated. | The defensible half of the quota is not "three" — it is that a cold reader reporting nothing has made a claim. That half is mechanizable exactly and has no padding gradient: there is no such thing as one filler finding that gets you from zero to "defended", because the defence is what the rule asks for either way. The id survives, so the registry, the merge-gate registry and the telemetry keys are undisturbed. |
| The floor value itself (3 / 5 by area, AR-06) | **Kept, demoted to a measured signal.** AR-06 is unchanged: `findings-floor` still has to equal 3, or 5 for `{agent, auth, billing}`. It is now the area's *expectation*, reported by the sidecar (`findings_floor`, `findings_count`, `findings_fewer_than_floor`) and gated by nothing. | The brief allowed removal-with-registry-update or retention-as-signal. Retention wins on one argument: the sidecar's whole value in ADR-0009 is a time series, and renaming or dropping `findings_floor` would break attribution across the v0.15/v0.16 boundary — the exact window this PR most needs to be able to read. AR-06 keeps the declared value honest so the aggregate means something. |
| *"Spread findings across the six categories… clustering is a smell"* | **Rubric, loaded on demand** — `hstack-adversarial-review/references/finding-categories.md`. | The six categories are worth having; they are a good sweep. They are not worth having as a distribution constraint, which is what turns them into buckets to fill. As reference material the reviewer opens when it wants calibration, they do the work they were written for. |
| *"Halt rather than padding findings"* (stop condition) | **Deleted.** | It is an instruction not to obey the incentive created two rules above it. With the quota gone the incentive is gone and the sentence has nothing to warn against. |
| The sub-floor ritual as a routine path (*"explicit and rare"*, enumerate every category, "the change is small is insufficient") | **Goal, stated once.** The reviewer's Role section now says it plainly: *you are reading cold; "no problems" is a claim you have to defend, not a default you may fall into.* | The three sentences of ritual were describing how to fill in a form. The one sentence describes the job. |

#### Family 2 — character thresholds

| Prescription | Retained form | Motive |
|---|---|---|
| commit subject ≤ 72 (`hstack-commit`) | **Kept.** | Real format constraint, git convention, verifiable by the human reading the message. Not an artifact field, so not a validator rule. |
| coord `subject` ≤ 80 (CM-01) | **Kept, already executable.** | Already a validator warning against a real one-line-index constraint. Nothing to do. |
| flag `hint` ≤ 32, single token (`hstack-flag`) | **Executable rule, newly mechanized** — folded into FL-01, which becomes "every pin-time field is non-null; `hint`, when set, is one whitespace-free token of at most 32 characters." | Named as a format constraint by the brief and enforced nowhere. Given the direction of this ADR — prose bounds that are real become code — leaving it as prose only would be inconsistent. It costs one clause on an existing rule and one fixture; no new id. |
| `dismissed-reason ≥ 50` (KF-05) | **Judgment sentence** in `hstack-kernel-fit-triage`; KF-05 keeps the non-null and wrong-status checks and drops the length check. | The demonstration above: it passes padded nonsense and rejects a tight correct sentence. What the rule wanted is that a reader in six months can tell whether the dismissal still holds — which is a property of the content and belongs with the agent. |
| `wontfix-reason ≤ 200` (`hstack-tech-debt-wontfix`) | **Judgment sentence.** | Same argument. The Skill already prints the tech-debt in full immediately before asking, so the engineer is answering with the artifact on screen; the cap was adding friction at the one moment the interview was already well-designed. |
| `stale-verification-method ≤ 300` (`hstack-tech-debt-stale`) | **Judgment sentence** — and the step-5 heuristic ("if you can't tighten it below 300, it is probably a wontfix") is replaced by the test it was proxying: *if the answer is a story about intent rather than a fact about the code, it is a wontfix.* | The length heuristic was a genuinely clever proxy and it is still a proxy. Stating the thing it approximates costs the same number of words and does not misfire on a verification that happens to need two clauses. |

#### Family 3 — keyword blocklists

| Prescription | Retained form | Motive |
|---|---|---|
| wontfix deferral blocklist (`later`, `next quarter`, `no time`, …) | **Goal, one sentence:** wontfix means the problem is real and we are choosing to live with it. If the sentence describes a future in which we fix it, it is a deferral and the item stays `open`. | Names the distinction the list was gesturing at. Catches the paraphrase the list misses and clears the legitimate rationale the list trips. |
| stale preference blocklist (`moved on`, `low priority`, `not worth it`, …) | **Goal, one sentence:** stale means the problem no longer exists and someone else could verify that — a command that returns nothing, a commit that removed the code, a system that is gone. Anything that is a preference about the problem rather than a fact about its absence is a wontfix. | Same. It also states the *verifiable-by-a-third-party* property, which is the actual semantic load `stale` carries against `wontfix` in the audit signal, and which no word list can approximate. |

#### Family 4 — rigid interview scripts

| Prescription | Retained form | Motive |
|---|---|---|
| `data-architect`: walk tenancy Patterns A/B/C *"even if the engineer claims to know"* | **Goal + labelled examples**, on the `stack-architect` pattern. The goal — the atom does not advance past Section 1 until the tenant is one concrete noun in this product's own vocabulary, traceable to a named persona — is unchanged and still hard. A/B/C become *common shapes*, offered when the engineer is unsure or when the answer smells like a default, with the reasoned exception stated: a tenant that is a project, a device, a contract or a site is normal and is none of the three. | The rule was enforcing the taxonomy where it meant to enforce concreteness. Products outside B2B-SaaS shapes were being walked through three wrong answers. |
| `data-architect` / `app-architect`: per-section drift challenges as fixed sentences | **Goal + labelled examples.** The challenges stay **mandatory per section** and their answers stay in the artifact as evidence the probe ran. The written sentences are the canonical form; adapting them to the section's actual content is expected. | Identical to family 5's argument, applied to the same object under a different name. What is load-bearing is that the section was probed and the answer is on the record, not the phrasing of the probe. |
| `app-architect`: *"flows that say 'the AI handles it end-to-end' are rejected"* | **Goal.** Every step's mechanism is a decision someone is making; the table exists so that it is made on purpose rather than by default. Reasoned exception added: a step that genuinely is one model call, declared as one row with its schema and its rationale, is a complete answer — the rule is against the undeclared boundary, not against short tables. | As written the rule rejected a shape rather than a defect, and an honest single-row flow was indistinguishable from the evasion it was aimed at. |
| `data-architect` RLS two-category rule (tenant-scoped or intentionally-global, no third category) | **Kept verbatim.** | Not a micro-prescription. A table with no declared RLS posture is the tenant-isolation hazard the carve-out list protects; it belongs with DR-03 and TS-03. Named here so the ledger shows it was considered and kept, not overlooked. |

#### Family 5 — "verbatim and mandatory" challenge prompts

| Prescription | Retained form | Motive |
|---|---|---|
| SR-02 / TS-02 three prompts: **mandatory** | **Kept, unchanged, still executable.** Both rules keep asserting `challenge-prompts-answered: 3` and three filled `(a)` / `(b)` / `(c)` subsections. | These are the v1 mitigation for humans-miss-what-is-missing. Nothing in the article's argument touches "must happen"; it touches "must be worded this way". |
| SR-02 / TS-02 three prompts: **verbatim** | **Deleted.** The written prompts become the canonical form, adaptable when the adaptation probes harder; the `(a)` / `(b)` / `(c)` labels stay on the headings because that is what the validator locates. | Verified in code before removing: `SR-02` and `TS-02` both match `/^\((a|b|c)\)/` on the heading and never touch the prompt text. The verbatim clause was enforced by nothing and cost the probe its ability to fit the change. |
| `product-discovery`'s three required reframes | **Kept mandatory, phrasing freed**, same treatment. The Forcing-Prompt Answers section still has to carry all three. | Same object, same argument. The three questions are the requirement; the words are a starting point. |

## Consequences

### Positive

- **The framework stops instrumenting a problem it created.** The adversarial-review sidecar's three joint fields exist to detect gaming of the quota; removing the quota removes the thing being gamed. The fields stay and become what they should have been — a description of what a review found, not a fraud detector.
- **`KERNEL.md` does not move.** The always-loaded surface — paid once per session and again inside every one of the sixteen subagents — changes by one word, `quota` → `cold read`, and by zero on the word count. Everything this ADR adds lands on bodies that are paid on invocation or on demand, which is the budget ADR-0013 spent a whole PR protecting.
- **Two proxies become the thing they were approximating.** "≤ 300 characters or it is probably a wontfix" and "could a third party run, read or look up what it names?" are about the same length. Only one of them is checkable by the person answering, and only one of them stops being right when the evidence needs two clauses.
- **One real constraint gets mechanized.** `hint ≤ 32, one token` moves from a sentence in `hstack-flag` that nothing verified into FL-01, where it is checked on every validator run. This is the direction ADR-0012 and the v0.15.0 enforcement pass both established.
- **The carve-out list is now written down.** Before this ADR, the question "which of hstack's rules are exact-wording rules?" had no answer anywhere. It has one now, with an operational test attached, which is what makes the next audit of this kind cheap.
- **Zero migration surface**, as with ADR-0010 through ADR-0013. Everything changed is framework-owned under `template/`, overwritten by `hstack update`. No installer, manifest, symlink or `doctor` change, and no schema-version bump on any artifact type.

### Negative

- **This is the first PR in the sequence whose failure mode is invisible in the diff.** ADR-0010 through ADR-0013 could be checked by reading: the bytes either moved correctly or they did not. Whether a reviewer told "no problems is a claim you have to defend" finds fewer real problems than one told "produce three" cannot be read off the diff, and cannot be measured until enough reviews have run in moso-app for `findings_count` to have a distribution. The sidecar will answer it eventually; the PR ships on judgment.
- **The floor was doing something, and "it induced filler" is an argument, not a measurement.** hstack has never had a review land under floor with a defended justification, which means the escape hatch has never been exercised and the padding it was written against has never been observed either. Both the rule and its removal rest on the same absence of evidence. A reviewer that now returns two low-severity findings on an `auth` change passes AR-01 where it previously would have had to either find three or write a defence — and the honest reading of that is that this PR made one specific check weaker on the highest-stakes area in the enum.
- **Freeing the challenge-prompt wording removes the only thing that made a weak answer visible.** With the canonical prompt in the heading, a reader comparing two security-reviews could see that one of them answered a different, easier question. Once headings are adaptable, "adapted to probe harder" and "adapted to probe softer" produce the same artifact shape, and the only detector is a human reading both. SR-02 counts three answers either way — which was already true, but the verbatim clause was at least a norm a reviewer could cite.
- **Three of the five families are being changed on a single reading of a single source.** The Anthropic post is a strong argument, not a measurement of this corpus, and hstack has run zero A/B of prescriptive-vs-goal prose on its own artifacts. ADR-0013 named the same weakness about itself and this ADR inherits it, one layer deeper: it is now the fourth consecutive bet with no measurement between any two of them.
- **`hstack-adversarial-review`'s description still says "quota-driven" and this PR does not fix it.** The always-loaded description surface is frozen by constraint here — zero bytes of `description:` change — so the routing trigger for the adversarial-review Skill now describes a mechanism the Skill no longer has. It is one word, it is wrong the moment this merges, and it stays wrong until a description pass picks it up. The alternative was to touch the ADR-0011 surface in a PR that has no business touching it, and holding the line is worth one stale adjective — but it is a real defect shipped knowingly.
- **The rubric will be read less than the rule was.** ADR-0012's Option E and ADR-0013's Option B both rejected progressive disclosure for rules the model must obey *while executing*, on the grounds that a file nothing loads is a file that drifts. `finding-categories.md` is exactly that shape. It is defensible here because it is calibration rather than obligation — but the same sentence would have defended the rejected options, and the difference is a judgment call.
- **This PR makes the corpus bigger, and every previous one in the sequence made it smaller.** Measured against `origin/main`: the sixteen agent and Skill bodies gain **+1,340 words**, the seven templates **+297**, and `validate-spec.mjs`'s rule descriptions **+209** — plus **1,104 words** of new on-demand rubric. `KERNEL.md` is flat. Goal-framing is simply more verbose than a number: "produce at least three findings across six categories" is eleven words and "you are reading cold, and 'no problems' is a claim you have to defend" plus a sweep instruction is fifty. Four consecutive ADRs argued that hstack's bodies were too big; this one accepts about 2.1k tokens back on the invocation path on the argument that the words now say something the reader has to think about. That is the opposite of the trade ADR-0011 through ADR-0013 made, made for a different reason, and it is fair to hold it to a higher bar than a diet PR.

### Neutral

- The three artifact-shape changes are additive-compatible: no frontmatter key is added, removed or renamed on any artifact type, so existing consumer artifacts validate unchanged against the new registry. The only artifacts whose validation *result* can change are ones that were previously failing.
- `compute-merge-readiness.mjs` and its twelve gates are untouched. GT-04 reads `adversarial-review.status`, not its finding count, and GT-11 reads the AR-07 Acceptance-satisfied subsection — neither is in any family's blast radius. Verified by grep and by the merge-readiness suite.
- The dev repo is not a consumer; this ships blind here and is exercised in moso-app, as with ADR-0011 through ADR-0013.

### Challenge prompt — name two consequences that look bad

1. **The strongest form of the quota argument also argues against the replacement, and the ADR does not answer it.** The claim is that a floor of three makes a reviewer produce three items whether or not three exist. Grant it. The replacement — "no problems is a claim you have to defend" — is a floor of one wearing different clothes, because the cheapest way to avoid writing a defended justification is to file one finding. Every argument in Family 1 about padding pressure applies to it at n=1, and the ADR's answer ("there is no such thing as one filler finding that gets you to defended") is true only if the defence is genuinely more expensive than a finding, which is an assumption about the reviewer's cost model, not a property of the rule. If it is wrong, this PR did not remove the quota; it lowered it to one and deleted the three mechanisms that were catching the resulting behaviour.

2. **"The wording is the mechanism" is a test the author applies to their own rules, and it will pass whichever ones they are attached to.** Six carve-outs are named and each has a defence, but none of them was reached by a procedure that could have returned a different answer. Test immutability is kept partly because ADR-0013 kept it — which is precedent, not evidence — and the two tech-debt blocklists are removed while the forbidden-tools blocklist is kept, on a distinction ("the strings are the hazard, not a correlate") that was invented in this document to separate them. It is a good distinction. It was also chosen after the conclusion. The honest description is that the carve-out list is a set of decisions this ADR is comfortable with, and the operational test is a rationalization that will hold until the first case where it is inconvenient.

## Alternatives Considered

**Option A — Status quo.** Do nothing; the article is advice about greenfield prompting and hstack is a shipped corpus with four ADRs of momentum behind its current shape. Rejected on the quota alone: a rule that needed three counter-mechanisms and a telemetry instrument to survive contact with the model it governs is not a rule that is working, and the framework's own files say so in three places. The rest of the families follow the same audit and would have been strange to leave once the quota was opened.

**Option B — Remove the findings floor entirely: drop `findings-floor`, `findings-fewer-than-floor`, `justification-when-fewer`, retire AR-01 and AR-06 into the deferred registry, and delete `findings_floor` from the sidecar.** The cleanest version of the change and genuinely tempting — a field maintained by intention with no gate reading it is exactly the drift surface ADR-0013 spent a section on. Rejected on the telemetry boundary: ADR-0009's sidecar earns its keep as a time series, and v0.16.0 is the release whose effects most need to be readable against v0.15.0. Dropping the key makes the two sides of that boundary incomparable in the one dimension this PR is most likely to have moved. Worth revisiting once the series is long enough to have said something.

**Option C — Keep AR-01 as written and demote it to `severity: "warn"`.** One-line diff, no fixture churn, no semantic change to any field: the floor becomes advisory and the escape hatch stays available for a reviewer who wants to be explicit. Rejected because it keeps all three counter-mechanisms alive for a rule that no longer bites — the category-spread constraint, the sub-floor ritual and the anti-padding stop condition would all still be in an agent-loaded body, describing the shape of a warning. It is the option that costs least and changes least, which here is the same criticism twice.

**Option D — Replace the quota with an LLM-graded quality bar ("each finding must survive a materiality check").** Rejected on the validator's own deferred-rules entry, which already ruled on this class: *"A validator that scored these would be an LLM, and the kernel already has one in the loop."* Adding a second grader inside the review is v2-substrate work and would be the fifth mechanism stacked on a rule this ADR is removing.

**Option E — Keep the character thresholds and add the judgment sentence alongside them.** The belt-and-braces option, and the one a reviewer worried about the negatives above would reach for. Rejected because the threshold is the one of the two that fires, and a rule that fires beats a sentence that advises every time they disagree — which is precisely the 47-character case. Two rules where one is strictly worse and mechanically dominant is not defence in depth; it is the weaker rule in charge.

**Option F — Convert the tech-debt blocklists into a rubric file rather than deleting them.** Symmetrical with Family 1's treatment of the six categories, and it was the default until the two cases were compared. Rejected because the category list is a *sweep* — genuinely useful calibration for someone deciding where to look — while the keyword list is a *classifier*, and a bad classifier is not improved by being optional. Eleven strings that fail in both directions have no calibration value; the one sentence that replaces them does.

**Option G — Split the PR: quota in one, thresholds and blocklists in a second, interviews and prompts in a third.** Attractive for exactly the reason the first Negative gives — the effects are invisible in the diff and three releases would give ADR-0009 three attribution windows instead of one. Rejected because the audit is the deliverable: the carve-out list, the operational test and the fifteen-row ledger only mean something applied to the whole corpus at once, and split across three releases the second and third PRs would each re-litigate the test. The per-family commit sequencing is the compromise — same attribution granularity for a bisect, one decision for a reviewer.

## Forecloses / Enables

**Enables.**

- A description pass over the ADR-0011 surface now has a concrete first entry (`hstack-adversarial-review`'s "quota-driven") and a reason to run: this PR is the first that made a description factually wrong rather than merely long.
- The `references/` pattern gets its second instance, which is what turns it from a one-off into a convention — and with it, a plausible home for the calibration material that other high-stakes agents currently carry inline.
- A prescription audit becomes repeatable. The operational test ("is the wording the mechanism?") plus the carve-out list is a checklist the kernel-fit loop can run against new prose, and `doctor` could plausibly grep for the shapes this ADR removed (bare character bounds on prose fields, quoted-string blocklists).
- Measuring whether goal-framing beats rule-framing becomes possible for the first time, because the sidecar now spans a boundary where exactly one of the two was in force on each side.

**Forecloses.**

- Scoring an adversarial-review on its finding count. The number is still recorded and still aggregatable, but it can no longer be the thing a gate reads without re-opening this decision — including in CI, where a `findings_count` threshold would be the same rule at a different layer.
- Using prompt text as a version marker. Once challenge prompts are adaptable, "which version of the security-review prompt did this artifact answer?" is no longer answerable from the artifact, which closes off a cheap way to date a review against a kernel revision.
- Reading `hstack-tech-debt-wontfix` as a mechanical filter. Its refusal is now a judgment the running model makes, so a consumer who wants a deterministic deferral check has to build it themselves rather than inherit it.
