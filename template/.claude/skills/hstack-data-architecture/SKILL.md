---
name: hstack-data-architecture
description: "Use when the data layer really moves — tenancy, entities, RLS posture, RAG layout — to write or refresh `hstack/context/data-architecture.md`. Ordinary schema changes are covered by the kernel's same-PR rule."
---

## Purpose

`/hstack-data-architecture` writes or refreshes `hstack/context/data-architecture.md`, the living
doc that holds the data layer's posture in five sections: tenancy, entities, RLS, RAG, migrations.
It is what the next session reads before touching the database.

It is not how the doc stays current day to day. A change that adds a column updates the doc in its
own PR — that rule is the kernel's and costs nothing. This Skill is for the moves that rule cannot
absorb: the first write, a change of tenant, an entity graph that no longer matches the schema, an
RLS posture that has drifted.

## Inputs

`--section tenancy | entities | rls | rag | migrations`, optional — refreshes one section.

## Steps

1. **Extract or elicit.** Extract when a schema exists: the Supabase MCP if it is configured,
   otherwise `supabase/migrations/`. Elicit when nothing exists yet. **If the MCP is unreachable
   and the migrations are used instead, say so to the engineer** — the fallback is announced, never
   silent (kernel § Stop conditions). If neither is reachable, stop.
2. **Invoke `data-architect`** with the material gathered. It reads the schema, drafts each section
   and challenges it. The questions and the confirmations happen here, in this session — a subagent
   cannot interview.
3. **Walk the sections in order.** Tenancy first: nothing downstream stabilizes until the tenant is
   one concrete noun with a rule for who is inside one. Then entities, RLS, RAG, migrations.
4. **Each section ends with its drift challenge** and the answer stays in the doc as evidence the
   probe ran. A challenge that surfaces a real contradiction stops the section: the engineer
   revises it, files an ADR, or writes a tech-debt file — none of which this Skill decides.
5. **A section-targeted refresh re-reads the other four challenges** before the PR. Changing an
   entity and leaving the RLS section describing the old one is the failure this catches.

## Output

`hstack/context/data-architecture.md`, updated in the PR that changes it. Section 5 holds migration
*sketches* — no `.sql` file is written here.

## Stop conditions

Beyond the kernel's:

- No schema source is reachable in extract mode: the Supabase MCP is down *and* there are no
  migrations. Halt rather than describe a schema from memory.
- The tenant is still not one concrete noun after one re-ask.
- A drift challenge surfaces a contradiction the engineer has not resolved.
- The database in the doc's `assumes-database` is not the one the repo is using. Surface it; a
  silent switch invalidates every RLS predicate in the doc.
