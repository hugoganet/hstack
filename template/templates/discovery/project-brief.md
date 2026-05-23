---
id: discovery-project-brief
type: discovery-technique
technique: project-brief
applies-to: product-brief
schema-version: 1
---

# Project-brief — technique script

This is the prompt sequence `product-discovery` runs in Project-Brief mode. Use this when the engineer is already concrete about the product and just needs structure to land the brief artifact. This is the **lightest-touch** technique — collaborative, structured, no heavy reframes — but the three required forcing prompts still fire.

The agent's operating mode in this technique is **structured walk**: the engineer's existing thinking is the proposal layer; the agent prompts section by section, confirms or revises, lands the brief.

## Pre-flight check

Before entering the script, the agent confirms:

- The engineer can state the concept in two or three sentences without hedging.
- The engineer can name a specific real user (not a role abstraction).
- The engineer can name a concrete success metric.

If any of the three fails the concreteness floor, the agent halts and suggests switching to Forcing-Questions mode — the engineer's thinking is too vague for Project-Brief mode, which assumes concreteness.

## Section walk

The agent walks `product-brief.md` section by section. For each section, the agent asks one open question, accepts the engineer's answer, surfaces one clarifying re-ask if the answer is vague, then commits the section.

1. **Underlying Pain** — "Describe what the user struggles with today, in concrete terms. A Tuesday-morning workflow vignette is the unit of clarity."
2. **Target User** — "Name a specific real user. First name, role, company-size band, the tools they use, the workflow this product enters."
3. **Value Proposition** — "What outcome does this product deliver to the named user? Outcome, not features."
4. **Smallest Useful Wedge** — "What's the minimum shippable surface that delivers real value? Would the named user still pay for the wedge alone?"
5. **Success Criteria** — "What measurable, time-bound outcome tells you v1 worked? Concrete number, concrete window."
6. **Explicitly NOT** — "What is this product NOT? Two bullets minimum. What population it does NOT serve, what workflows it does NOT enter, what features it does NOT include."
7. **Open Risks** — "What could make this product fail? Name at least one belief that, if wrong, kills the product."

## Required forcing prompts

Even in this lightest-touch mode, the three required forcing prompts MUST run before the brief can land. They run after the section walk completes:

- "Who specifically pays for this?" — re-prompt the engineer to defend the Target User against the buyer question. The Target User and the buyer may be different (Maya the Director of CS uses it; her CFO pays for it). Both must be named.
- "What's the smallest useful wedge?" — re-prompt the engineer to defend the wedge against the "would the user pay for the wedge alone?" question. Yes required.
- "What would you have to believe to be wrong about this?" — re-prompt for a falsifiable belief + experiment to resolve it. Names the load-bearing risk.

These three answers are logged in the brief's **Forcing-Prompt Answers** section as evidence the probes ran. The engineer cannot skip them; the technique downgrades to Forcing-Questions mode mid-session if the engineer refuses any of the three.

## Synthesis

There is no explicit synthesis step in Project-Brief mode — the section walk IS the synthesis. The brief lands at `status: current` when the last section commits and the three forcing prompts are answered.

## Park-and-resume

The agent surfaces a parking offer after each section commits. If the engineer parks, the section's output is on disk and `hstack/.session-state/<session-id>.yaml` records the next-section pointer. Resume picks up at the next section.
