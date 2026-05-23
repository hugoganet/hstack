---
id: discovery-brainstorm
type: discovery-technique
technique: brainstorm
applies-to: product-brief
schema-version: 1
---

# Brainstorm — technique script

This is the prompt sequence `product-discovery` runs in Brainstorm mode. Use this when the engineer has a problem domain but no concrete concept. The mode is **facilitated ideation** — the agent acts as coach pulling ideas out via structured exercises, not generating ideas for the engineer.

## Pre-flight check

Before entering the script, the agent confirms:

- The engineer can name the problem domain in one sentence ("CS teams losing follow-up context") even if the solution is undefined.
- The engineer has 60+ minutes available. Brainstorm runs multi-round; cutting it short produces shallow output.

## Round 1 — SCAMPER pass on the problem statement

For each SCAMPER lens, ask the engineer one question and write their answer:

- **Substitute** — "What current workflow could be substituted away?"
- **Combine** — "What two things, combined, would create new value here?"
- **Adapt** — "What other industry has solved a similar pain — what did they do?"
- **Modify** — "What single behavior, if amplified, would solve most of the pain?"
- **Put to another use** — "What's a non-obvious user who has this same pain?"
- **Eliminate** — "What part of the current workflow could disappear entirely?"
- **Reverse** — "What if the user did the opposite of what they do today?"

Answers land as raw text in a scratch section. Do NOT synthesize yet.

## Round 2 — Reverse brainstorming

Ask: "How would you make this problem **worse** for the user? List five ways."

The engineer's answers reveal the load-bearing failure modes — the things the product must NOT do. These directly seed the **Explicitly NOT** section of the brief.

## Round 3 — Six Thinking Hats on the strongest thread

The agent picks the strongest 1–2 threads from Rounds 1 and 2 (the threads with the most concrete user actions named) and proposes them back. For each thread, walk the hats:

- **White hat (facts)** — "What do we observably know about this user's workflow today?"
- **Red hat (intuition)** — "What feels right or wrong about this thread, gut-check?"
- **Black hat (caution)** — "What's the strongest case against this thread?"
- **Yellow hat (optimism)** — "What's the strongest case for this thread?"
- **Green hat (creativity)** — "What's the wildest version of this thread?"
- **Blue hat (process)** — "Is this the right thread to deepen, or should we drop it?"

After the Six Hats run, the engineer either commits to a thread or returns to Round 1 with a sharper problem statement.

## Round 4 — Synthesis

The agent proposes a one-paragraph synthesis of the strongest thread, framed as: "Here is what I heard you converge on. Concept: X. Underlying pain: Y. Target user: Z." The engineer confirms or revises.

On confirmation, the agent transitions to the **product-brief.md** template and walks the sections, using the synthesis as the seed for Underlying Pain, Target User, and Value Proposition.

## Required reframes (mandatory before brief lands)

These run during the section walk of `product-brief.md`, regardless of which Brainstorm round produced the synthesis:

- "Who specifically pays for this?" — concrete persona required.
- "What's the smallest useful wedge?" — minimum shippable surface required.
- "What would you have to believe to be wrong about this?" — falsifiability required.

## Park-and-resume

The agent surfaces a parking offer after each Round commits. If the engineer parks, the round's output is persisted in `hstack/.session-state/<session-id>.yaml`. Resume picks up at the next round.
