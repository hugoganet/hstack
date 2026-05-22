# Changelog

All notable changes to hstack are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added
- npm package scaffolding (`package.json`, `tsconfig.json`, `src/cli.ts`).
- `template/` directory now holds framework files shipped to consumers (`CLAUDE.md`, `templates/`, `.claude/`, `scripts/telemetry/`).
- `VERSION` and `CHANGELOG.md` at repo root.

### Changed
- Framework files relocated from repo root into `template/`. Consumer-facing layout is unchanged — consumers still see `hstack/CLAUDE.md`, `hstack/templates/`, etc. after install.

## [0.1.0] - 2026-05-22

Initial pre-release. Vendored / symlinked distribution only; npm CLI in progress.

- 16 Skills, 10 subagents, 25 templates, kernel.
- See repo history prior to this changelog for detail.
