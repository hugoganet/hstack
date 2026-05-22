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

hstack installs into the consuming repo at the path `hstack/` relative to the repo root via an npm-distributed CLI.

```
# from the consuming repo root (must be a git repo with a clean working tree)
npx hstack@latest init
```

`hstack init` copies the framework files under `template/` into `<consumer>/hstack/`, wires `.claude/agents` (dir-level symlink) and `.claude/skills/hstack-*` (per-skill symlinks), appends the kernel-import line to `<consumer>/CLAUDE.md`, and adds `**/.telemetry/` to `<consumer>/.gitignore`. Use `--dry-run` to preview the plan, `--yes` to skip the confirmation prompt, `--force` to override the dirty-working-tree check.

The CLI ships three commands:

| Command | What it does |
| --- | --- |
| `npx hstack init` | First-time install. Halts if `<consumer>/hstack/` already exists. |
| `npx hstack update` | Sync framework files to the package version. Preserves user content (`context/`, `specs/`, `adr/`, `tech-debt/`, `research/`, `config.yaml`, `telemetry/reports/`). Surfaces a diff plan before writing. |
| `npx hstack doctor` | Read-only health check. Reports version drift, framework file drift, missing or orphan symlinks, missing wiring lines. Exits 1 on any finding. |

The framework-vs-user-content boundary is canonical in `src/manifest.ts`. **What `init` and `update` write**: `hstack/CLAUDE.md`, `hstack/templates/`, `hstack/.claude/agents/`, `hstack/.claude/skills/`, `hstack/scripts/telemetry/`, `hstack/VERSION`. **What they never touch**: anything under the user-content paths above.

### Manual install (legacy)

If you prefer to vendor without the CLI — e.g., to pin to a specific git ref or develop against a fork — copy `template/` into the consuming repo and wire `.claude/` symlinks by hand:

```
# from the consuming repo root
cp -r /path/to/hstack/template ./hstack
ln -s ../hstack/.claude/agents .claude/agents
mkdir -p .claude/skills
for d in hstack/.claude/skills/hstack-*/; do
  name=$(basename "$d")
  ln -s "../../hstack/.claude/skills/$name" ".claude/skills/$name"
done
echo '> **Engineering workflow:** all changes in this repo are governed by hstack. See @hstack/CLAUDE.md.' >> CLAUDE.md
echo '**/.telemetry/' >> .gitignore
git add hstack .claude CLAUDE.md .gitignore && git commit -m "vendor hstack"
```

`hstack doctor` works against manually-vendored installs too. It will flag the missing `hstack/VERSION` marker as a warning until you run `hstack update --force` to stamp it.

Why agents is dir-level but skills is per-skill: consuming repos may want non-hstack skills (e.g., `lyra`, `notion-write`) alongside hstack ones. A dir-level symlink for `.claude/skills/` would evict them. Agents has no such case in practice, so dir-level is cleaner there.

### Maintenance — keeping a consumer in sync

Run `npx hstack@latest update` whenever you want to pull the latest framework version. It diffs `template/` against the consumer's `hstack/`, prints a plan (added / modified / removed files plus symlink delta), prompts for confirmation, then executes. The agents dir-level symlink picks up new agents automatically; per-skill symlinks for `.claude/skills/hstack-*` are added or removed by `update` to match the framework state.

Run `npx hstack doctor` to audit health without making changes — useful for CI checks, audits before opening a PR against the consumer repo, or onboarding a new contributor.

#### Telemetry

`hstack/scripts/telemetry/` ships with the framework and is installed by `hstack init` automatically. The `/hstack:telemetry` Skill shells out to `python3 hstack/scripts/telemetry/report.py --window 30`, generating a markdown report at `hstack/telemetry/reports/<YYYY-MM-DD>.md`. The reports directory is git-tracked; per-change `.telemetry/` sidecar dirs are git-ignored (`hstack init` adds the `**/.telemetry/` line for you).

Five Skills (`hstack-test-plan`, `hstack-implement`, `hstack-verify`, `hstack-adversarial-review`, `hstack-finalize`) emit small JSON sidecars at their existing terminal commits — schema in `hstack/templates/telemetry-sidecar.md`. The sidecars are derivative — re-runnable from git + frontmatter + transcripts — and exist only to make per-change attribution cheap. Deleting them is harmless.

#### Platform support

macOS and Linux only in v0.1. Windows is hard-failed at `hstack init` — the dir-level + per-skill symlink wiring needs admin or developer-mode on Windows, and copy-mode fallback is a v2 consideration.

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
