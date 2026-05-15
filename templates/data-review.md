---
id: <parent-change-id>-data-review
type: data-review
status: draft                          # draft | in-progress | passed | concerns-acknowledged | failed | superseded
owner: <git-handle>
parent-change: <change-spec-id>
rls-coverage:
  new-tables: {}                       # { <table_name>: covered | partial | missing }
migration-safety: safe                 # safe | needs-backfill | risky
index-impact:
  added: []
  removed: []
pgvector-changes:
  rpcs-modified: []
  tenant-id-arg-present: true          # required true when any pgvector RPC is in the diff
rag-impact: none                       # scoped | broadened | narrowed | none
data-lifecycle: retained-indefinitely  # retained-indefinitely | retained-N-days | ephemeral
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## Schema Changes

_Every table created, altered, or dropped; every column added, renamed, or dropped._

## RLS Coverage

_For every new or altered table: the policy and the test that verifies it. Challenge prompt: name the exact RLS rule on this table and the test that would catch its absence._

### <table-name>

**Policy.**

```sql
```

**Test.**

## Migration Safety

_What the migration does on a non-empty production table. Locking behavior. Backfill plan if any. When `migration-safety: risky`, this section must enumerate locking and mitigation (DR-04)._

## Index and Performance Impact

_Indexes added or removed. Expected query patterns. Expected row counts at 1 month, 1 year._

## pgvector and RAG

_Required when any pgvector RPC is in the diff. RPCs touched, tenant_id presence, embedding cache implications._

## Data Lifecycle

_Retention, expiry, archival. Pointer to `data-lifecycle` frontmatter with rationale._
