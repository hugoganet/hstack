# Changelog

All notable changes to hstack are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [Unreleased]

_Nothing yet._

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
