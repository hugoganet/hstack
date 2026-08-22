---
name: hstack-app-architecture
description: "Use when the application architecture really moves — modules, LLM call sites, state ownership, surfaces, or what a user can reach — to write or refresh `hstack/context/app-architecture.md`, exposure map included."
---

## Purpose

`/hstack-app-architecture` writes or refreshes `hstack/context/app-architecture.md`: the module map
with its exposure column, the agent orchestration model, the deterministic-vs-LLM split, the
state-ownership map, the surface boundaries. It is what the next session reads to know what exists
and what a user can reach.

It is not how the doc stays current day to day — a change that adds a route updates the map in its
own PR, which is the kernel's rule and costs nothing. This Skill is for the moves that rule cannot
absorb: the first write, a module boundary that no longer matches the code, an exposure map that
has drifted away from the real routes.

## Inputs

`--section modules | orchestration | split | state | surfaces`, optional — refreshes one section.

## Steps

1. **Extract or elicit.** Extract when a source tree exists; elicit when the repo is empty.
2. **Invoke `app-architect`** with the material. It reads the tree, drafts each section and
   challenges it. The questions and the confirmations happen here, in this session — a subagent
   cannot interview.
3. **Fill the exposure column in extract mode.** Entry points are enumerable: `app/**/page.tsx` and
   `app/**/route.ts` for the App Router, files carrying `'use server'` for server actions, plus the
   job and webhook registrations. Enumerate them, attach each to the module it serves, and ask the
   engineer for a status per entry point — `live`, `routable` or `off`, as the kernel defines them.
   A module reached only through another module's entry point names that one instead; a module no
   live entry point reaches is `dormant`, which is derived and never a fourth status.
4. **One line the map carries, not this Skill's to restate:** it grades the **product** severity of
   a finding, never its security severity. Every routable entry point is covered by the kernel's
   security checklist whatever the map says.
5. **Each section ends with its drift challenge**, and the answer stays in the doc as evidence the
   probe ran. A challenge that surfaces a real contradiction stops the section: the engineer
   revises it, files an ADR, or writes a tech-debt file.
6. **A section-targeted refresh re-reads the other four challenges** before the PR — a module
   renamed in Section 1 and left standing in Section 4 is the failure this catches.

## Output

`hstack/context/app-architecture.md`, updated in the PR that changes it. Nothing else: no module
spec stubs, no config file, no status.

## Stop conditions

Beyond the kernel's:

- Extract mode was asked for and no source tree is reachable.
- An entry point's status is a guess. Ask; a wrong `off` is how a live surface stops being reviewed.
- A step of a flow has no declared mechanism, or a rationale that names no property anyone could
  disagree with.
- A drift challenge surfaces a contradiction with `data-architecture.md` — typically a state class
  with nowhere to live. Surface it; the engineer decides whether the data doc moves.
