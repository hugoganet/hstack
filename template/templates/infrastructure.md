_Where things run, why the couplings are what they are, and the traps. Operational truth, not policy — read it before touching env, deploy or dependencies (kernel § Context docs), and update it in the PR that makes it wrong. An honest "we don't have this yet" is the right answer whenever it is the true one._

## Where things run

_One row per distinct runtime — app, edge functions, workers, cron, queue consumers. Names copied from the provider console, not paraphrased._

| Runtime | Provider | Region(s) | Plan / tier | Notes |
|---|---|---|---|---|
| | | | | |

- **Domains, DNS, TLS, CDN.**
- **Declared in code vs clicked in a console.** List the clicked resources explicitly — each one is a load-bearing piece of tribal knowledge.

## Data & storage

_Operational only. Schema, tenancy and RLS live in `data-architecture.md`._

- **Primary database** — host, plan, connection pooling.
- **Backups** — cadence, retention, point-in-time-recovery window.
- **Last restore drill** — date, and what it proved. An untested backup is a wish.
- **Replicas / failover.**
- **Vector or search infrastructure.**
- **Buckets** — one line each: purpose, public or not, lifecycle.

## Environments

_What dev, preview and production are, and what actually differs between them._

| Environment | App URL | Database it points at | Seed data | Notes |
|---|---|---|---|---|
| | | | | |

- **Source of truth for environment variables**, and how they are scoped per environment.
- **Does production data ever flow downstream?** If so, with what redaction.
- **Cross-environment guardrails.** Testing against production is a kernel-forbidden path; a violation found here is a tech-debt file, not a footnote.

## Secrets

- **Where they live.** The one store that is authoritative.
- **How they reach the runtime.**
- **Who has access**, and how that is reviewed.
- **Rotation** — cadence, and where the steps are written down.

## Deploy Pipeline

_How code reaches production, and the exact commands `/hstack-promote` will look for here. A command left blank halts the promotion — which is the correct outcome, because guessing a production command is how the wrong project gets migrated._

| What `/hstack-promote` needs | Command |
|---|---|
| Apply a pending migration to production | |
| List deployments and their state | |
| Smoke-test a specific deployment URL | |
| Read production logs | |
| Promote a deployment | |
| Roll back to the previous deployment | |

- **Promotion path.** How a merge becomes an unpromoted production build, and what promotes it. Auto-assignment of the production domain must be off for the staged flow to exist at all.
- **Who may promote.**
- **Rollback.** What re-promoting the previous deployment does and does not undo — migrations are additive, so they stay.

## Observability

_Where `/hstack-promote` looks in its post-promotion window, and where a daily glance happens._

- **Logs** — where, retention.
- **Error tracking** — tool, project, who watches it.
- **Uptime monitoring.**
- **Alert routing** — which alert reaches whom, on which channel. "Nobody is paged" is an answer; write it down rather than implying one.

## Couplings & gotchas

_The section that earns this file. Everything a newcomer — human or agent — would otherwise learn by breaking production: a region that must match another region, a version pinned because the next one broke us, a service that must be deployed before another, a quota that bites at a specific hour._

-

_External services this depends on at runtime. Criticality: `hard` = the product is down, `soft` = degraded, `optional` = no user impact._

| Provider | Purpose | Criticality | What happens when it is down |
|---|---|---|---|
| | | | |

## MCP access

_Which MCP servers are wired, where they point, what they can do. An MCP is a security boundary equivalent to the token it carries: a session with a project-scoped token has that project's full blast radius. The rules — no write-capable MCP against production outside `/hstack-promote`, and no write-capable MCP active in a session that reads user-generated tenant-scoped content — belong to the kernel § Stop conditions. This table is the inventory those rules are applied to._

| MCP server | Points at | Access mode | Token storage | Notes |
|---|---|---|---|---|
| | | | | |

_"Not wired" is an acceptable value, and often the preferred one for production._

## Known gaps

_What is missing or unknown, named rather than implied. A gap with a shape is a file under `hstack/tech-debt/`; link it here. A gap without one — a dependency whose failure mode nobody has thought through — is a line here until someone does._

-
