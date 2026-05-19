# hstack

A spec-driven engineering workflow that ships as Claude Code Skills and subagents. Configurable per repo. Designed to take a brownfield AI-native SaaS codebase from prototype toward production-grade without adopting a heavyweight methodology framework.

hstack sits between an engineer's intent and a merged commit. Scoping, gating, artifact production, multi-tenant safety, audit, reviewability — all flow through it.

## What hstack is

A thin, opinionated layer on top of Claude Code that governs how engineers and AI agents collaborate on a codebase. Sixteen Skills, ten subagents, a small set of canonical templates, and one kernel (`CLAUDE.md`) that wins every conflict. AI writes; humans confirm. Artifacts on disk are the state machine — no parallel tracker, no separate dashboard.

## What hstack is not

- Not a methodology framework like BMAD or Spec Kit. Patterns were borrowed; the framework was not adopted.
- Not a project tracker. Frontmatter on artifacts is the tracker.
- Not a deployment system. Deploys happen outside hstack.
- Not a SOC 2 / GDPR compliance substrate by itself. v1 is good engineering hygiene; the v2 roadmap names the substrate work required before hstack-governed code can defensibly carry a production-grade label.

## Prerequisites

- **Claude Code** installed and authenticated. Pin a minimum version in `hstack/config.yaml` once init runs.
- **Optional MCPs** the workflow recognizes when present and degrades cleanly when absent: Notion (story / personas / decisions store), Linear or GitHub (alternative story stores), Figma (frame reading for UI work), Supabase (live schema introspection for data review).
- Nothing else is strictly required. hstack runs against any codebase; the consuming repo's stack details land in `hstack/context/tech-stack.md` during init.

## Installation

hstack vendors into the consuming repo at the path `hstack/` relative to the repo root. Submodule and CLI-installer distribution are deferred until the framework has run on real changes.

From the consuming repo root:

```
# vendor the framework (v0 recommended)
cp -r /path/to/hstack ./hstack
git add hstack && git commit -m "vendor hstack v0"
```

### Wire the workflow into the consuming repo's `.claude/`

Claude Code reads agents and skills from `.claude/` at the working directory's root. To make hstack discoverable from a session opened at the consuming repo's root (rather than requiring the engineer to `cd hstack/`), wire them via symlinks. Symlinks keep `hstack/` as the single source of truth and eliminate drift.

From the consuming repo root:

```
# Dir-level symlink for agents (no non-hstack agents expected at root)
ln -s hstack/.claude/agents .claude/agents

# Per-skill symlinks for hstack skills (preserves room for non-hstack skills —
# e.g., notion-write, supabase — as real directories alongside)
mkdir -p .claude/skills
for d in hstack/.claude/skills/hstack-*/; do
  name=$(basename "$d")
  ln -s "../../hstack/.claude/skills/$name" ".claude/skills/$name"
done

# Make the kernel rules visible at the repo root by importing them into the
# consuming repo's CLAUDE.md
echo '> **Engineering workflow:** all changes in this repo are governed by hstack. See @hstack/CLAUDE.md.' >> CLAUDE.md
```

Why agents is dir-level but skills is per-skill: consuming repos may want non-hstack skills (e.g., `lyra`, `notion-write`) alongside hstack ones. A dir-level symlink for `.claude/skills/` would evict them. Agents has no such case in practice, so dir-level is cleaner there.

Copy-based wiring (the older pattern) is also supported — copy `.claude/agents/` and `.claude/skills/hstack-*/` into the consuming repo's `.claude/` directly. The cost is duplication and drift on every hstack update; the symlink pattern is recommended.

### Maintenance — when adding or removing a Skill or subagent

The dir-level symlink for `.claude/agents/` means **new agents added under `hstack/.claude/agents/` need no further action** in the consuming repo — they appear automatically.

The per-skill symlinks for `.claude/skills/hstack-*` mean **new skills require a per-skill symlink** in each consuming repo:

```
# From the consuming repo root, after the new skill exists at hstack/.claude/skills/hstack-<new>/
ln -s "../../hstack/.claude/skills/hstack-<new>" ".claude/skills/hstack-<new>"
git add .claude/skills/hstack-<new>
```

When **removing** a skill, also remove the consuming repo's symlink (broken symlinks are silently ignored by Claude Code but show as red in `ls`):

```
rm hstack/.claude/skills/hstack-<old>/   # in the source
rm .claude/skills/hstack-<old>           # in the consumer
```

When **renaming** a skill, treat it as a removal + addition in both places.

A future `/hstack:configure --wire` mode will automate this; until then it is a manual step that lands in the same PR as the skill change.

## First run

Open a fresh Claude Code session in the consuming repo and run:

```
/hstack:init
```

Init is conversational and split into five-to-seven mini-sessions of ten-to-fifteen minutes each — one per product-context document. Each mini-session ends at a commit point so an interruption costs at most one in-flight field. Total elapsed time is 60–90 minutes for a fresh repo. No other Skill runs until init completes.

