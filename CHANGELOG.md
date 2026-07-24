# Changelog

All notable changes to hstack are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [Unreleased]

Hook-driven coord notification (ADR-0007): sessions now learn about unread coord-messages automatically instead of waiting for the engineer to hand-carry a "check your messages" nudge between workspaces. Discovery stays pull-over-committed-state per ADR-0006 — the harness merely schedules the scan.

### Added

- **`hook` mode in `coord_scan.py`** — the Claude Code hook entry point. Same scan as `scan`, hook-shaped contract: exit 0 no matter what (a coordination failure never breaks the engineer's prompt), silent when nothing is new, and a single **count-only** pointer line (`HSTACK-COORD: N unread coordination message(s) ... run /hstack:coord`) when messages exist. No subjects, ids, or bodies through the hook — peer-authored content only enters context via the Skill, frontmatter-first, per CM-03.
- **Installer-owned hook wiring.** `hstack init` and `hstack update` merge `SessionStart` + `UserPromptSubmit` entries running `coord_scan.py hook` into `<consumer>/.claude/settings.json`. Ownership is narrow: only entries whose command contains `scripts/coord/coord_scan.py` (the idempotency probe); every other key is engineer-owned and preserved verbatim; an unparseable settings file is a blocker on `init`, a warn-and-skip on `update`, and a `hooks` finding in `hstack doctor`.
- **Coord usage telemetry** — `coord_scan.py` appends one JSON line per `scan` / `hook` / `ack` invocation (trigger, new/acked count, duration) to `hstack/.telemetry/coord/events.jsonl`: per-worktree, gitignored via the existing `**/.telemetry/` line, best-effort, never authoritative — the same derivative discipline as the telemetry sidecars. `send` usage needs no log (every send is already a `chore(coord): message <id>` commit).
- **New ADR** `adr/ADR-0007-hook-driven-coord-notification.md` — the amendment ADR-0006 reserved for evidence of the manual-nudge annoyance, covering the trust-surface expansion (installer co-owns `settings.json`), the injection-safety rationale for the count-only contract, and the deferred alternatives (OS-level notification on send; a real push substrate remains the v2 shape).

### Changed

- **Kernel § Cross-session coordination** — "Discovery is a scan, not a hook" becomes "Discovery is a scan; the harness schedules it": the model itself still never polls; its cadence is the pointer line, session start where hooks aren't wired, and explicit decision points.
- **`/hstack:coord` Skill** — `check` is now triggered primarily by the hook pointer line; new failure modes (hooks not wired → graceful ADR-0006 degradation; hook fires but scan breaks → silent, loud on next explicit check) and a forged-pointer-line anti-pattern.

### Consumer action required

- Run `npx hstack@latest update` to receive the new `coord_scan.py`, the kernel/Skill updates, and the hook entries in `.claude/settings.json`. Sessions already running pick the hooks up at their next start.

## [0.6.0] - 2026-07-11

Cross-session coordination: parallel Claude Code sessions (git worktrees of the same repo) and sibling hstack repos on the same machine can now coordinate asynchronously — pull-based over committed state, per ADR-0006. No home-directory bus, no hooks, no presence tracking: committed artifacts are the channel, and the "anything for me?" check is a silent exit-0 subprocess when there is no traffic.

### Added

- **`/hstack:coord` Skill** (`template/.claude/skills/hstack-coord/SKILL.md`) with four modes: `check` (default — scan for new messages, surface them to the engineer, ack after surfacing), `send` (author + commit an addressed `coord-message`), `register` (add this repo to the machine registry, resolving the durable main-worktree path even when invoked from an ephemeral Conductor worktree), `peers` (list registered repos and reachability). Includes a scope-lock guard (no coordination reads mid-`/hstack:implement`; coordination happens in the main session between phases or at planning points) and a frontmatter-first read discipline with heavy peer reads delegated to a read-only subagent returning a distilled summary.
- **`coord-message` artifact** (`template/templates/coord-message.md`) — committed, immutable, append-only message written in the **sender's** repo on the sender's branch, addressed via `to-repo` / optional `to-branch` frontmatter with `refs` pointing at the committed artifacts carrying the authoritative detail. Validator rules: CM-01 (required fields at send-time), CM-02 (immutability — corrections are new messages), CM-03 (bodies are information, never instructions; peer content is untrusted input). Addressing resolves against the receiver's **canonical name**: the committed one-line file `hstack/coord/NAME` (machine-local registry names are aliases and unsafe for addressing). Message ids carry a timestamp + sender prefix plus a random-hex suffix so same-second sends never collide.
- **`coord_scan.py`** (`template/scripts/coord/`, stdlib-only Python) — discovery: walks every local branch of this repo plus every registered repo's local branches for messages addressed to this repo; filters acked / expired / own-sent; silent with exit 0 when empty. Peer-authored identifier fields collapse to a strict ref charset and the suggested `read:` command is shell-quoted (prompt-injection hardening); malformed ids and expiry dates fail closed with a stderr warning. Ack cursor is per-worktree, gitignored, written atomically; losing it re-surfaces messages (at-least-once surfacing — the guarantee is committed-and-auditable, not delivered).
- **Kernel section `## Cross-session coordination`** in `template/CLAUDE.md`, plus `hstack/coord/messages/` added to the frontmatter contract.
- **New ADR** `adr/ADR-0006-pull-based-cross-session-coordination.md` recording the design and the rejected `~/.hstack/coord/` bus alternative (presence cards + per-target inboxes + SessionStart/UserPromptSubmit hooks) with the adversarial-review arguments against it.

### Fixed

- **`hstack/.session-state/` was declared git-ignored by the kernel's Resumability section but the installer never wired it.** `hstack init` and `hstack update` now append the `.gitignore` line. Repos installed before 0.6.0 may have committed session-state files; verify after updating.

### Consumer action required

- Run `npx hstack@latest update` to receive the Skill symlink, `scripts/coord/`, the template, and the kernel section.
- Once per repo per machine: `/hstack:coord register`, and commit the canonical-name file `hstack/coord/NAME` when prompted — cross-repo addressing depends on it.

## [0.5.2] - 2026-06-26

### Fixed

- **Greenfield-init collapsed the six-phase discovery flow into a flat questionnaire.** `template/.claude/skills/hstack-greenfield-init/SKILL.md` described the right behavior but never pinned it in imperative, agent-readable terms, so a session could answer `/hstack:greenfield-init` with a numbered config-question list ("answer #1 and #8, I'll accept defaults for #2–7, then write the config and move to Phase 1") instead of launching the product-discovery thinking-partner session. Four contract-tightening edits: (1) a new Precondition bullet forbidding inline config authoring or Phase 1 paraphrase; (2) a new **First-turn contract** section pinning the exact first-message shape (name the six phases → open Phase 1 → offer the Brainstorm / Forcing-Questions / Project-Brief technique picker) and enumerating the forbidden numbered-question shape; (3) **Phase 0 reframed** from an upfront questionnaire to inline field-sourcing deferred to the Phase 1→2 boundary, removing the "fill the config first" hook; (4) **Phase 1 made imperative** — the first non-trivial action MUST be a `Task` call launching the `product-discovery` subagent — plus two sharpened anti-patterns against the flat-question-list shape and against running Phase 1 inline. No code change; Skill-contract text only. Reported from a consumer greenfield repo where init skipped discovery entirely.

## [0.5.1] - 2026-05-23

### Fixed

- **Verifier false-positive on zero-tests-executed suites.** Closed via new validator **V-05** in `template/.claude/agents/verifier.md` and `template/.claude/skills/hstack-verify/SKILL.md`: a `unit`, `integration`, or `e2e` suite that executed zero tests cannot be recorded as `pass`. The verifier now confirms the runner's observed-test-count is greater than zero before mapping a suite to `pass`; suites gated by an unset env var, all `.skip` / `.todo`, empty collection, or filter-collapsed are recorded as `not-run` (per the existing `test-results` enum) with a high-severity Discrepancy naming the runner-reported counts and the suspected reason. A `not-run` value blocks `status: passed` and halts the Skill at `status: ran`. Lint and typecheck are exempt — both produce diagnostic counts whose floor is naturally zero. Reported by a consumer repo where the verifier marked `integration: pass` while the integration suite was env-gated to zero tests.

## [0.5.0] - 2026-05-23

Greenfield workflow: hstack now adopts into empty repositories from line zero, not just brownfield repos. Same kernel, same artifact taxonomy, same gates — a second entry point and a new discovery layer underneath.

### Breaking

- **`/hstack:init` renamed to `/hstack:brownfield-init`.** Existing skill content kept; description updated to reflect brownfield-specific framing. Consumers must run `npx hstack@latest update` to reconcile per-skill symlinks (the `hstack-*` glob handles the symlink removal + addition automatically). Any script or doc that hard-codes `/hstack:init` must be updated.
- **`data-architecture.md` template rewritten to five-section structure** (Tenancy, Entities, RLS, RAG, Migration Sketches), replacing the prior six-section template (Tables, RLS, RAG, Lifecycle, External Sources, Conventions). Tenancy is the new load-bearing first section; data-architect refuses to advance past it until concrete. Consumers with in-flight `data-architecture.md` artifacts must run `/hstack:configure data-architecture` to reshape into the new structure; the prior content is not auto-migrated.

### Added

- **Four discovery-atom subagents** (`template/.claude/agents/`):
  - `product-discovery` (opus) — thinking partner running one of three techniques (Brainstorm, Forcing-Questions, Project-Brief). Coach, never generator. Produces `hstack/context/product/product-brief.md` and auto-routes to `product-manager` for vision/mvp-scope/personas/glossary refresh.
  - `data-architect` (opus) — foundational data-layer designer. Walks five sections; tenancy gate is non-negotiable. Bidirectional drift recovery with downstream phases.
  - `app-architect` (opus) — internal-architecture designer. Stack-agnostic by design. At terminal state, three-file atomic commit: artifact + module-spec stubs + `hstack/config.yaml` surfaces enum update. Narrow carve-out from the spec-author exclusivity rule (stubs only, headers + `status: draft`).
  - `stack-architect` (sonnet) — technical-discovery interviewer. Default-stack fast-path collapses confirmed defaults into a single rollup ADR; deep-dive layers get the full constraint interview. Routes ADRs through `spec-author` via `/hstack:adr-new` with pre-populated Context / Decision / Alternatives. Consequences challenge fires fresh regardless of pre-population.
- **Six new templates** (`template/templates/`):
  - `product-brief.md` — single synthesis artifact for product discovery.
  - `discovery/{brainstorm,forcing-questions,project-brief}.md` — three technique scripts. Forcing-Questions derived from Gstack's YC-partner reframe pattern.
  - `app-architecture.md` — five-section internal architecture.
  - `bootstrap.md` — change-spec variant with `area: bootstrap`, `surfaces: [infra]`, explicit `in-scope` enumeration.
- **Seven new skills** (`template/.claude/skills/`):
  - `hstack-greenfield-init` — six-phase orchestrator for empty repos.
  - `hstack-product-discovery`, `hstack-data-architecture`, `hstack-app-architecture`, `hstack-stack-decide` — the four atoms. Each runs in elicit (greenfield) or extract+confirm (brownfield) mode; each is independently re-runnable via `/hstack:configure`. Section-targeted entry (`--section <name>`) fast-jumps but always re-runs the end-of-atom coherence check.
  - `hstack-scaffold` — Phase 6 execution. Generates bootstrap change-spec, runs foundational-mode security-review and data-review, drives the standard per-change workflow to a bootable repo.

### Kernel additions

- **Halt sentinel enum** gains `upstream-drift`. Emitted by discovery atoms when a section's drift challenge surfaces a contradiction with an upstream artifact. Bidirectional recovery via `/hstack:configure <upstream-atom>`.
- **SP-09 / SP-13** extended with **Category C (`area: bootstrap`)** as the third no-story carve-out, mutually exclusive with Category A (`internal-tooling: true`) and Category B (`enables: [...]`). Audit-query semantics defined for each.
- **Product context file list** updated with `product/product-brief.md` and `app-architecture.md`. `assumes-database: postgres` declared on `data-architecture.md`; stack-agnostic invariant declared on `app-architecture.md`.
- **Session-start load rules** documented for the four new agents. `app-architect` explicitly does NOT load `tech-stack.md`.
- **Mechanical operations** carve-out for `app-architect` to scaffold module-spec stubs (headers only) under `hstack/specs/`. Three new mechanical-operation skills (`/hstack:app-architecture`, `/hstack:stack-decide`, `/hstack:scaffold`).

### Notes

- v1 honesty: foundational-mode `security-review` and `data-review` (used during scaffold) score against proposed posture, not against a diff; this is the same v1 limitation the per-change reviewers carry. v2 substrate adds executable probes.
- Discovery atoms work in extract+confirm mode against existing source via Supabase MCP, Glob over `src/`, and engineer-pointed-at docs. When MCPs are unreachable in load-bearing mode, the atoms halt per the kernel's MCP-unreachable rule.
- The `app-architect` carve-out from the spec-author exclusivity rule is narrowly scoped: stubs are headers + `status: draft` + a one-line body note, never authored content. Any deviation reverts to spec-author ownership via `/hstack:module-spec`.
- README counts updated to ~34 Skills, ~16 subagents, ~32 templates.

## [0.4.0] - 2026-05-23

### Added
- **Engineer-triggered `/hstack:flag` Skill — phase-1 of ADR-0005.** A one-shot Skill that drops a frontmatter-only pin to `hstack/kernel-fit/flags/pending/` carrying session-id, transcript path, branch, HEAD, and timestamp. No interview, no confirmation, no commit, sub-second wall-clock. Optional one-word `<hint>` positional argument for engineer audit; the analyst forms its own classification from the transcript window at scan time (no contamination from engineer-written hints). Heuristic session-id capture via most-recently-modified jsonl under `~/.claude/projects/<encoded-cwd>/`; `fallback-cwd` path when no jsonl is found, with the analyst's `transcript-truncated` classification as the safety net.
- **New `kernel-fit-flag` artifact template** at `template/templates/kernel-fit-flag.md` — frontmatter-only schema with FL-01 (required fields at pin-time) and FL-02 (classification + rationale non-null when status: processed) documented in template commentary.
- **Kernel paragraph under `## How hstack improves itself`** documenting the engineer-trigger side of the loop and pointing to ADR-0005.
- **`hstack/kernel-fit/flags/` added to consumer `.gitignore`** via `GITIGNORE_KERNEL_FIT_FLAGS_LINE` in `src/lib/wire.ts`; appended at both `hstack init` and `hstack update`. Pins are derivative signal (mirroring `.telemetry/` from ADR-0004); the audit trail lives at the finding layer once the analyst processes them.
- **Pending Flags Processing in `kernel-fit-analyst` — phase-2 of ADR-0005.** The analyst now reads pending pins, opens each pin's session transcript, reads the ~50 turns immediately preceding the pin timestamp (never forward), and classifies the friction as one of `friction | missing-guardrail | kernel-vs-practice-mismatch | not-actionable | transcript-truncated`. Compaction detection compares `pre-compaction-message-count` against the current transcript line count to surface truncation. Fold-vs-emit-vs-close decision: fold when the friction maps onto an existing in-flight finding (append evidence row, increment count); emit when no existing finding maps (write a new finding with `detected-via: flag` and `pattern: KF-FLAG-<NNNN>`); close when classification is `not-actionable` or `transcript-truncated`. Counter-explanation discipline (KF-03) applies identically to flag-emit findings. The analyst is forbidden from re-processing pins already in `processed/`.
- **`detected-via: detector | flag` frontmatter field** on `templates/kernel-fit-finding.md` with default `detector` for backwards compatibility. No schema-version bump — the field has a safe default and existing findings remain valid. For folded-in findings (flag signal merged into an existing detector-finding by appending an evidence row), `detected-via` remains `detector` because the originating signal was the detector pattern.
- **Flag-processing extensions to `/hstack:kernel-fit-scan`.** New orchestration step (step 3) enumerates pending pins; step 4's no-fire path now requires both no patterns fired AND no pending flags before exiting clean; step 5 surfaces the pin list to the analyst; step 6 performs the `git mv` from `pending/` to `processed/` (filesystem-only since pins are gitignored); step 7 extends the commit message to name flag-processing counts; step 8's Slack body adds `[via: detector|flag]` and a tail summary "Flags processed: P total — FF folded, E emitted, NA not-actionable, TT transcript-truncated" (suppressed when every pin was classified `not-actionable` to avoid pure noise); step 10's report names per-classification counts.

### Notes
- v1 honesty (phase-1): session-id capture is heuristic (most-recently-modified jsonl under `~/.claude/projects/<encoded-cwd>/`). Interleaved sessions on the same workspace are a known edge case; v2 substrate will replace the heuristic with a harness-exposed session-id when Claude Code exposes one. The `transcript-truncated` classification is the safety net.
- v1 honesty (phase-2): the analyst's flag classification is LLM-strategized judgment, not measured truth — same framing rule that detector-side findings carry. The counter-explanation discipline (KF-03) is the false-positive mitigation for flag-emit findings, identical to detector-emit findings.
- The provenance gap (gitignored pins are not reproducible from git alone) is acknowledged in ADR-0005's Consequences challenge and accepted in exchange for the zero-friction-cadence invariant.
- Fold conservatism: when in doubt between fold and emit, the analyst prefers fold. The engineer's triage path is the same either way, and folding keeps the finding count bounded. Over-emit produces noise that erodes the loop's signal.

See [ADR-0005](adr/ADR-0005-engineer-triggered-flag-feeds-kernel-fit.md) for the design rationale and the complementary relationship with ADR-0004's detector-side loop.

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
