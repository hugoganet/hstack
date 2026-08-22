# hstack

> **The tag `v0.16.0` is the complete version, frozen** — the full workflow, with its phases, artifacts and gates, kept intact for the day a team, a paying user or a compliance requirement asks for it. **`main` is light (v0.17)**, the subtractive pivot recorded in [ADR-0015](./adr/ADR-0015-the-light-pivot.md). We froze a version, not the repository.

An engineering workflow for humans and AI agents, shipping as Claude Code Skills and subagents. Rules the agent reads once, CI, an agent review on every PR, and living docs holding what it needs to remember between sessions.

hstack sits between an engineer's intent and a merged commit — without charging ceremony on every change.

## What hstack is

A thin, opinionated layer on top of Claude Code that governs how engineers and AI agents collaborate on a codebase. One kernel (`KERNEL.md`, ~1,700 words) that wins every conflict, nine Skills, four subagents, and the templates behind them. Two written artifacts remain: a PR description on every change, and a rare ADR for a one-way door.

## What hstack is not

- Not a methodology framework like BMAD or Spec Kit. Patterns were borrowed; the framework was not adopted.
- Not a project tracker. Notion holds product work, the repo holds engineering memory, GitHub holds PRs and CI.
- Not a deployment system, beyond the one step it does carry: `/hstack-promote`.
- Not a SOC 2 / GDPR compliance substrate by itself. v0.16.0 was good engineering hygiene; the light version keeps the hygiene that costs nothing per change, and ADR-0015 names what it gave up.

## Prerequisites

- **Claude Code** installed and authenticated.
- **Optional MCPs**, recognized when present and degraded cleanly when absent: Notion (features and stories), Supabase (live schema introspection when the data layer is being written down).
- Nothing else is strictly required. hstack runs against any codebase; the consuming repo's stack details land in `hstack/context/tech-stack.md`.

## Installation

hstack installs into the consuming repo at the path `hstack/` relative to the repo root via an npm-distributed CLI.

```
# from the consuming repo root (must be a git repo with a clean working tree)
npx hstack@latest init
```

`hstack init` copies the framework files under `template/` into `<consumer>/hstack/`, wires `.claude/agents` (dir-level symlink) and `.claude/skills/hstack-*` (per-skill symlinks), appends the kernel-import line to `<consumer>/CLAUDE.md`, and stamps `hstack/VERSION`. Nothing else in the consumer is touched — v0.17 removed the `.claude/settings.json` hook wiring and the `.gitignore` lines along with the machinery that produced the directories they hid. Use `--dry-run` to preview the plan, `--yes` to skip the confirmation prompt, `--force` to override the dirty-working-tree check.

The CLI ships three commands:

| Command | What it does |
| --- | --- |
| `npx hstack init` | First-time install. Halts if `<consumer>/hstack/` already exists. |
| `npx hstack update` | Sync framework files to the package version. Preserves user content (`context/`, `adr/`, `tech-debt/`). Surfaces a diff plan before writing. Migrates a pre-ADR-0010 install (`hstack/CLAUDE.md` → `hstack/KERNEL.md` plus the import line), and takes back what v0.17 removed: the enforcement scripts, the coord and telemetry trees, and the coord hooks in `.claude/settings.json`. |
| `npx hstack doctor` | Read-only health check. Reports version drift, framework file drift, missing or orphan symlinks, missing wiring lines, a stale pre-ADR-0010 kernel filename, and any Skill / subagent description over the ADR-0011 routing-trigger budget. Exits 1 on any finding. |

The kernel is installed at `hstack/KERNEL.md`, not `hstack/CLAUDE.md` (ADR-0010): Claude Code discovers *any* nested file named `CLAUDE.md` and injects it on the first read of a file in its directory, which loaded the whole kernel a second time on top of the `@`-import. The import in the consumer's root `CLAUDE.md` is the single load path — it fires at launch, survives compaction, and is inherited by subagents.

