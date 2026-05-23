---
id: discovery-forcing-questions
type: discovery-technique
technique: forcing-questions
applies-to: product-brief
schema-version: 1
---

# Forcing-questions — technique script

This is the prompt sequence `product-discovery` runs in Forcing-Questions mode. Use this when the engineer has a concept but it's vague or oversold — the technique probes claims and reframes the underlying pain. Pattern derived from YC-partner forcing questions and the Gstack approach.

The agent's operating mode in this technique is **reframe-driven probing**: every claim the engineer makes triggers a reframe. The engineer's job is to defend the claim or accept the reframe. The brief converges only when the claims survive the probes.

## Pre-flight check

Before entering the script, the agent confirms:

- The engineer has a concept they can state in one or two sentences.
- The engineer is open to being wrong about their concept. The technique surfaces reframes that may invalidate the founder's first articulation; founders who can't tolerate that should pick Project-Brief mode instead.

## Probe 1 — The 10-star reframe

Ask: "What's the 10-star product hiding inside this request? What you described is 5-star; what's the 10-star version that solves the actual underlying pain?"

The engineer's first answer is often a feature embellishment ("...with AI"). Re-ask: "That's a feature. What's the **underlying** pain — what does the user fail to do today that the 10-star product would make trivial?"

The reframe sticks when the engineer names a pain that is one level deeper than the original concept. The brief's **Underlying Pain** section seeds from this answer.

## Probe 2 — The smallest useful wedge

Ask: "What's the smallest useful wedge? If you shipped one slice of the 10-star product and nothing else, what's the one slice that would still get a real user to pay?"

The engineer's first answer is usually too large. Re-ask: "Cut it in half. What's left when you remove every feature that isn't load-bearing for the slice you just described?"

The reframe sticks when the engineer names a wedge that can be built by one engineer in a quarter and that, alone, would justify a real user's payment. The brief's **Smallest Useful Wedge** section seeds from this answer.

## Probe 3 — The named user

Ask: "Who specifically pays for this? Name a real person — first name, role, company-size band, and the workflow this product enters on a Tuesday morning."

The engineer's first answer is often a role abstraction ("Directors of CS"). Re-ask: "Pick one specific Director of CS you've talked to. What's her name, what's her company's name, and what does she do on a Tuesday morning that this product changes?"

If the engineer cannot name a specific person, halt and surface: "The named-user constraint isn't met. We can either (a) park here and you go talk to three real users this week, or (b) acknowledge in the brief that this is anchored on a hypothetical user, which makes everything downstream a gamble." Founders sometimes choose (b); the brief records the choice in **Open Risks**.

The brief's **Target User** section seeds from this answer.

## Probe 4 — The falsification probe

Ask: "What would you have to believe to be wrong about this concept? Name the belief and the evidence that would falsify it."

The engineer's first answer is often "users won't like it" — too vague. Re-ask: "Be specific. What's a load-bearing assumption about the user, the market, or the technology that, if wrong, kills the product? And what experiment would tell you if it's wrong?"

The reframe sticks when the engineer names a falsifiable belief plus an experiment that would resolve it within weeks. The brief's **Open Risks** section seeds from this answer.

## Probe 5 — The scope-reduction question

Ask: "If you had to ship in 8 weeks with one engineer, what would you cut? Walk me through the cut list."

The engineer's cuts reveal what they think is load-bearing vs. embellishment. The brief's **Explicitly NOT** section seeds from the cut list — the things the engineer would cut are exactly the things v1 explicitly does NOT do.

## Probe 6 — The reframe-staleness check

After Probes 1–5, the agent surfaces: "The brief is converging on [X]. Your starting concept was [Y]. Any external documents (Notion pages, pitch deck, README) still naming [Y]? Those are now stale. Cleanup checklist:"

The engineer either confirms the docs are stale and lists them for cleanup, or pushes back ("no, Y is still the framing") — in which case the agent re-runs Probe 1 to reconcile.

## Synthesis

After all six probes, the agent proposes a one-paragraph synthesis: "Here is what survived the probes. Concept: [refined X]. Underlying pain: [Probe 1 answer]. Smallest wedge: [Probe 2 answer]. Named user: [Probe 3 answer]. Falsification: [Probe 4 answer]." The engineer confirms or revises.

On confirmation, the agent transitions to the **product-brief.md** template and walks the sections. The probe answers seed the corresponding brief sections; the Forcing-Prompt Answers section records the probes verbatim as evidence the technique ran.

## Park-and-resume

The agent surfaces a parking offer after each probe commits. If the engineer parks, the probe's output is persisted in `hstack/.session-state/<session-id>.yaml`. Resume picks up at the next probe.
