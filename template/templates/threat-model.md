---
id: threat-model
type: threat-model
status: drafted                        # drafted | current | needs-refresh | archived
owner: <git-handle>
last-quarterly-review: <YYYY-MM-DD>
surfaces-covered: [ui, api, db, infra, agent]
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

_One section per surface in `surfaces-covered` (validator rule TM-01). Each section enumerates concrete threats with: threat description, affected assets, mitigation, mitigation evidence (pointer to code, ADR, or hardening-checklist item). Length cap: 8 threats per surface._

## ui

### Threat: <name>
**Affected assets.**
**Mitigation.**
**Evidence.**

## api

### Threat: <name>
**Affected assets.**
**Mitigation.**
**Evidence.**

## db

### Threat: <name>
**Affected assets.**
**Mitigation.**
**Evidence.**

## infra

### Threat: <name>
**Affected assets.**
**Mitigation.**
**Evidence.**

## agent

### Threat: <name>
**Affected assets.**
**Mitigation.**
**Evidence.**

## Unknowns

_Challenge prompt: what threat to our multi-tenant boundary do you not yet have a mitigation for? This section must be present even when empty, to make the absence explicit (validator rule TM-02)._

-
