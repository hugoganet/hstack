---
id: incident-runbook
type: incident-runbook
status: drafted                        # drafted | current | needs-refresh | archived
owner: <git-handle>
git-ignored: true                      # this file MUST be gitignored; sensitive content
last-quarterly-review: <YYYY-MM-DD>
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

<!--
WARNING: This file contains sensitive operational content (auth provider details, revocation endpoints,
customer communication templates, phone tree). It MUST be gitignored. Per architecture amendment A7,
the file lives locally and is synced to an out-of-band destination configured in hstack/config.yaml as
`incident-runbook.sync-target`. Auto-commit does not apply to this file. The init Skill must add the
entry to .gitignore as part of bootstrap.
-->

## Kill switches

_Feature flags and how to flip them, ordered by blast radius. Most-dangerous-first._

-

## Revocation flows

_Per third-party: Stripe, Supabase, Pipedream, MCPs. Steps to revoke a session, an OAuth token, an API key._

### Stripe

### Supabase

### Pipedream

### MCPs

## Customer communication

_Copy templates per severity (P0 / P1 / P2). Channels (in-app, email, status page)._

### P0 template

### P1 template

### P2 template

## Escalation contacts

_Owner phone tree. Mark each entry with privacy boundary (work-hours OK / 24-7 OK)._

-

## Post-incident

_Runbook for the followup ADR or tech-debt write-up. Pointer to ADR template._
