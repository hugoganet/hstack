---
id: <module-key>                       # equals the module key in hstack/config.yaml
type: module-spec
status: drafted                        # drafted | current | needs-refresh | archived
owner: <git-handle>
paths: []                              # required; canonical module-to-paths mapping (globs)
last-refreshed: <YYYY-MM-DD>
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## Purpose

_What this module is responsible for. 2–4 sentences. Author may grep `paths` to verify._

## Public Surface

_Exports, routes, RPCs the module exposes outward. Bullets._

-

## Data Owned

_Tables, columns, and indexes this module is the canonical owner of. Bullets._

-

## External Dependencies

_Other modules, third-party services, MCPs this module depends on. Bullets._

-

## Invariants

_Challenge prompt: what would a careless refactor in this module break that the tests would not catch? Minimum 3 bullets (validator rule MS-03)._

-
-
-

## Known Tech-Debt and ADRs

_Pointers._

## Refresh Policy

_What triggers a refresh and what the refresh entails. One paragraph. The 60-day `needs-refresh` cron flags this spec if untouched._
