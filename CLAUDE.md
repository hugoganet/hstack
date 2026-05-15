---
hstack-version: v0.1.0
authority: kernel
---

# hstack — Kernel (CLAUDE.md)

This file is the kernel of the hstack engineering workflow. When a Claude Code session, Skill, or subagent operates under hstack, this file is the contract.

**In any conflict between this kernel and another document — the architecture doc, a template schema, an ADR, any source — this kernel wins.** Other documents extend the kernel; they do not override it. If the kernel is wrong, fix the kernel first and propagate downstream.

---

## What hstack is

hstack is a spec-driven engineering workflow that ships as Claude Code Skills and subagents, configurable per repo. It governs how engineers and AI agents collaborate on a codebase from change inception through merge: scoping, gating, artifact production, multi-tenant safety, audit, reviewability.

What hstack is not: a methodology framework like BMAD or Spec Kit (we adopted patterns; we are not those frameworks); a project tracker (artifacts in the repo are the tracker); a deployment system (deploys happen outside hstack); or a SOC 2 / GDPR compliance substrate by itself (v1 is good engineering hygiene; v2 covers compliance).

Operating under hstack means every change goes through the workflow, every artifact lives under `hstack/`, every status transition is written by a subagent and auto-committed, every Skill loads its required product context at session start, and the human's job is to answer questions and confirm — not to write.

---

## Scope rules

Every change-spec at `hstack/specs/changes/<id>/spec.md` declares an **In-Scope** file allowlist and an **Out-of-Scope** list. The `implementer` subagent must obey them:

- **Writes are restricted to In-Scope only.** Refuse to write or modify any file not in the In-Scope list.
- **Reads are permitted for the canonical session-start context loads (see the Product context section) plus the In-Scope list.** Reading outside this combined set is prohibited; if additional reads are required, halt and request a scope amendment.
- Refuse to drop, weaken, or modify any invariant declared in the spec's Invariants section.
- If scope expansion is necessary, halt and emit a scope-amendment request rather than acting unilaterally. The engineer updates the spec, the implementer re-loads it, execution resumes.

CI enforces the write boundary at PR time. Files modified outside In-Scope block the merge.

---

## Frontmatter contract

Every artifact under `hstack/specs/`, `hstack/context/`, `hstack/adr/`, `hstack/tech-debt/`, and `hstack/research/promoted/` carries YAML frontmatter. The shared floor every artifact must include:

```yaml
---
id: <kebab-case slug, immutable>
type: <controlled enum — see template schemas>
status: <controlled enum per type>
owner: <engineer responsible>
created: <ISO 8601 date>
updated: <ISO 8601 date>
---
```

Per-type fields extend this floor. The full per-type schema is authoritative in the template schemas doc: https://www.notion.so/361d6791656c8178bbbbc812fa6426e0. The kernel does not duplicate per-template detail.

Naming rules: `id` is kebab-case and immutable once written; dates are ISO 8601; controlled enums are case-sensitive; arrays are YAML arrays, never comma-separated strings.

---

## Status lifecycle

Status transitions are written by subagents, not humans. Each subagent updates the status field at phase completion as part of its workflow. The engineer never writes status manually.

Two rules:

- **Auto-commit at status transition.** Every time a subagent moves an artifact's status to a new value, the change is git-committed to the active working branch. This produces the audit trail and provides the resumability checkpoint.
- **Upstream must be terminal before downstream advances.** A change-spec reaches `ready-for-implementation` only when plan, security-review, data-review (when applicable), and ui-brief / figma-handoff (when applicable) are at correct terminal states. The transition gate is computed from artifact statuses, not asserted by an agent.

Per-type lifecycles live in the template schemas doc.

---

## Resumability

A crashed or interrupted session must lose at most one in-flight field of work.

- **Incremental writes.** Every confirmed field writes to disk immediately. Subagents never batch a long interview and write at the end.
- **Idempotency.** Every Skill is idempotent in the LLM-agent sense: re-running a Skill reads current disk state, recognizes completed phases, and produces a no-op diff for them.
- **Session state.** Long-running interviews persist their state at `hstack/.session-state/<session-id>.yaml`. This directory is git-ignored.
- **Auto-commit at status transitions.** Every phase boundary auto-commits. Worst-case loss between Skill invocations is the work in the active turn.

Claude Code's native conversation persistence (under `~/.claude/projects/`) is the floor underneath.

---

## AI writes, humans confirm

Almost every hstack artifact is produced by a subagent through a conversational interview. The human's role is to answer questions and confirm fields, not to write.

- Subagents **never** write a field silently. Every artifact field passes through an explicit confirmation gate before disk write.
- For low-stakes templates (story, ui-brief, vision, glossary, mvp-scope, persona, tech-debt) the interview is confirmation-driven: the agent proposes, the human accepts or revises.
- For high-stakes templates (security-review, data-review, adversarial-review, threat-model) the templates carry **challenge prompts** that probe for omissions — what the human did not think to mention. This is the v1 mitigation for the known asymmetry that humans miss what's missing. v2 moves the challenge logic into subagent prompts.

---

## Authoring and review never share a session

The `implementer` and the `adversarial-reviewer` must run in separate Claude Code sessions. The implementer's working memory, scratchpad, and conversation are not loaded into the adversarial-reviewer's session.

This is honor-system in v1. The v2 substrate adds session-id verification at the CI gate. Until then, the engineer is responsible for opening a fresh session before running `/hstack:adversarial-review`.

---

