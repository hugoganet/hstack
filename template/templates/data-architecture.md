---
id: data-architecture
type: data-architecture
status: draft                          # draft | current | needs-refresh | archived
owner: <git-handle>
assumes-database: postgres             # explicit so Phase 4 stack-decide can flag drift
schema-snapshot-date: <YYYY-MM-DD>
rag-architecture-version: 1
derived-from: [product-brief]
downstream: [app-architecture, threat-model, hardening-checklist, module-spec/*]
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## 1. Tenancy Model

_The load-bearing question. The data-architect refuses to advance past this section until the tenant definition is concrete and ties to a persona in the brief._

**A tenant is a ...**

_One concrete noun from this product's own vocabulary, plus the rule for who is inside one and who is not. Common shapes, offered as examples rather than as a menu: the customer organization (one workspace per paying customer, users inside share visibility); a sub-team within that organization (multi-workspace per customer); the individual user (workspace-per-user). Products whose tenant is a project, a device, a contract, a site, a case or a season are ordinary and none of those three fit them — name yours._

**Rationale**

_One sentence tying the tenant to a persona in `product-brief.md`. Example: "The tenant is the customer organization, because Maya (Director of CS) shares visibility with her 6 reps and no v1 persona asks for sub-team isolation."_

**Tenant identifier**

_The column name and type used to scope every tenant-scoped table (`workspace_id uuid`, `org_id text`, etc.). All downstream RLS predicates reference this column._

## 2. Entity Graph

_The set of entities and their relationships. Each entity must trace to either a persona-named action in `product-brief.md` or to the tenancy model from Section 1. Orphan entities halt with the drift challenge._

**Entities**

| Entity | Owns | Traces to | Relationships |
| --- | --- | --- | --- |
| <entity-name> | <one-line statement> | <persona-action OR tenancy-derived> | <FK refs> |

**Conventions** (subsumed from prior template)

_Naming (snake_case, plural tables), timestamps (`created_at`, `updated_at` on every table, ISO 8601), soft-deletes vs hard-deletes per entity, UUID vs serial choice with rationale, audit fields if any._

**Drift challenge answered**

_"Does any entity here have no trace to a persona or feature in the brief? Name it."_

## 3. RLS Posture

_Per-table policy sketch. Every entity from Section 2 falls into one of two categories — no third._

**Tenant-scoped tables**

| Table | Policy predicate sketch | Notes |
| --- | --- | --- |
| <table> | `<tenant-column> = current_setting('app.<tenant-column>')::uuid` | <e.g., RPC-only writes, no direct INSERT> |

**Intentionally global tables**

| Table | Why no RLS | Rationale |
| --- | --- | --- |
| <table> | <lookup data \| public reference \| ...> | <one sentence> |

**Drift challenge answered**

_"Does any tenant-scoped entity have an RLS policy that the chosen tenancy model wouldn't enforce? Name it."_

## 4. RAG / pgvector

_Whether v1 uses embeddings, what entity carries them, which embedding model, the tenant-scoped retrieval RPC signature. If v1 does not use RAG, mark this section `not-in-v1` with rationale and skip ahead._

**Use in v1**

_`yes` or `not-in-v1`. If not-in-v1, justify in one sentence (e.g., "v1 ships change-awareness without semantic retrieval; pgvector is a v2 layer")._

**Embedding-bearing entities**

| Entity | Embedding column | Model | Dimensions | Tenant-scoped retrieval RPC |
| --- | --- | --- | --- | --- |
| <entity> | <column name> | <e.g., openai:text-embedding-3-small> | <e.g., 1536> | <RPC signature with tenant predicate> |

**Tenant-scoping requirement**

_Every retrieval RPC MUST filter by the Section 1 tenant identifier. The drift challenge verifies this._

**Drift challenge answered**

_"Does any embedding-bearing entity have a retrieval RPC that bypasses tenant scoping? Name it."_

## 5. Migration Sketches

_Postgres-dialect DDL sketches for the initial migrations, with `-- TODO: confirm` markers on uncertain parts. The implementer reads these during bootstrap and writes the actual `.sql` files; the sketches are intent, not executable. Typical ordering: schema → RLS → pgvector. Data must never land before RLS._

**Migration sequence**

```
m_0001_initial_schema.sql      -- Section 2 entities, tables + FKs, no policies yet
m_0002_rls_policies.sql        -- Section 3 policies, applied per tenant-scoped table
m_0003_pgvector_setup.sql      -- Section 4 RPCs and indexes (skip if not-in-v1)
m_0004_seed_global_data.sql    -- Section 3 intentionally-global table seeds (optional)
```

**Sketch — m_0001_initial_schema.sql**

```sql
-- TODO: confirm UUID extension is enabled
create extension if not exists "uuid-ossp";

-- TODO: confirm column types and FK ON DELETE behaviors per entity
create table <entity> (
  id uuid primary key default uuid_generate_v4(),
  <tenant-column> uuid not null references <tenant-table>(id) on delete cascade,
  -- entity-specific columns
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

**Sketch — m_0002_rls_policies.sql**

```sql
-- TODO: confirm session-variable name matches app convention
alter table <entity> enable row level security;

create policy <entity>_tenant_isolation on <entity>
  for all
  using (<tenant-column> = current_setting('app.<tenant-column>')::uuid);
```

**Sketch — m_0003_pgvector_setup.sql** (skip if Section 4 is `not-in-v1`)

```sql
-- TODO: confirm pgvector version compatible with embedding model dimensions
create extension if not exists vector;

alter table <embedding-bearing-entity>
  add column embedding vector(<dimensions>);

create index on <embedding-bearing-entity> using ivfflat (embedding vector_cosine_ops);

-- TODO: confirm RPC signature and tenant predicate
create or replace function nearest_<entity>(query_embedding vector, k int, p_<tenant-column> uuid)
  returns table (id uuid, score float4)
  language sql stable
as $$
  select id, embedding <=> query_embedding as score
  from <embedding-bearing-entity>
  where <tenant-column> = p_<tenant-column>
  order by score
  limit k;
$$;
```

**Data lifecycle** (subsumed from prior template)

_Retention windows per entity (e.g., "interactions: 18 months hot, archived after"), archival path, deletion guarantees (hard-delete vs soft-delete vs anonymize-and-retain). Lifecycle differences per tenant tier (free vs paid) noted here._

**Drift challenge answered**

_"Does any migration in the sketch sequence land data before its RLS policy? Name it."_

## Coherence check (end-of-atom)

_When the atom reaches terminal state, the agent re-runs all five drift challenges. Any unanswered challenge halts the commit._
