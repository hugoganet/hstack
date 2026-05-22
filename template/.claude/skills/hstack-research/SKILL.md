---
name: hstack-research
description: |
  Use this skill when the engineer needs grounded research across one of five modes (API lookups, competitive scans, documentation, security CVEs, AI-native best practices) and wants a transient research session committed to `hstack/research/sessions/`. The Skill orchestrates the `researcher` subagent. A `--promote <session-id>` sub-mode elevates an existing session into an ADR (routes through `hstack-adr-new`), a tech-debt item (routes through `hstack-tech-debt-new`), or a durable note under `hstack/research/promoted/` (written by the researcher directly). Examples:

  <example>
  Context: The engineer is about to introduce a new HubSpot integration and needs to confirm current rate-limit and webhook signature behavior.
  user: "/hstack:research HubSpot CRM v3 webhook signature verification and current rate limits."
  assistant: "I'll invoke researcher in API-lookup mode. Canonical-source bias on HubSpot's docs over secondary tutorials; recency window pinned to the last 12 months. Session lands at hstack/research/sessions/<date>-hubspot-webhooks.md."
  <commentary>
  Mode classification drives source bias. API-lookup mode weights vendor docs over tutorials because tutorials are the most common cause of wrong-API integrations. Sessions are transient artifacts; the engineer chooses whether to promote.
  </commentary>
  </example>

  <example>
  Context: A research session reached a decision point; the engineer wants to promote it to an ADR.
  user: "/hstack:research --promote 2026-05-orchestration-patterns"
  assistant: "I'll route through /hstack:adr-new with --from-research 2026-05-orchestration-patterns. spec-author will receive the session findings as the Context section seed and walk the remaining Nygard sections via interview."
  <commentary>
  Promotion routing preserves the conversational interview pattern. The researcher does not write ADRs or tech-debt directly; it hands off via the appropriate Skill so the templates' challenge prompts are exercised.
  </commentary>
  </example>
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - WebSearch
  - WebFetch
  - "{{TODO-MCP: Notion MCP — optional; useful when research must include prior team decisions in Notion}}"
  - "{{TODO-MCP: GitHub MCP — optional; useful for searching issues and PRs on third-party SDK repos}}"
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates research session frontmatter}}"
  - "{{TODO-SCRIPT: hstack/scripts/garbage-collect-research.sh — clears sessions past their garbage-collect-after date; promoted sessions exempt}}"
---

## Purpose

`hstack-research` produces grounded research outputs via the `researcher` subagent and routes explicit promotion to durable artifacts. The Skill has two modes:

- **Default mode.** Invoke the researcher with a query; classify into one of five modes; write a transient session artifact under `hstack/research/sessions/` with sources, confidence markers, and proposed promotion targets.
- **`--promote <session-id>` mode.** Elevate an existing session to a durable artifact: ADR (route through `hstack-adr-new`), tech-debt (route through `hstack-tech-debt-new`), or a durable note under `hstack/research/promoted/` (the researcher writes this directly).

## When to invoke

Invoke when the engineer wants to ground a decision or implementation choice in current external information rather than speculation. Common triggers: third-party API integration choices, competitive scans before an ADR, security-CVE checks against pinned dependencies, AI-native pattern lookups (prompt-caching, retrieval, orchestration).

## Inputs

Default mode:
- `<query>` (required, positional): the research question, in natural language. The Skill does not require a pre-classified mode — the researcher classifies during the session.

Promote mode:
- `--promote <session-id>` (required): the session to elevate.
- `--target adr | tech-debt | note` (optional): the promotion target. When omitted, the Skill asks the engineer based on the session's proposed promotion targets.

## Preconditions

Before any work:

- Verify `hstack/config.yaml` exists at `init-status: complete`.
- Default mode: verify `hstack/research/sessions/` exists; create if absent.
- Promote mode: verify the named session exists at `hstack/research/sessions/<session-id>.md` and is at `status: current`. Verify the session is not already promoted.

## Orchestration steps

### Default mode