The framework-vs-user-content boundary is canonical in `src/manifest.ts`. **What `init` and `update` write**: `hstack/KERNEL.md`, `hstack/templates/`, `hstack/.claude/agents/`, `hstack/.claude/skills/`, `hstack/VERSION`. **What they never touch**: `hstack/context/`, `hstack/adr/`, `hstack/tech-debt/` — the engineering memory belongs to the repo that wrote it.

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
echo '> **Engineering workflow:** all changes in this repo are governed by hstack. See @hstack/KERNEL.md.' >> CLAUDE.md
git add hstack .claude CLAUDE.md && git commit -m "vendor hstack"
```

`hstack doctor` works against manually-vendored installs too. It will flag the missing `hstack/VERSION` marker as a warning until you run `hstack update --force` to stamp it.

Why agents is dir-level but skills is per-skill: consuming repos may want non-hstack skills (e.g., `lyra`, `notion-write`) alongside hstack ones. A dir-level symlink for `.claude/skills/` would evict them. Agents has no such case in practice, so dir-level is cleaner there.

### Maintenance — keeping a consumer in sync

Run `npx hstack@latest update` whenever you want to pull the latest framework version. It diffs `template/` against the consumer's `hstack/`, prints a plan (added / modified / removed files plus symlink delta), prompts for confirmation, then executes. The agents dir-level symlink picks up new agents automatically; per-skill symlinks for `.claude/skills/hstack-*` are added or removed by `update` to match the framework state.

Run `npx hstack doctor` to audit health without making changes — useful for CI checks, audits before opening a PR against the consumer repo, or onboarding a new contributor.

#### Adding or removing a Skill or subagent

`hstack update` handles this for a consumer pulling a release. A session working *in the framework source* carries the obligation manually, and lands the wiring change in the same PR as the Skill or subagent change:

| Change | Consumer-side action |
|---|---|
| New Skill at `.claude/skills/hstack-<name>/` | Create the symlink: `ln -s ../../hstack/.claude/skills/hstack-<name> <consumer-root>/.claude/skills/hstack-<name>` |
| Skill removed | Remove the matching symlink. Orphan symlinks are silent failures. |
| Skill renamed | Treat as removal + addition, in both source and consumer. |
| New subagent at `.claude/agents/<name>.md` | None. `.claude/agents/` is a dir-level symlink under the recommended pattern, so the file appears automatically. |
| Subagent removed | None, same reason. |
| Copy-based consumer (copied `.claude/` instead of symlinking) | Mirror every add / remove / rename by hand. The drift cost is why symlinks are recommended. |

#### Platform support

macOS and Linux only. Windows is hard-failed at `hstack init` — the dir-level + per-skill symlink wiring needs admin or developer-mode on Windows, and copy-mode fallback is a v2 consideration.

## First run

Open a fresh Claude Code session in the consuming repo. There is no init interview in the light version: the kernel is loaded by the import line, and the living docs get written when there is something true to write in them.

1. **Write the two architecture docs** when the shape of the product is settled enough to be worth recording — `/hstack-data-architecture` (tenancy, entities, RLS posture, RAG layout) and `/hstack-app-architecture` (module map with its exposure column, LLM call sites, deterministic-vs-LLM split, state ownership, surfaces). Both run in extract mode against a live schema or the source tree, and ask when extraction is not enough.
2. **Fill the rest by hand or in the PR that needs them**, from `hstack/templates/`: `tech-stack.md`, `infrastructure.md` — whose § Deploy Pipeline is what `/hstack-promote` reads — `roadmap.md`, `invariants.md`, `review-miss.md`.
3. **Then just work.** The per-change loop below is the whole of it.

## The change loop

The kernel states it in one line: branch → announce the perimeter → a five-bullet plan when the change holds more than three files → code and tests → `/hstack-wrap` → PR → fast CI green → a human other than the author reads → merge → `/hstack-promote`.

| When | Then |
| --- | --- |
| db, schema or RLS work | the Supabase skills, and `data-architecture.md` |
| the change is done | `/hstack-wrap` |
| the PR is merged | `/hstack-promote` |
| a sensitive surface is touched | `/hstack-adversarial-review`, in a fresh session |
| a bug a review missed | an entry in `review-miss.md` |
| a module's tests look thin | `/hstack-test-audit <module>` |

The nine Skills:

| Skill | What it is for |
| --- | --- |
| `/hstack-wrap` | The end of a change: runs `/review` and `/security-review`, audits test immutability, updates the living docs the diff invalidated, writes the PR description. |
| `/hstack-promote` | The release: pending production migrations, a smoke test on the unpromoted build, then promotion. Commands live in `infrastructure.md` § Deploy Pipeline. |
| `/hstack-commit` | The one Commitizen format humans and agents both write. |
| `/hstack-adversarial-review` | The deep pass on a sensitive surface, from a session that never saw the change being written. Findings land as a PR comment. |
| `/hstack-test-audit` | On demand, for one module: business rules against existing tests, the gaps named, the missing tests written. |
| `/hstack-data-architecture` | When the data layer really moves. |
| `/hstack-app-architecture` | When the application architecture really moves — the exposure map lives here. |
| `/hstack-adr-new` | A one-way door, drafted in the PR that implements it. |
| `/hstack-story` | The user story of a Notion feature. A product tool, never a gate on a change. |

Four subagents do the heavy reading behind them: `adversarial-reviewer`, `test-strategist`, `data-architect`, `app-architect`.

## Repository layout

After init the consuming repo has:

```
hstack/
  KERNEL.md                # the kernel (authority)
  VERSION                  # installed framework version
  context/                 # the agent's memory between sessions
    data-architecture.md   # tenancy, entities, RLS, RAG
    app-architecture.md    # module map + exposure map, LLM call sites, surfaces
    tech-stack.md          # pinned versions, pinned on purpose
    infrastructure.md      # where things run, why the couplings, the gotchas
    roadmap.md             # Now / Next / Later — advisory, never a gate
    invariants.md          # the business rules a test names
    review-miss.md         # what a review missed, so the next one re-checks it
    ...                    # frozen and dated: threat-model, product-brief, vision, personas, incident-runbook
  adr/                     # one-way doors only
  tech-debt/               # one file per item; deleted in the PR that fixes it
  templates/               # the eight canonical templates
