---
id: ci-cd
type: ci-cd
status: drafted                        # drafted | current | needs-refresh | archived
owner: <git-handle>
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## Branch model

_main, integrations, change/* — what each branch is for. Branch naming convention mirrors change-spec id._

## Gates

_Every check in `.github/workflows/hstack-gates.yml` plus pre-existing CI checks. Validator rule CI-01: every gate named in the workflow file must appear here._

-

## Deploy targets

_Preview, staging, production. What promotes to what. Manual vs automatic._

## Rollback

_How to revert a bad deploy. Feature flags vs git revert vs DB migration rollback. Reference incident-runbook for production paths._
