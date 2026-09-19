---
id: ADR-0017-disclosure-replaces-authorization-on-tests
type: adr
status: accepted
owner: hugoganet
decision-date: 2026-09-19
supersedes: null
superseded-by: null
related-change-specs: []
related-modules: []
promoted-from-kernel-fit: []
created: 2026-09-19
updated: 2026-09-19
schema-version: 2
---

## Title

Changing an existing test stops being an act that needs permission and becomes an act that needs a label. The per-test, per-conversation authorization phrase is abolished; in its place, any commit that touches a test that existed at the merge-base tags each file `behavior-change`, `refactor` or `obsolete`, and the PR description repeats the list in plain language. One prohibition survives — changing a test so a red suite goes green when the code under test is what is wrong.

## Status

Accepted on 2026-09-19, ships as v0.19.0. Supersedes ADR-0013 and ADR-0014 on the single arbitration where each declined to touch § Test immutability; the rest of both ADRs stands.

It is the last piece of ADR-0015. That ADR removed every part of hstack whose cost is paid on each change and kept what protects the work at no per-change cost. Test immutability is a per-change cost — it was left standing because it was the rule nobody wanted to be the one to weaken, which is a fact about the authors, not about the rule. This ADR also places the rule on the correct side of ADR-0016's line: a typed phrase is a mechanical gate standing in for a judgment, and ADR-0016 ruled that judgment belongs in prose the agent reads, mechanism belongs in the toolchain.

## Context

The rule froze the artifact. Once a test file existed, no agent could edit or delete it without the human typing `Ok to change test <name>`. Its stated motive was narrow and correct: the dominant failure mode of LLM implementation is the model editing an assertion to make the suite go green instead of fixing the code.

Three observations say the rule stopped matching that motive.

**It grew exceptions.** New files, then content-preserving moves, then — uncommitted in the working tree when this ADR was written — tests whose subject was deleted in the same commit. Three carve-outs in four months, each one added because reality produced a case the rule called a violation and every human involved called normal work. A rule that needs a new exception per quarter is describing the wrong thing.

**Its audit signal was never usable.** `REC-0003` measured 265 candidate violations over 90 days in moso-app, overwhelmingly commits that only *added* tests. The watch-list repeated verbatim for seven weeks and nobody reviewed it. ADR-0012 and ADR-0013 both justified keeping the rule verbatim on the grounds that prose is its only net; the honest reading is that there was no net at all, only a toll.

**The toll was paid in production code.** The triggering case: an agent declined to export a shared helper from a vendor client because doing so would have required adding one key to a mock in an existing test, and adding that key cost an authorization. It duplicated the helper instead and buried the reason in a commit message. The rule designed to stop tests being bent to fit code had started bending code to fit tests — and the agent's cheapest path was the silent one, because the rule priced asking and did not price duplicating.

The constraint that decides the shape of the replacement is MOSO's stage. Before product-market fit the intended behaviour moves several times a week, so most test edits are the spec moving and the test following. And the owner has said he rarely reads the code itself — he reads the PR description. Any net that only exists inside the diff is, for this team, not a net.

## Decision

Replace authorization with disclosure: an agent changes an existing test whenever the intended behaviour moved, without asking, and declares every such file with one of three tags in the commit body and again in plain language under a **Tests changed** heading in the PR description. The single forbidden move is changing a test to turn a red suite green when the code under test is what is wrong; when the agent genuinely cannot tell which one is wrong, it makes the most plausible change and names the doubt in the PR description as an open question rather than halting. Bulk snapshot updates and silent neutralization — `.skip`, `test.todo`, a deleted case, a loosened assertion — remain prohibited, because both hide from the diff and a hidden edit cannot be disclosed.

## Consequences

**Positive.** The per-change toll is gone, and with it the incentive that made duplication cheaper than a clean export. The rule shrinks from a top-level law with three carve-outs and five prohibitions to a paragraph inside § Tests with one prohibition, which is also what ADR-0012 asked for and never got here. The disclosure lands where the owner actually reads, which no version of the old rule did. And the vocabulary is closed: an agent choosing among three tags cannot launder *it was failing* into vague prose the way a free-text justification allowed.

**Negative, and named.**

*The net gets weaker in exactly the case it was built for.* The old phrase had one property nothing here reproduces: the model could not produce it. A tag, by contrast, is typed by the model, so a dishonest `behavior-change` on an edit that was really *it was failing* is indistinguishable from an honest one without opening the test file — and opening the test file is the thing this team does not do. The rule now depends on the agent's candour where it used to depend on the human's keystroke. That is a downgrade in kind, not merely in degree, and it is accepted because the keystroke was not actually being demanded in practice.

*The decision is made on the cost side with the benefit side still unmeasured.* Three ADRs have now arbitrated this rule. Two kept it arguing prose was the only net; this one removes it arguing the net was never used. Neither claim rests on a measurement, because hstack has never detected a single unauthorized test edit — which is equally consistent with "it never happened" and with "it happens and we cannot see it". ADR-0014's own challenge section warned about exactly this move: a distinguishing principle invented after the conclusion. The same warning applies here and is not dismissed, only outweighed by four months of observed cost against zero observed benefit.

**Neutral.** The telemetry field `qo_3_test_immutability_audit` keeps its name because the sidecar that produces it lives outside this repo; only its labels change here. Until that sidecar is updated it counts authorization phrases that no longer exist, so the metric reads empty rather than wrong — and there is no audit signal at all in the interval.

## Alternatives Considered

**Keep the gate and add a fourth carve-out** for additive edits to mocks and fixtures — zero deleted lines, outside any test body. It is the smallest possible change and it would have unblocked the triggering case. Rejected because it treats the symptom: the rule has produced a carve-out per quarter, a fourth predicts a fifth, and the accumulated exceptions are already longer than the rule they qualify.

**Freeze assertions rather than files.** Narrower and closer to the motive. Rejected because the boundary is judged by the model being constrained: *I am only adjusting a mock* is the precise sentence a model produces while neutralizing a case, and no reviewer can distinguish the honest instance from the dishonest one without the same reading the disclosure route already requires.

**Replace the prose with a mechanism now** — a CI check failing any PR whose diff touches a merge-base test file without a disclosure tag in the commit body. This is the right end state, it is what ADR-0012 said the retreat should be ("the fix is a mechanism, not restoring the copies"), and it is what ADR-0016 would prescribe. Deferred, not rejected: a gate shipped before the habit exists only relocates the halt from the conversation into CI, and the tag vocabulary should be exercised for a few weeks before a machine starts rejecting on it. Named under Enables.

## Forecloses / Enables

- Forecloses: nothing on the roadmap. It removes the last per-change confirmation gate that survived ADR-0015, so the "Now" column gets cheaper rather than more expensive.
- Enables: the CI check on disclosure tags, which becomes worth building once the vocabulary is in use — and, with it, a QO-3 that counts undisclosed edits instead of unphrased ones and is therefore reviewable for the first time.