.claude/
  skills/hstack-*/SKILL.md # nine Skills
  agents/                  # four subagents
```

## Honesty clause

- **Reviews are LLM judgments, not evidence.** An empty findings list means the reviewer found nothing, not that nothing is there. CI is the only mechanical check in the loop.
- **Fresh-session separation is honor-system.** `/hstack-adversarial-review` states that the session never saw the implementation conversation; nothing verifies it.
- **The exposure map grades product severity, never security severity.** Every routable entry point is covered by the kernel's security checklist whatever the map says.
- **The light version gave things up on purpose**, and ADR-0015 names them: retroactive traceability of a change's reasoning beyond its PR, the status machinery that made artifacts queryable, and the per-change gates. The trade was made pre-PMF, where the dominant risk is never shipping.

## Reference

Authoritative, in the repo:

- [`template/KERNEL.md`](./template/KERNEL.md) — the kernel. Authority over every Skill, subagent, and template.
- [`template/templates/`](./template/templates/) — the canonical structure of every artifact type.
- [`adr/ADR-0015-the-light-pivot.md`](./adr/ADR-0015-the-light-pivot.md) — why the pivot is subtractive, and what it costs.
- [`CHANGELOG.md`](./CHANGELOG.md) — the release history, including the full v0.16.0 lineage.

Historical companions, describing the frozen full version rather than `main`:

- [Architecture document](https://www.notion.so/360d6791656c813d955af822cb8814d1) — long-form companion to the pre-v1 kernel.
- [Adversarial review of the architecture](https://www.notion.so/361d6791656c81f78eb3c97ba4aecbb4) — the 21-finding pressure test that shaped the v1 / v2 split.

## Status

hstack v0.17.0 — the kernel at ~1,700 words, nine Skills, four subagents, eight templates. The `v0.16.0` tag holds the complete version: ~34 Skills, ~16 subagents, the validator, the merge gates, the coord and telemetry trees.

Next milestone: the first real use of the light version, upgrading moso-app from 0.7.1 to 0.17.
