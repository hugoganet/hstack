---
id: infrastructure
type: infrastructure
status: drafted                        # drafted | current | needs-refresh | archived
owner: <git-handle>
last-quarterly-review: <YYYY-MM-DD>
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

_Operational truth about how the consuming repo's product runs. Truth-gathering, not policy — `threat-model.md` and `hardening-checklist.md` carry the policy. This file is what `security-reviewer`, `data-specialist`, and any future `infra-specialist` read to ground change-time review in the system's actual shape. Length norm: 600–1500 lines once filled; shorter is honest for pre-prod, longer is a smell. Every H2 below must be present (validator rule INF-01); the Unknowns section must be present even when empty (INF-02); the Blast-Radius Matrix must list at least one row when status moves to `current` (INF-03); no MCP server may be wired with always-on write capability against prod (INF-04); LLM-driven sessions with a write-capable MCP active must not read user-generated content in the same session (INF-05)._

## Hosting & Compute

_Where each runtime lives. Provider, region(s), service tier/plan, instance class or function memory. Names must match the cloud console exactly — copy them, do not paraphrase. One row per distinct runtime (app, edge functions, workers, cron, queue consumers)._

| Runtime | Provider | Region(s) | Tier / Plan | Notes |
|---|---|---|---|---|
| | | | | |

## Networking

_DNS provider and zone, custom domains, TLS/SSL provisioning, CDN / edge cache, load balancing, ingress rules. Note which records are managed in code (IaC) vs the provider console._

- **DNS provider.**
- **Domains in use.**
- **TLS provisioning.**
- **CDN / edge.**
- **Load balancing.**
- **Egress controls.**

## Data Layer

_Database hosting, connection pooling, backup cadence, point-in-time recovery window, read replicas, retention policy. Defers schema and RLS to `data-architecture.md`; this section is operational (where and how, not what)._

- **Primary database.**
- **Connection pooling.**
- **Backups.**
- **Point-in-time recovery.**
- **Replicas / failover.**
- **Retention.**
- **Vector / search infrastructure.**

## Storage

_Object storage, file uploads, presigned-URL flows, lifecycle and retention. One row per bucket / container._

| Bucket | Provider | Purpose | Public? | Lifecycle | Notes |
|---|---|---|---|---|---|
| | | | | | |

## Secrets & Configuration

_Where secrets live, how they are injected at runtime, rotation cadence, who has access. **The runbook for rotation lives in `incident-runbook.md`; this section names the system, not the steps.**_

- **Secret store.**
- **Injection mechanism.**
- **Rotation cadence.**
- **Access control.**
- **Audit trail.**

## Environment Separation

_What dev, staging (if present), and production look like, and what differs between them. Data-promotion rules (does prod data ever flow downstream? if so, with what redaction?). Connection-string isolation. **Test-against-prod is a kernel-level forbidden tool; flag any violation here as tech-debt.**_

- **Dev.**
- **Staging.**
- **Production.**
- **Data-promotion rules.**
- **Cross-environment guardrails.**

## IaC Inventory

_What infrastructure is declared in code vs configured by click in a console. Path to IaC files. Tool (Terraform, Pulumi, CDK, OpenTofu, Supabase migrations, GitHub Actions YAML, Dockerfile). Who can apply. **Click-configured infra is not forbidden, but every clicked resource is a load-bearing tribal-knowledge item; list each one explicitly so it can be promoted to IaC over time.**_

| Resource | Source-of-truth | Path / location | Applier(s) | Notes |
|---|---|---|---|---|
| | | | | |

## Deploy Pipeline

_How code reaches each environment. References `ci-cd.md` for the build pipeline; this section captures the deploy half — promotion mechanics, rollout strategy (instant cutover, canary, blue/green), rollback procedure, who can trigger a deploy._

- **Build → deploy handoff.**
- **Promotion path.**
- **Rollout strategy.**
- **Rollback procedure.**
- **Deploy authorization.**

## Observability

_Logs, metrics, traces, error tracking, uptime monitoring. Where each lives, retention window, who reads them. Alert routing — which alerts wake whom, on which channel. **An observability gap is a production-readiness gap; an honest "we don't have this yet" entry is the right answer when true.**_

- **Logs.**
- **Metrics.**
- **Traces.**
- **Error tracking.**
- **Uptime monitoring.**
- **Alert routing.**

## Cost & Capacity

_Current monthly spend per service (approximate is fine). Budget alerts. Scaling triggers and ceilings. Rate-limiting posture (per-route, per-tenant). **Cost is a security and reliability concern, not just a finance concern: an unbounded scale ceiling is a billing-DoS vector.**_

| Service | Monthly spend (approx) | Budget alert at | Scale ceiling | Notes |
|---|---|---|---|---|
| | | | | |

