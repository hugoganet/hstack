---
id: data-architecture
type: data-architecture
status: drafted                        # drafted | current | needs-refresh | archived
owner: <git-handle>
schema-snapshot-date: <YYYY-MM-DD>
rag-architecture-version: 1
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## Tables and relationships

_ER diagram in mermaid or prose. The canonical tables, columns of interest, and foreign-key relationships._

## RLS model

_The universal pattern + per-table deviations. Validator rule DA-01: this section must contain the word "RLS" in a heading._

## RAG and embeddings

_Where embeddings live, how retrieval is scoped, what the cache looks like, how tenant_id is enforced on every RPC._

## Data lifecycle

_Retention, archival, deletion. Per-table policies._

## External data sources

_Third-party integrations that write to our store. Webhook signature verification posture._

## Conventions

_Naming, soft-deletes vs hard-deletes, audit fields, timestamp conventions, UUID vs serial._