Init produces `hstack/config.yaml` and every required document under `hstack/context/`: vision, glossary, mvp-scope, personas, data-architecture, tech-stack, ci-cd, threat-model, hardening-checklist, incident-runbook. The product-manager subagent drives the interview. If the consuming repo has existing source documents (Notion pages, repo markdown, Google Docs), point the agent at them and it will map content into the canonical templates before walking field-by-field confirmation.

After init, run `/hstack:module-spec <area>` once per critical module to reverse-engineer baseline module-specs.

## Per-change workflow

Each change moves through up to eleven phases, each backed by one Skill. Conditional phases run only when the change's declared `surfaces` include the relevant tag (`ui`, `db`, `agent`, `auth`, `api`, `infra`).

| Phase | Skill | Required when |
| --- | --- | --- |
| Story | `/hstack:story-draft` | user-facing change |
| Scaffold | `/hstack:change-new <area> <slug>` | always |
| Spec | invoke `spec-author` directly | always |
| UI brief | `/hstack:ui-brief` | `surfaces` includes `ui` |
| Figma handoff | cofounder produces, commits `figma-handoff.md` | `surfaces` includes `ui` |
| Plan | `/hstack:change-plan` | always |
| Security review | `/hstack:security-review` | always |
| Data review | `/hstack:data-review` | `surfaces` includes `db` |
| Implement | `/hstack:implement <change-id> <task-id>` | once per phase |
| Verify | `/hstack:verify` | always |
| Adversarial review | `/hstack:adversarial-review` | always — **fresh Claude Code session required** |
| Ship | `/hstack:ship` | always — read-only scorecard + PR description |

Cross-cutting Skills are available throughout: `/hstack:adr-new`, `/hstack:tech-debt-new`, `/hstack:research`. The research Skill supports `--promote <session-id>` to elevate a research session into an ADR, a tech-debt item, or a durable note.

The `implementer` is the only subagent that writes code. It refuses every read and write outside `change-spec.in-scope`. Scope-amendments halt and route through `spec-author`; the implementer never extends scope unilaterally.

## Repository layout

After init the consuming repo has:

```
hstack/
  config.yaml              # repo-level configuration
  CLAUDE.md                # the kernel (authority)
  README.md                # this file
  context/                 # slow-changing product context
  specs/
    <module>/spec.md       # module baseline
    changes/<id>/          # per-change artifacts
  adr/                     # Architecture Decision Records
  tech-debt/               # known compromises
  research/
    sessions/              # transient
    promoted/              # durable
  templates/               # canonical templates
  lints/                   # pattern-based lint rules
  scripts/                 # validators, gate runners
.claude/
  skills/hstack-*/SKILL.md # 16 Skills
  agents/                  # 10 subagent personas
```

## Honesty clause: v1 vs v2

hstack v1 ships good engineering hygiene: spec discipline, scope-locked implementation, conversational interviews with confirmation gates, append-only ADRs and tech-debt, frontmatter-driven status. It does not by itself deliver SOC 2 / GDPR posture.

Three Skills in particular carry v1 / v2 markers in their output:

- **security-review.md** — v1 is LLM-scored structured judgment against the hardening checklist; v2 substrate replaces this with executable probes (prompt-injection corpora, RLS bypass attempts, tenant_id fuzzing, secret-redaction tests).
- **data-review.md** — v1 permits graceful degradation when the Supabase MCP is unreachable for low-stakes changes; v2 hard-fails uniformly.
- **adversarial-review.md** — v1 fresh-session separation is honor-system, attested in frontmatter; v2 verifies via Claude Code session-id comparison at the CI gate.

The Skills frame their output to reflect this. v1 rationales never claim "verified by test." When the honest answer is "structured judgment based on the diff," the artifact says so.

The full v2 roadmap lives in the architecture document.

## Reference

- [`CLAUDE.md`](./CLAUDE.md) — the kernel. Authority over every Skill, subagent, and template.
- [Architecture document](https://www.notion.so/360d6791656c813d955af822cb8814d1) — long-form companion to the kernel.
- [Template schemas and frontmatter contracts](https://www.notion.so/361d6791656c8178bbbbc812fa6426e0) — per-template fields, sections, lifecycle, validation rules.
- [Adversarial review of the architecture](https://www.notion.so/361d6791656c81f78eb3c97ba4aecbb4) — the 21-finding pressure test that shaped the v1 / v2 split.

## Status

hstack v0.1.0. Sixteen Skills, ten subagents, twenty-two templates, the kernel. Enforcement scripts (`hstack/scripts/`) and pattern-based lint rules (`hstack/lints/`) are sketched but not yet implemented — the Skills run as conversational interviews without them, and the CI gate runs in advisory mode until the scripts land. First real use against a consuming repo is the next milestone.