- **Rate limits.**
- **Per-tenant quotas.**

## Disaster Recovery

_Recovery Point Objective (RPO) and Recovery Time Objective (RTO) targets per critical resource. Backup restore procedure (high level — full steps live in `incident-runbook.md`). Drill cadence — when was the last successful restore test, and when is the next scheduled. **An untested backup is a wish, not a recovery plan.**_

| Resource | RPO target | RTO target | Last drill | Next drill |
|---|---|---|---|---|
| | | | | |

## Blast-Radius Matrix

_Per critical resource: what depends on it, what dies if it dies, and who is notified. This is the table that `security-reviewer` reads when scoring an infra-surface change; it must list at least one row when status moves to `current` (INF-03)._

| Resource | Depends on | What dies if this dies | Notification path | Mitigation |
|---|---|---|---|---|
| | | | | |

## Access & Change Control

_Who has production console access per provider. MFA enforcement. Audit log location and retention. Deploy authorization — who can push to prod, who can apply IaC, who can rotate secrets. **The principle of least privilege applies here; list humans by name and access scope, not role abstractions.**_

| Human | Provider | Scope | MFA enforced | Last access review |
|---|---|---|---|---|
| | | | | |

- **Audit log location.**
- **Audit log retention.**
- **Access review cadence.**

## MCP Access Policy

_Which MCP servers are wired, where they point, what they can do. MCP access is a security boundary equivalent to the access token it carries — an LLM-driven session with tool access to a project-scoped token has the project's full blast radius. The kernel already forbids `service_role` Supabase keys and `supabase db push` / `db reset` against remote environments; MCP write access against prod is the analogous capability and follows the same rule. One row per MCP server per project it points at._

| MCP server | Wired at | Points at | Access mode | Token storage | Rotation cadence | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |

**Rule (INF-04).** No MCP server may be wired with write capability against the production project. Read-only mode (the server's `--read-only` flag or equivalent) is the floor for any MCP that points at prod. When a write-capable MCP must exist against prod for an operational reason (one-off migration applied through the MCP, e.g.), the row above carries a `--write-justified-by: <change-spec-id or ADR id>` note and the MCP is disabled by default — enabled only inside the named change window, then immediately disabled. Always-on write-capable prod MCPs are forbidden.

**Rule (INF-05).** Any LLM-driven session that has a write-capable MCP tool active must not, in the same session, read user-generated content from a tenant-scoped table. This is the prompt-injection mitigation: prevents stored content (customer support rows, webhook payloads, user-submitted fields) from steering the LLM into destructive tool calls. List each session pattern below — subagent name, Skill, or ad-hoc — and which side of this boundary it sits on.

| Session pattern | Write-capable MCP tools active? | Reads tenant-scoped content? | Compliant? |
|---|---|---|---|
| | | | |

**Per-MCP detail.**

- **Supabase MCP.** Dev project, staging project, production project — each on its own row. "Not wired" is an acceptable and often preferred value, especially for production.
- **Other MCPs** (Notion, GitHub, Linear, Figma, Slack, etc.). Each with its own access scope, token location, rotation. Notion and Slack MCPs in particular often surface external user-generated content into the session — flag them explicitly under INF-05.

## Compliance & Data Residency

_Regions where customer data lives at rest. GDPR-relevant flows (subject-access, deletion, export). Encryption at rest and in transit per data class. SOC 2 readiness gaps (this is honest enumeration, not a claim of posture). **v1 hstack does not by itself deliver SOC 2 or GDPR posture; the kernel says so explicitly. This section catalogs the gap, it does not close it.**_

- **Data residency.**
- **GDPR flows.**
- **Encryption at rest.**
- **Encryption in transit.**
- **Known compliance gaps.**

## Third-party Dependencies

_External SaaS the system depends on at runtime. One row per provider. Criticality reflects what happens if the provider is unavailable: `hard` = product is down, `soft` = degraded, `optional` = no user impact._

| Provider | Purpose | Criticality | Contractual SLO | Failure-mode behavior |
|---|---|---|---|---|
| | | | | |

## Known Gaps

_Open tech-debt items pointing to infrastructure shortcomings. Each entry is a link to a `hstack/tech-debt/TD-NNNN-<slug>.md` file. This section is the bridge between the operational truth captured above and the workflow's tech-debt machinery — every honest gap surfaced during the interview should land as a TD via `/hstack:tech-debt-new --origin <change-id>`._

-

## Unknowns

_Challenge prompt: what infrastructure dependency does the team not yet have a documented mitigation for? Name the dependency, name the failure mode, name the gap. This section must be present even when empty, to make the absence explicit (validator rule INF-02)._

-
