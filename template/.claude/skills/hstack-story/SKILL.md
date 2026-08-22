---
name: hstack-story
description: "Use to draft or refine the user story of a Notion feature — five sections, the user's point of view, written into the feature via the Notion MCP. A product tool, never a gate on a change."
---

## Purpose

`/hstack-story` writes one user story: who it is for, what shipping looks like to them, how we
know it worked. It exists so the people building the product stay on the user's side of the
screen — it is not part of any change's path to merge. **No rule requires a change to reference a
story.** The PR description names the Notion feature it serves, and that is the whole link.

Features live in Notion, in the Epics and Features databases. The story is written into its
feature page through the Notion MCP; the repo keeps nothing.

## When to invoke

When a feature needs its story written, or when the story it has no longer describes what is being
built. Nothing invokes this Skill and nothing waits on it.

## Inputs

`--feature <notion-id | url>` and `--persona <slug>`, both optional — the interview asks when they
are missing.

## Steps

Read `hstack/templates/story.md` first: the five sections are the shape, and filling them is the
job. Personas at `hstack/context/personas/` are frozen documents — read them for the user's voice,
and if none fits, say so and anchor the story on the user the interview describes. A missing
persona never blocks a story.

1. **Who and Why.** The persona and the job to be done, in one or two sentences.
2. **What Shipping Looks Like.** What the user sees, does and feels. A paragraph, not a spec.
3. **Success Metric.** One measurable thing. If the answer is not measurable, ask once more with a
   candidate; record what the engineer settles on rather than inventing a number.
4. **Edge Cases the User Cares About.** The challenge that earns this section: *what does the user
   notice if this ships but is slightly broken?* Two bullets minimum, from the user's side.
5. **Out of Scope for This Story.** The adjacent thing this story is not.

Then write the story into the Notion feature page via the MCP, with `id: NOTION:<id>` naming it.
Refining an existing story reads it first and proposes the current values as the starting point.

## Output

The story, in its Notion feature. No file in the repo, no status, no link written back onto
anything.

## Stop conditions

Beyond the kernel's:

- The Notion MCP is unreachable. Say so and stop — no local file stands in for it
  (kernel § Stop conditions).
- The named feature page does not exist. Ask which one, or whether to create it; never write the
  story onto a different page.
- The story is being asked for as a precondition to writing code. It is not one — say so, and
  offer to write it afterwards if it is still wanted.
