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

## Canonical Commands

_The exact commands `hstack/scripts/run-gates.sh` executes — the verifier runs every one of them and nothing else. The fenced `hstack-gates` block below is the machine-readable half; the prose above it is for humans. One `suite: command` pair per line. Suite keys mirror `verification.test-results`: `unit`, `integration`, `e2e`, `lint`, `typecheck`. Omit a line, or set it to `none`, for a suite this repo does not have — an omitted suite is not run and not scored. `unit` / `integration` / `e2e` are subject to V-05 (a suite that executes zero tests is recorded `not-run`, never `pass`); `lint` and `typecheck` are exempt._

_Extending this set is `/hstack:configure --interview ci-cd`, never an ad-hoc addition at verify time._

```hstack-gates
unit:        <command>
integration: <command>
e2e:         none
lint:        <command>
typecheck:   <command>
```

## Deploy targets

_Preview, staging, production. What promotes to what. Manual vs automatic._

## Rollback

_How to revert a bad deploy. Feature flags vs git revert vs DB migration rollback. Reference incident-runbook for production paths._