1. **Invoke `researcher`.** Use the Task tool with `subagent_type: researcher` and context = [kernel, query, mode-relevant context docs per the researcher's contract — tech-stack for API/documentation modes, vision/mvp-scope for competitive/AI-native modes, threat-model/hardening-checklist for security-CVE mode]. The subagent classifies the query, applies the mode's source bias, and writes findings incrementally.

2. **Source discipline.** Per the `researcher` contract:
   - API-lookup: canonical vendor docs over tutorials; 12-month recency window.
   - Competitive-scan: engineering-side sources over marketing pages; vendors named explicitly.
   - Documentation: canonical sources only; contradictions surfaced rather than papered.
   - Security-CVE: CVE databases and vendor advisories; recency window open; cross-checked against `tech-stack.md` pins.
   - AI-native best practices: 6-month recency bias; engineering blogs and tooling repos over vendor marketing.
   Every source is named with URL and access timestamp. Single-source claims marked explicitly.

3. **Confidence markers.** Each finding lands with `high | medium | low` confidence per the researcher's contract.

4. **Proposed promotion targets.** The session artifact closes with a Promotion Targets section: "Promote to ADR / tech-debt / research-note? Engineer decides." The Skill does not promote unilaterally.

5. **Session artifact frontmatter.** Includes `garbage-collect-after: <today + 30 days>` per the architecture's retention rule. Promoted sessions are exempt; the `--promote` operation sets a flag that the garbage-collector honors.

### Promote mode

1. **Read the session.** Surface the proposed promotion targets to the engineer.

2. **Route by `--target` value:**
   - `--target adr`: invoke `hstack-adr-new` with `--from-research <session-id>` and a slug supplied by the engineer. The ADR's Context section is seeded from the session findings; `spec-author` walks the remaining Nygard sections via its conversational interview, exercising the Consequences challenge prompt.
   - `--target tech-debt`: invoke `hstack-tech-debt-new` with the engineer-supplied slug and any `--origin <change-spec-id>` when applicable. `spec-author` walks the six tech-debt sections.
   - `--target note`: the `researcher` writes a durable note at `hstack/research/promoted/<topic>.md` directly. Free-form structure; no template constraint. This is the only target where the researcher writes the promoted artifact directly — the kernel's promotion-routing rule explicitly permits this for free-form notes.

3. **Mark the session as promoted.** Update the session's frontmatter with `promoted-to: adr:<ADR-NNNN>` (or `tech-debt:<TD-NNNN>` or `note:<path>`). Exempt from garbage collection.

## Outputs

Default mode:
- `hstack/research/sessions/<YYYY-MM-DD>-<topic-slug>.md` at `status: current`, with query, classified mode(s), sources, findings, options, and proposed promotion targets.

Promote mode (depending on `--target`):
- A new ADR at `hstack/adr/ADR-NNNN-<slug>.md` (via `hstack-adr-new`).
- A new tech-debt item at `hstack/tech-debt/TD-NNNN-<slug>.md` (via `hstack-tech-debt-new`).
- A new durable note at `hstack/research/promoted/<topic>.md` (written by the researcher).
- An edit to the source session marking it `promoted-to: ...`.

## Auto-commit triggers

- Default mode: one commit when the session artifact lands. Commit message: `research(<topic>): drafted`.
- Promote mode: the destination Skill's auto-commit fires (ADR or tech-debt). For `--target note`, one commit when the note lands plus the session's `promoted-to` edit.

## Idempotency contract

- Default mode: re-running with an identical query produces a new session file with today's date in the filename — research is recency-sensitive and re-running is intentional. The engineer may delete the prior session manually, or let the garbage collector handle it after 30 days.
- Promote mode: re-running on an already-promoted session is a no-op; the Skill detects the `promoted-to` field and exits.

## Stop conditions

Beyond the kernel's general stop conditions:

- Query is too vague to classify into a mode. Ask for clarification.
- A load-bearing context document is unreachable.
- Sources are contradictory and the resolution requires a human call.
- Promote mode: target is unspecified and the engineer has not chosen.
- Promote mode: the named session does not exist or is already promoted.
- Promote mode with `--target adr` or `--target tech-debt`: the routed Skill halts; surface the halt message.

## Failure modes

- **WebSearch / WebFetch rate-limited or unavailable.** Surface the limitation; the researcher proceeds with cached or partial results, naming confidence as `low` for affected findings.
- **A vendor's docs have moved and the canonical URL no longer resolves.** Note the broken canonical source explicitly; do not silently switch to a tutorial.
- **Promote-to-ADR or promote-to-tech-debt halts inside `spec-author`'s interview.** The session's `promoted-to` field is not written until the destination artifact is at terminal state. Resume by re-running the destination Skill directly.

## Anti-patterns

- Never paraphrase vendor marketing as fact.
- Never assign `high` confidence to a single-source claim.
- Never invent a CVE id or a version number.
- Never advocate for an option beyond what the evidence supports — present options with pros / cons / source-backing; the engineer decides.
- Never promote unilaterally. Promotion is engineer-driven via the explicit flag.
- Never write ADRs or tech-debt items directly from this Skill. Route via `hstack-adr-new` / `hstack-tech-debt-new`. The exception is `--target note`, which the researcher writes directly because durable notes are free-form.
- Never silently drop a contradiction between sources.
- Never load implementer transcripts or per-change artifacts for context bleed; research is upstream of implementation.
