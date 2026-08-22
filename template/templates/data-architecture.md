---
id: data-architecture
type: data-architecture
assumes-database: postgres             # explicit, so a database change surfaces as a contradiction
schema-snapshot-date: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
---

## 1. Tenancy Model

_The load-bearing question. Nothing downstream stabilizes until this one is concrete._

**A tenant is a ...**

_One concrete noun from this product's own vocabulary, plus the rule for who is inside one and who
is not. Common shapes, offered as examples rather than as a menu: the customer organization (users
inside share visibility); a sub-team within it; the individual user. Products whose tenant is a
project, a device, a contract, a site or a case are ordinary and none of those three fit them —
name yours._

**Rationale**

_One sentence tying the tenant to a real user. Example: "The tenant is the customer organization,
because Maya shares visibility with her 6 reps and nobody has asked for sub-team isolation."_

**Tenant identifier**

_The column name and type scoping every tenant-scoped table (`workspace_id uuid`, `org_id text`).
Every RLS predicate below references this column._

## 2. Entity Graph

_The entities and their relationships. Each entity traces to something a user does, or to the
tenancy model above._

| Entity | Owns | Traces to | Relationships |
| --- | --- | --- | --- |
| <entity-name> | <one-line statement> | <user action OR tenancy-derived> | <FK refs> |

**Conventions**

_Naming (snake_case, plural tables), timestamps (`created_at`, `updated_at`, ISO 8601), soft- vs
hard-deletes per entity, UUID vs serial with rationale, audit fields if any._

**Drift challenge answered**

_"Does any entity here trace to nothing a user does? Name it."_

## 3. RLS Posture

_Every entity from Section 2 falls into one of two categories — there is no third._

**Tenant-scoped tables**

| Table | Policy predicate sketch | Notes |
| --- | --- | --- |
| <table> | `<tenant-column> = current_setting('app.<tenant-column>')::uuid` | <e.g. RPC-only writes> |

**Intentionally global tables**

| Table | Why no RLS | Rationale |
| --- | --- | --- |
| <table> | <lookup data \| public reference> | <one sentence> |

**Drift challenge answered**

_"Does any tenant-scoped entity have a policy the tenancy model would not enforce? Name it."_

## 4. RAG / pgvector

_Whether embeddings are in use, what carries them, which model, and the tenant-scoped retrieval
RPC. If they are not in use, say so in one sentence and skip ahead._

| Entity | Embedding column | Model | Dimensions | Tenant-scoped retrieval RPC |
| --- | --- | --- | --- | --- |
| <entity> | <column> | <e.g. openai:text-embedding-3-small> | <e.g. 1536> | <RPC signature with the tenant predicate> |

_Every retrieval RPC filters by the Section 1 tenant identifier, inside the similarity search and
not after it._

**Drift challenge answered**

_"Does any embedding-bearing entity have a retrieval path that bypasses tenant scoping?"_

## 5. Migration Sketches

_Postgres-dialect sketches with `-- TODO: confirm` markers. The migration that ships is written by
the change that needs it; these are intent, not executable. Ordering: schema → RLS → pgvector. Data
never lands before its policy._

```sql
-- schema
create table <entity> (
  id uuid primary key default gen_random_uuid(),
  <tenant-column> uuid not null references <tenant-table>(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- policy, in the same migration as the table (kernel § Security checklist)
alter table <entity> enable row level security;

create policy <entity>_tenant_isolation on <entity>
  for all
  using (<tenant-column> = current_setting('app.<tenant-column>')::uuid);
```

**Data lifecycle**

_Retention per entity, archival path, deletion guarantees (hard-delete, soft-delete, or
anonymize-and-retain)._

**Drift challenge answered**

_"Does any migration in this sequence land data before its policy? Name it."_
