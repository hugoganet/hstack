# Changelog

All notable changes to hstack are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [Unreleased]

_Nothing yet._

## [0.3.0] - 2026-05-22

### Added
- **Kernel-fit closed-loop system.** Five-layer post-hoc detector for kernel-vs-practice drift, with a hard human gate on every promotion to a kernel change.
  - L1 Detection — new Python insight module `template/scripts/telemetry/insights/kernel_fit.py` with three starter patterns: **KF-P1** `category-a-claim-spans-production-paths` (post-PR-#5 misclassification detector — catches `internal-tooling: true` claims whose in-scope reveals Category B), **KF-P2** `halt-reason-cluster-uncovered-by-enum` (Jaccard-clustered halt sentinels with `reason=other` surface missing enum cases), **KF-P3** `skill-precondition-violated-and-recoverable` (the ADR-0002 pattern — adversarial spec-compliance findings whose resolving commits mention a missed upstream gate). Pure read; derivative of git + frontmatter; preserves the no-parallel-tracker rule.
  - L2 Synthesis — new `kernel-fit-analyst` subagent (model `opus`) loads kernel + shipped artifacts + prior findings; explicitly NOT implementer transcripts (same session-isolation rule as `adversarial-reviewer`). Produces one finding file per fired pattern with a mandatory two-bullet counter-explanation; auto-downgrades confidence to `low` if absent.
  - L3 Artifact — new template `templates/kernel-fit-finding.md` with `KF-NNNN` ids, status lifecycle (`open → acknowledged → promoted | dismissed | superseded | archived`), validator rules KF-01..KF-05.
  - L4 Skills — `/hstack:kernel-fit-scan` (detection + synthesis + Slack), `/hstack:kernel-fit-triage` (mechanical status flip per ADR-0001 with proposed-diff preview), `/hstack:kernel-fit-promote` (routes to `/hstack:adr-new --from-kernel-fit <id>`; `spec-author`'s Nygard interview is the human gate).
  - L5 Notification — Slack via `mcp__claude_ai_Slack__slack_send_message`, threshold-gated (medium/high only), 14-day dedup, graceful degradation when MCP unreachable (deliberate carve-out from the kernel's general MCP-unreachable stop condition).
- **Kernel `## How hstack improves itself` section** in `template/CLAUDE.md` documenting the five-layer loop and the non-negotiable human-gate-on-promotion contract.
- **`promoted-from-kernel-fit: []` field** on `templates/adr.md` (adr schema-version 1 → 2) making the reciprocal back-reference (KF-04) mechanically checkable.
- **`--from-kernel-fit` flag** on `/hstack:adr-new`, mirroring the existing `--from-research` pattern.
- **`kernel-fit/` entry** added to `src/manifest.ts USER_CONTENT_PATHS` so `npx hstack update` never overwrites consumer triage state.

See [ADR-0004](adr/ADR-0004-kernel-fit-closed-loop.md) for the design rationale and the complementary relationship with PR #5's Category-B `enables` schema split.

### Notes
- v1 honesty: detector patterns are hand-written Python rules; `validate-spec.ts` is still a `{{TODO-SCRIPT}}` placeholder so KF-01..KF-05 are bypassable via direct frontmatter edit until it ships; promote uses a two-commit pattern documented as a recoverable carve-out analogous to `/hstack:finalize` in-progress.
- KF-P1 was retargeted between authoring and release to detect the post-PR-#5 misclassification pattern rather than the pre-PR-#5 conflation (which PR #5 closed structurally).

## [0.2.0] - 2026-05-22

### Added
- **Category-B `enables` carve-out on change-spec.** New frontmatter fields `enables: []` and `enabled-by: []` separate foundational-prerequisite production code (Category B) from engineering-only `internal-tooling: true` (Category A). SP-09 expands to `user-stories` non-empty UNLESS `internal-tooling: true` UNLESS `enables` non-empty. New validator rules SP-13 (mutual exclusion of A and B) and SP-14 (`enables ↔ enabled-by` reciprocity). `/hstack:change-new` reconciles forward references at downstream scaffold time; `/hstack:help` renders the audit chain; `/hstack:ship` gains GT-12. Backwards-compatible — no schema-version bump; existing specs without the fields validate unchanged. See [ADR-0003](adr/ADR-0003-category-b-enables-field.md).

### Infrastructure
- **GitHub Action `publish.yml`.** Pushes to npm on `v*` tags. Verifies tag matches `package.json` version, publishes with `--provenance` and `--access public`. Requires repo secret `NPM_TOKEN`.

## [0.1.0] - 2026-05-22

### Added
- **CLI installer.** Three commands shipped on the `hstack` npm package:
  - `hstack init` — copies `template/` into `<consumer>/hstack/`, wires `.claude/agents` (dir-level symlink) and `.claude/skills/hstack-*` (per-skill symlinks), appends the kernel-import line to `<consumer>/CLAUDE.md`, adds `**/.telemetry/` to `<consumer>/.gitignore`, stamps `<consumer>/hstack/VERSION`. Flags: `--yes`, `--force`, `--dry-run`.
  - `hstack update` — diffs `template/` vs `<consumer>/hstack/` at file granularity, surfaces an add/overwrite/remove/symlink-delta plan, prompts for confirmation, then executes. Preserves user content (`context/`, `specs/`, `adr/`, `tech-debt/`, `research/`, `config.yaml`, `telemetry/reports/`). Flags: `--yes`, `--force`, `--dry-run`, `--verbose`.
  - `hstack doctor` — read-only health check. Reports version drift, framework file drift, missing or orphan symlinks, missing wiring lines. Exits 1 on findings.
- `template/` directory holds framework files distributed to consumers (`CLAUDE.md`, `templates/`, `.claude/agents/`, `.claude/skills/`, `scripts/telemetry/`).
- `src/manifest.ts` is the canonical framework-vs-user-content boundary.
- `VERSION` and `CHANGELOG.md` at repo root.
- macOS and Linux supported; Windows is hard-failed at `hstack init` until v2.

### Changed
- Framework files relocated from repo root into `template/`. Consumer-facing layout is unchanged — consumers still see `hstack/CLAUDE.md`, `hstack/templates/`, etc. after install.
- README installation section: `npx hstack init` is now the documented path; manual `cp -r` is the legacy fallback.

### Notes
- 16 Skills, 10 subagents, 25 templates, kernel — first published npm release.
- No local-edit detection: `hstack update` overwrites consumer hand-edits without warning; the diff preview is the only signal. Hash-manifest mode is planned for v0.2.
- No CI for the CLI itself; coverage is manual smoke tests across happy / negative paths plus one real consumer (moso-app).
- No migration scripts: template schema changes between versions need CHANGELOG-driven manual action.