## Multi-module changes

One module per change-spec. A change that meaningfully touches more than one module splits into multiple change-specs, each scoped to a single module, linked via a `parent-change` frontmatter field.

The parent change-spec is a coordination artifact — no plan, no security-review, no implementer of its own. Each child runs the workflow independently. The parent reaches `shipped` only when every child has shipped.

Never let a single change-spec span modules. The implementer's scope-lock and the adversarial-reviewer's findings quota both stop working when In-Scope spans subsystems.

---

## Trivial changes

Some changes are too small to justify the full workflow: a typo fix, a comment edit, a dependency version bump where no functional surface changes. These bypass spec-presence and scope-completeness gates via the `trivial` PR tag.

A change qualifies as trivial only when **all** of the following hold: zero new functionality, zero behavior change, zero new files, no security-sensitive surface touched (no agent code, no auth code, no pgvector calls, no tool boundaries), no migration. If any of these fails, the change runs the full workflow.

The `trivial` tag is an escape hatch, not a release valve. Misuse is grounds for revert and re-shipping through the full workflow.

---

## v1 / v2 split

hstack v1 is good engineering hygiene. v1 does not by itself deliver SOC 2 or GDPR posture. The architecture document's v2 roadmap names the substrate work required before hstack-governed code can defensibly carry a production-grade label: executable security tests, audit-architecture spec, tool-call and MCP blast-radius controls, MCP hard-fail on load-bearing dependencies, session-id verification, and more.

Subagents and Skills in v1 must not falsely assert v2 guarantees. The `security-reviewer` produces a structured judgment, not an executable test result. The agent ledger is useful telemetry, not defensible audit evidence. Frame outputs accordingly.

---

## Product context

The product context layer lives at `hstack/context/`:

- `vision.md` — what the product is, what it does, what it is not.
- `glossary.md` — terms with non-obvious meaning.
- `mvp-scope.md` — in MVP, in v2, deferred.
- `personas/` — one file per persona, or one row per persona in the configured store.
- `data-architecture.md` — data model, schema, RAG architecture, embedding strategy.
- `tech-stack.md` — canonical languages, frameworks, infrastructure.
- `ci-cd.md` — CI/CD setup of the consuming repo.
- `threat-model.md` — threats per attack surface, with mitigations.
- `hardening-checklist.md` — scored items per stack layer.
- `incident-runbook.md` — kill switches, revocation flows, comms templates.

Load-at-session-start rules by subagent:

- `product-manager`: vision, personas, mvp-scope, glossary.
- `spec-author`: glossary, tech-stack, the relevant module-spec.
- `planner`: change-spec, ui-brief, figma-handoff, data-review (when present).
- `ui-ux-briefer`: configured design system docs, change-spec, linked stories.
- `security-reviewer`: threat-model, hardening-checklist, tech-stack, ci-cd.
- `data-specialist`: data-architecture, tech-stack, ci-cd, current schema (via MCP).
- `implementer`: change-spec, plan, security-review, data-review and ui-brief and figma-handoff when present, tech-stack.
- `verifier`: change-spec, ci-cd.
- `adversarial-reviewer`: all change artifacts; explicitly no implementer transcripts.
- `researcher`: query context plus relevant product-context docs as the query requires.

A subagent that cannot reach a required context document halts and asks the human, rather than proceeding without it.

**Promotion routing.** When the `researcher` promotes a research session into an ADR or a tech-debt item, it does so by handing off to `spec-author`, not by writing the ADR or tech-debt file directly. This preserves the conversational interview pattern that those templates depend on — challenge prompts for ADR consequences, reciprocity for tech-debt origin. Promotion into `hstack/research/promoted/` for durable notes (not ADRs or tech-debt) can be done by the researcher directly, since those are free-form reference artifacts.

---

## Templates

Templates live at `hstack/templates/`. Each template file is the canonical source for that artifact type. Subagents fill templates; they do not invent structure ad hoc.

Per-template detail — required fields, section structure, length norms, validation rules, status transitions, dependencies — lives in the template schemas doc: https://www.notion.so/361d6791656c8178bbbbc812fa6426e0. Read it before any template instance is authored.

---

## Stop conditions

A Skill or subagent must halt and ask the human when:

- A change-spec has empty Invariants or empty Scope Boundaries.
- A required upstream artifact is missing or not at terminal status.
- A load-bearing MCP is unreachable. Do not silently fall back to stale documents.
- A modification outside the In-Scope file list is needed.
- A `service_role` Supabase key, raw shell, or other forbidden tool would be used.
- A status transition is requested but the upstream gate computation does not permit it.
- The agent is asked to write a field for which the human has not provided an answer.

Halting is not failure. It is the correct response when preconditions are not met.

---

## No parallel tracker

Frontmatter is the state machine. Status, ownership, lifecycle position, dependencies — every load-bearing fact about an artifact lives in its frontmatter on disk. If a question can be answered by reading an artifact, the answer comes from the artifact, never from a separate dashboard, in-memory state, or external tracker.

Notion holds product context and decisions; it does not hold operational state. The repo holds operational state; it does not hold strategic context. The split is load-bearing.

---

## References

- Architecture document (long-form companion): https://www.notion.so/360d6791656c813d955af822cb8814d1
- Template schemas and frontmatter contracts: https://www.notion.so/361d6791656c8178bbbbc812fa6426e0
- Adversarial review of the architecture: https://www.notion.so/361d6791656c81f78eb3c97ba4aecbb4
