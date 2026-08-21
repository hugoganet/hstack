# Changelog

All notable changes to hstack are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.14.0] - 2026-08-21

The kernel keeps ownership of every rule and gives up the mode d'emploi (ADR-0013). ADR-0012 established that the kernel **owns** each rule; this release fixes what OWNS costs: the statement of authority — what the rule is, why it is load-bearing, what its carve-outs are — plus a pointer to the file that runs it. Not the step-by-step. `KERNEL.md` goes from **8,940 words / 66,213 bytes / ≈ 13.7k tokens to 6,370 / 45,748 / ≈ 9.5k (−28.7%)** — the only body in the corpus with no progressive disclosure at all, loaded at turn zero of every session and again in full inside every one of the 16 subagents. A change that spawns five subagents pays it six times, so the per-change saving is ≈ 25k tokens, not ≈ 4.2k.

This **amends ADR-0012; it does not contradict it.** OWNS / STATES / REFERENCES is unchanged. Nothing ADR-0012 consolidated into the kernel one commit earlier — the 16 reconciled session-start load lists, § Session boundaries, § Halt sentinel — was a candidate.

No rule is deleted. Every passage removed from the kernel is present in its destination file in the same commit, and every rule id that left the kernel is present in the validator registry or at its enforcement point (5 ids: CM-02, GT-01, GT-12, TD-06, TD-07 — all verified).

### Changed

- **§ Tech-debt resolution: 1,067 → 328 words.** The kernel keeps the three terminal exit paths, both reciprocal pairs with their atomicity, the ban on hand-editing the status machine, TD-03 immutability and the ruling that partial resolution is unsupported. The six-step resolution flow, the wontfix two-question interview and the stale one-question interview are `hstack-tech-debt-resolve` / `-wontfix` / `-stale` / `hstack-finalize`'s orchestration steps, already stated there.
- **§ Mechanical operations: 1,600 → 735 words.** Keeps the boundary (*if the Skill knows the value before invoking, the Skill writes; if it comes from a conversation, `spec-author` runs it*), the subagent-vs-orchestrator reading, the `app-architect` stub carve-out, the taxonomy, and the discipline rules. Drops the twelve-bullet enumeration of which Skill writes which field, the worked structured-elicitation examples, the paragraph describing the validator's own capabilities (`--rules` prints it from the registry that enforces it), and the telemetry-sidecar paragraph. The `Atomicity for reciprocal pairs` label is preserved verbatim — `hstack-kernel-fit-promote` cites it by name.
- **§ How hstack improves itself: 649 → 246 words.** Keeps the non-negotiable contract (the human gates promotion; the analyst never authors an ADR) and the named Slack carve-out from the MCP-unreachable stop condition. The five layer descriptions restated the three kernel-fit Skills, `hstack-flag` and `kernel-fit-analyst.md`.
- **§ Cross-session coordination: 535 → 342 words.** Keeps pull-over-committed-state, message immutability, the *committed-and-auditable, not delivered* guarantee, and the whole Boundaries paragraph — it binds subagents. The registry path, `hstack/coord/NAME` resolution, scan invocation, ack cursor, hook wiring and `events.jsonl` are `hstack-coord`'s.
- **§ Frontmatter contract: 487 → 332 words.** Keeps the shared floor, the naming rules, `revisits-change`, and the three no-story carve-outs by name with SP-13 mutual exclusion and the audit query. The per-category prose moves to `spec-author`, which runs the interview.
- **§ Consuming-repo wiring: 215 → 88 words.** The symlink add / remove / rename table had no home outside the kernel, so it lands in `README.md` § Maintenance in the same commit. The kernel keeps the obligation that fires it.
- **§ Test immutability: 719 → 671 words — substantially kept, deliberately.** The arbitration is recorded in ADR-0013: this rule has no validator id (not even a deferred one — it constrains behaviour, not artifacts), its violation is silent and ships, and ADR-0012 thinned it from 17 statements to 2 one commit ago. Only the **Enforcers** map moves, to a one-sentence index; all four duties are stated in full in `implementer.md`, `verifier.md`, `adversarial-reviewer.md` and `test-strategist.md`.
- **Eight smaller compressions:** Product context's document catalogue and promotion-routing paragraph (**the reconciled session-start load lists below them are untouched**), § Status lifecycle's Skill enumeration, § AI writes / humans confirm's restatement of the mechanical contract, § Resumability's harness-behaviour paragraph, § Branch hygiene's three enforcement moments, § Stop conditions' INF-04/INF-05 prose, § What hstack is, § v1 / v2 split.
- **Frontmatter descriptions are untouched.** Zero bytes changed across all 52 files, verified byte-for-byte.

### Added

- **`KERNEL.md` § Reading artifacts (new, ~70 words).** Frontmatter first, then the sections the task needs; a whole-artifact read requires a reason, and the reason is that the task is about the whole artifact. The kernel already required this for a *peer's* committed state and said nothing about the local tree — a transcript audit found 277 reads over 8k characters, 28% of total session text volume, with `spec.md` read end-to-end 41 times where the reader needed `status` and `in-scope`. The rule names its legitimate full-read cases in the same breath (the adversarial-reviewer's audit, code within `in-scope`, a subagent's session-start loads, the print-a-TD-in-full step). Applied at `hstack-help --change`, `hstack-ship` step 1 and `hstack-implement`'s precondition sweep.
- **`README.md` § Maintenance → Adding or removing a Skill or subagent.** The per-symlink obligations, as a table.

### Fixed

- **The Notion "template schemas" doc loses its authority.** The kernel cited it three times, once as a hard gate (*"Read it before any template instance is authored"*). An audit on 2026-08-15 found it pre-dates the Categories work, still carries `mvp-scope` (removed by ADR-0008), and is missing ~9 artifact types the repo ships templates for. v0.12.0's validator registry had already ruled independently — its deferred entries for AR-03 and SP-01..SP-03 say those ids *"exist only in the diverged Notion schema doc, which is not authoritative."* The kernel and the validator disagreed; the validator was right. `hstack/templates/<type>.md` (structure) and `validate-spec.mjs --rules` (mechanized rules + named deferrals) are now explicitly canonical. The gate is deleted, the schema link removed from References, and the architecture doc and adversarial review marked non-authoritative. `spec-author`, `hstack-help` and `README.md` carry the same correction.
- **A sixteenth diverged copy, found by doing this pass.** `spec-author`'s no-story interview is the pre-Categories version — its "(C)" is *"there is actually a user story"*, not `area: bootstrap` — and its SP-09 output expectation omits Category C entirely. `hstack-ship`'s GT-08 has the same gap. Both corrected *before* the kernel's copy was thinned, per ADR-0012's reconciliation-before-deletion rule. ADR-0012's audit did not look at this side of the pair.
- **`hstack-tech-debt-stale` no longer says TD-07 must pass "once the validator ships".** It shipped in 0.12.0.
- **`hstack-version: v0.6.0` removed from the kernel's frontmatter.** Wrong through seven releases, which is the evidence that nothing reads it — no Skill, no subagent, no script, no installer greps for it. The root `VERSION` file is the single source and `hstack update` diffs the tree, not the field. Deleted rather than corrected: a stale version string answers "what version is this?" confidently and wrongly. `authority: kernel` stays.

### Known limitations

- **Second consecutive PR thinning the same corpus, with no measurement between them.** 0.13.0 shipped the same day and has not been exercised in a real change run. If adherence regressed there, this release is layered on an unvalidated one and ADR-0009's instrumentation will attribute the pair, not each half.
- **The kernel is loaded by every subagent, which is why some of its bloat was load-bearing.** A passage moved to a `SKILL.md` is invisible to all 16. Each ledger row carries an explicit subagent check; it found three cases where the passage stayed. It cannot prove it found all of them.
- **The read-discipline rule is evidenced on cost, not on harm.** 277 oversized reads is a token fact; nothing shows any of them produced a worse outcome. Under-reading a spec is silent and produces a plausible wrong answer; over-reading costs tokens and produces a right one. The asymmetry does not favour the rule, which is why it ships with its carve-outs named inline.
- **The target was ~4,500 words and this lands at 6,370.** The gap is the two blocks ADR-0013 declines to touch — § Test immutability (671) and the 16 reconciled session-start load lists (~590) — plus ~600 that would have to come out of § Mechanical operations' carve-outs. Reported as found, not met. If 4,500 is still wanted, the honest route is splitting the kernel (ADR-0013 Option B), not a deeper cut here.

### Consumer action required

- Run `npx hstack@latest update`, then commit. `KERNEL.md`, `README.md` and 6 framework files are overwritten in place. No installer change, no manifest change, no symlink change, no `doctor` finding.

## [0.13.0] - 2026-08-21

Every rule in the corpus has exactly one normative statement (ADR-0012). The kernel **owns** each rule, the single file where the rule can actually be violated **states** it operationally, and every other file **references** it in one line. The 52 `## Anti-patterns` sections are gone, and the duplicated protocol restatements, session-start load lists, session-boundary blocks and telemetry-sidecar paragraphs collapse to their canonical home. No rule is deleted, no gate moves, no status lifecycle changes. Unblocked by 0.12.0: the artifact validator makes every rule with an id executable, so the repeated prose that was compensating for its absence is no longer the enforcement net.

The finding that carried the change: **15 of the 16 session-start load lists had already diverged** between `KERNEL.md` and their agent file, and in two cases each side named a load the other was missing. Those were reconciled into the kernel *before* any copy was deleted.

### Changed

- **`template/KERNEL.md` § Product context — the load lists are reconciled and authoritative.** `security-reviewer` gains the change-spec and the In-Scope diff (the kernel named 5 documents; the agent file named 8). `implementer` gains the tech-debt artifacts named by `resolves-tech-debt` — AR-07 audits the diff against their Acceptance section — and the relevant module-spec, and keeps `infrastructure.md`, which the agent file had dropped; neither list was a superset of the other. Thirteen further entries gain their mode-conditional loads (session-state on resume, extract-mode sources, precedent artifacts, MCP-derived state). "The kernel is loaded by every subagent, always" is now stated once instead of being asserted in 12 of 16 agent files and 5 of 16 kernel entries. `stack-architect` needed no change — the only list of the sixteen whose two copies agreed.
- **`template/KERNEL.md` § Session boundaries (new).** Takes ownership of the cut-notice format, the kickoff-prompt template, the context-block rules and the never-cut-mid-phase rule — a 1,491-byte block that was byte-identical in 7 Skills with no owner anywhere in the corpus. Each Skill keeps its own cut notice and next command.
- **`template/KERNEL.md` § Mechanical operations — Resolution Log appends gains the defensive log-header clause.** Six Skills carried that paragraph inline in four slightly different wordings; they now carry six identical one-line actions.
- **`template/templates/telemetry-sidecar.md` stops describing itself as a document the five Skills restate.** It already declared itself canonical and predicted the copies would disagree. The five emitting Skills keep their own JSON schema block and the executable step-0 call, and reference it for the field rules. Per ADR-0009 the three phase-window fields must read identically in all five, so all five carry the same pointer sentence byte-for-byte.
- **16 subagent bodies: 24,828 → 21,540 words (−13.2%).** Anti-patterns sections removed; session-start lists replaced by a pointer to the reconciled kernel list, keeping only what the kernel does not carry (the ui-ux-briefer's per-source design-system resolution, the data-specialist's MCP access-mode check, the kernel-fit-analyst's detector-blob shape, each file's own halt clause). Test immutability is now stated once, at its enforcement point (`implementer.md`); `verifier`, `adversarial-reviewer` and `test-strategist` keep their own detection duties and point at the kernel for the protocol and the canonical authorization phrases — 17 restatements become 1 statement plus 3 duties. Session-isolation and v1/v2 framing appear once per file instead of 5–6 times.
- **36 `SKILL.md` bodies: 48,690 → 42,914 words (−11.9%).** Anti-patterns sections removed; `finalize`'s TDs-first ordering argued once instead of 5 times; the "never invoke `spec-author`, it costs ~25k tokens" justification returns to the kernel alone; `hstack-implement`'s scope-lock stated twice (the Files-Touched precondition and the subagent invocation) instead of 7 times.
- **Frontmatter descriptions are untouched.** ADR-0011 settled that surface; reopening it here would confound two changes. All 52 files parse, every `name` and `description` is byte-identical to 0.12.0.

### Fixed

- **`hstack-implement` had two orchestration steps numbered 8.** Corrected while editing the section.

### Known limitations

- **The validator's coverage is narrower than the deletion.** It backs artifact-shape rules only. Test immutability, scope-lock, the forbidden-tools enumeration and session isolation have no validator id — the registry names why — so for those the prose is still the only net. This release thins that prose from N statements to one on the argument that N statements were not N nets, and that argument is sound but untested. If adherence regresses, the fix is a mechanism (a hook, a CI check on test-file diffs, a validator extension against git history), not restoring the copies.
- **The reconciliation step is a behaviour change inside a dedup.** Fifteen load lists got a winner picked; two of those changes alter what a subagent actually reads. The PR ledger names every arbitration; prose read by a human is the weakest enforcement the framework has.
- **One duplicate is kept deliberately.** The forbidden-tools enumeration appears in both `hstack-implement` and `implementer.md`. The Skill orchestrator runs in the main session and does not load the agent file, so a pointer there would not resolve, and moving the list to the kernel would grow a 100%-loaded file to shrink one that is not.

### Consumer action required

- Run `npx hstack@latest update`, then commit. All 52 framework files plus `KERNEL.md` and `templates/telemetry-sidecar.md` are overwritten in place. No installer change, no manifest change, no symlink change, no `doctor` finding.

## [0.12.0] - 2026-08-19

`hstack/scripts/validate-spec.mjs` exists. Since ADR-0001 the kernel has said "run `validate-spec.ts` after every write" while the file was a `{{TODO-SCRIPT}}` placeholder referenced from 46 framework files — every one of the ~90 validation rules was prose the model had to remember and self-check, and ADR-0001 named the validator its blocker-priority follow-up. This release ships it: a dependency-free ESM script with a declarative rule registry covering 68 rule ids, plus an explicit deferred list naming the rules that are *not* mechanized and why.

### Added

- **`template/scripts/validate-spec.mjs`** — the artifact validator. Zero dependencies, plain ESM, runs on `node >= 18` with no install, no build step, and no network. `node hstack/scripts/validate-spec.mjs` validates the whole `hstack/` tree; passing paths validates named artifacts; `--json` for machine consumers; `--strict` to fail on warnings; `--rules` to print the registry. Exit 0 clean, 1 findings, 2 usage error.
- **A declarative rule registry, not ad-hoc code.** Every mechanized rule is one `{ id, type, description, check }` entry in `RULES`, and every rule the validator deliberately does *not* mechanize is one `{ id, type, reason }` entry in `DEFERRED_RULES`. The registry is the inventory: `hstack doctor` and the ship-time CI gate can import it rather than re-deriving the rule set. Nothing disappears between "documented in the kernel" and "enforced by a tool" — a rule is either checked or listed with its cause.
- **Coverage.** The shared frontmatter floor (`FM-01`: required fields, id shapes, ISO dates, case-sensitive enums, YAML arrays that are not comma-separated strings); per-type conditional schemas (`TD-05/06/07`, `SR-04/05`, `TS-04/05`, `AD-04`, `KF-04/05`, `V-02..V-05`, `DR-02/03/06`, `ST-02/03`, `FL-01/02`, `CM-01`); reciprocal pairs checked from **both** halves so a one-sided write is caught wherever the validator is pointed (`TD-01`, `TD-04`, `SP-14` `enables`↔`enabled-by`, `AD-02` `supersedes`↔`superseded-by`, `KF-04` `promoted-to`↔`promoted-from-kernel-fit`); and structural section rules (`SP-04` and `MS-03` ≥3 invariants, `AD-03` Nygard sections, `INF-01/02/03`, `PL-02..PL-05` phase-id and Files-Touched consistency, `AR-01/02/05/06/07`).
- **`scripts/test-validate-spec.mjs`** — 105 fixture checks, no runner, following `scripts/test-telemetry-parsers.py`. One complete valid hstack tree is the passing fixture for every rule (it puts each rule in its triggering condition: a `wontfix` tech-debt with both rationale fields, a `promoted` kernel-fit finding with its reciprocal ADR, a `risky` data-review with a filled Migration Safety section). Each failing fixture mutates that tree in exactly one way and asserts the expected rule id fires. The suite ends by cross-checking the registry: a rule with no failing fixture fails the run. `npm test` runs it.

### Changed

- **`.mjs`, not `.ts` — the name changes and all 46 referencing files change with it.** Consuming repos have no `node_modules` for hstack; the framework is copied files. Keeping `validate-spec.ts` would have imposed `node >= 22.6` with `--experimental-strip-types`, or `npx tsx` with its network fetch, on every mechanical write in every consumer. Plain ESM runs on the node that already installed hstack, stays importable from `src/`, and matches the dependency-free precedent set by `scripts/telemetry/` and `scripts/coord/`.
- **`template/KERNEL.md` § Mechanical operations — the "v1 honesty note" is gone** because the thing it was honest about has shipped. The proposed-diff preview stays and is no longer described as "the only mechanical contract check": the preview is the human's consent to a specific diff, the validator is the machine's check that the resulting artifact satisfies its contract, and the anti-pattern list now says that skipping either one leaves a real class of error uncaught. The section also states what the validator does *not* do — no git history, no PR diff, no prose scoring.
- **`{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` replaced with the real invocation in 46 files** (36 `SKILL.md`, 10 agent files) plus the prose mentions in `hstack-flag`, `hstack-finalize`, `hstack-tech-debt-resolve`, `hstack-kernel-fit-triage`, `templates/kernel-fit-flag.md`, and `templates/coord-message.md`. Nothing else in those bodies moves — the deduplication pass is the next change and depends on this one.
- **`src/manifest.ts`** — `scripts/validate-spec.mjs` joins `FRAMEWORK_PATHS`, so `hstack update` ships and refreshes it.

### Known limitations

- **Rules that read git history are named, not implemented.** `TD-03` (no field rewrites on a terminal tech-debt) and `CM-02` (coord-message immutability) are claims about history, invisible to a working-tree validator; diffing every terminal artifact against its state at the resolving commit on every post-write run is disproportionate. `AR-04` (`commit:<hash>` exists on the change's branch) needs a branch the validator cannot infer. All three are in `DEFERRED_RULES` with the reason, and belong to the CI gate that already has the ref range.
- **Judgment stays with the subagents.** Whether a challenge-prompt answer probes for real omissions, whether an adversarial finding is genuine or quota-filler, whether a severity is calibrated — a validator scoring these would be an LLM, and the kernel already has one in the loop.
- **`CG-01..CG-04` cannot be implemented.** `GT-09` names the range; no repo source states what the four cross-reference rules are. Assigning them statements is a kernel change, not a validator change. Same for `SP-01..SP-03`, `SP-07`, `SP-08`, `SP-10..SP-12` and `AR-03`: those ids exist only in the diverged Notion schema doc, and inventing them would be worse than leaving them named and empty.
- **`SP-06` and `SR-01` are inferred.** Repo sources name `SP-05`/`SP-06` jointly ("Scope Boundaries is non-empty"), split here into a frontmatter half and a body half; no source states `SR-01` at all, so it is implemented by analogy with `TS-01`/`PL-01` plus the security-reviewer's Definition of Done. Both carry `inferred: true` in the registry and say so in `--rules` output.
- **Three checks are heuristics and report as warnings, not errors.** `TS-06` (change-spec invariants carry no ids in the template, so count parity against the parent's Invariants bullets is the proxy), `DR-01` (the Schema Changes section is prose; table names are extracted from a "new table" phrase), and `TD-02` (documented as surfacing-only in v1).
- **Merge gates are out of scope by design.** `GT-01..GT-12` read the PR diff and the CI run, not the artifact tree; they belong to `run-gates.sh` / `compute-merge-readiness.ts`, the named immediate follow-up. `GT-08` restates `SP-09` and `GT-12` restates `SP-13`/`SP-14`, and those halves are enforced here.

### Consumer action required

- Run `npx hstack@latest update`, then commit. The validator lands at `hstack/scripts/validate-spec.mjs` and the 46 framework files pick up the real invocation.
- **Expect findings on an established repo.** A read-only run against moso-app (1,571 artifacts) reported **550 errors and 172 warnings**. The clusters are template-vs-practice drift accumulated while nothing was checking: 167 `V-02` (verification `test-results` using `passed` / `not-applicable`, neither in the template's `pass | fail | pending | not-run` enum), 145 `CM-01` (coord-message subjects over the 80-character cap — warnings), 133 `PL-05` (plans predating ADR-0008's Roadmap Alignment section), 48 `FM-01` (a missing `owner`, `cost: low`/`high` against the template's `small | medium | large`), 35 `AD-03` (ADRs predating the schema-version-2 Forecloses / Enables section). Nothing blocks on these today — the validator is a Skill-time and opt-in check, not yet a CI gate. Reading them as a backlog, and deciding per cluster whether the template or the practice is wrong, is the point.

## [0.11.0] - 2026-08-19

A Skill or subagent `description` is a routing trigger, not documentation (ADR-0011). The harness injects every installed description into every session unconditionally — that is the routing index, and hstack was spending **~30k tokens** on it, roughly twice the kernel that ADR-0010 spent a release removing, mostly to inform decisions a typed `/hstack:<skill>` command or a literal `subagent_type` had already made. The 52 descriptions are now one sentence each naming the state that should cause invocation. Nothing else moves: no rule, no gate, no invariant, no halt condition, no status lifecycle.

### Changed

- **All 52 frontmatter descriptions rightsized to a one-sentence routing trigger** under a 40-word / ~250-character budget (36 `SKILL.md`, 16 agent files). Landed at **19,422 → 4,136 words** and **146,184 → 32,150 bytes** across the frontmatter blocks — **≈30.3k → ≈6.7k tokens** at ADR-0011's 4.83 bytes/token calibration, **≈23.6k recovered at turn zero of every session in every consuming repo**, including sessions that invoke no Skill at all. Sequenced as two commits — subagents first (the half where routing is already deterministic; 20 `SKILL.md` files name a literal `subagent_type`), Skills second — so a routing regression is attributable to one half from the git history.
- **All 123 `<example>` / `<commentary>` blocks removed from frontmatter.** Each contained scripted `user:` / `assistant:` turns that pre-wrote the first response before the model had read the actual change-spec. 117 were provable duplicates of a body line in the same file (or of the subagent body the Skill orchestrates); the PR carries the per-block migration table with the proof line for each.
- **Six boundary cases migrated into bodies** rather than deleted, because the body did not already carry them: `product-discovery` (extract mode does not bypass the forcing prompts → Behavior rules); `security-reviewer` (halt when SR-03 requires a threat-model-delta that cannot be produced → Stop conditions; a refactor declaring no security-sensitive surfaces is still reviewed → new `## When to invoke`); `stack-architect` (standalone `--layer` needs an explicit deliberate-swap confirmation → new `## When to invoke`); `test-strategist` (a behaviour-preserving refactor still gets a test-plan → new `## When to invoke`); `hstack-change-plan` (the halt-because-`data-review.md`-is-missing case — the gate was in Preconditions, the remedy pointer was not → a "when not to invoke" sub-list naming the db, ui, and test-plan remedies).
- **`hstack-coord` keeps an expanded description** per ADR-0011's named carve-out: the "ALWAYS invoke `check` mode when the `HSTACK-COORD:` pointer line appears" instruction plus the four-mode list. It is the only Skill that routes with nothing typed, so the description is the only surface that can carry the trigger. Its own three example blocks were still removed.
- **Confusable families keep one distinguishing clause each** — `tech-debt-{new,resolve,wontfix,stale}`, `kernel-fit-{scan,triage,promote}`, `{greenfield,brownfield}-init`, `{change-new,change-plan}`, and `data-architect` vs `data-specialist`. Routing errors live between siblings, and the clause is cheaper than the error.

### Added

- **`.claude/skills/hstack-kernel-fit-scan/references/slack-setup.md`** — the consumer-side Slack wiring (MCP + `chat:write`, the `kernel-fit` config block, the `--no-slack` dry-run) moves out of the Skill body into a reference read on demand. The Skill keeps a pointer that names when *not* to read it. `hstack-kernel-fit-scan` was the one body at or over the 5k-token per-Skill guidance, and truncation keeps the head — the tail was disappearing in silence after compaction. Now 20,742 → 16,594 bytes: ~3.4k tokens at 4.83 bytes/token, ~4.1k at the conservative 4.0 estimator, against ~4.3k / ~5.2k before.

### Consumer action required

- Run `npx hstack@latest update`, then commit. **Zero migration surface**: descriptions and the new reference file live in framework-owned files under `.claude/`, which `update` overwrites, and `wire.ts` symlinks each skill *directory* — so the reference travels with the Skill. No installer change, no manifest change, no symlink change, no `doctor` finding, nothing under `src/`.
- Consumers diverge until they run `update`, the same window ADR-0010 opened. Cross-repo token comparisons are not meaningful inside it.

### Known limitations

- **This is a behavioural change with no test.** Nothing in the repo asserts routing correctness; `doctor` can detect a missing file, not a bad sentence. Verbose descriptions do help when an engineer *describes* a situation instead of typing the command, and ADR-0009's attribution counts only structured markers — which are the typed path. The surface most at risk is the one the instrument cannot see.
- **A `description-budget` `doctor` finding is the correct follow-up** (ADR-0011 Option F) and is deliberately not in this release: a linter for a size no file respected would have flagged 52 findings on day one. The rule is established by the rewrite first, enforced by a tool second.

## [0.10.0] - 2026-08-18

Phase cost becomes measurable (ADR-0009). The five sidecar-emitting Skills now stamp a session id and a phase time-window on their sidecar; the telemetry parser sums the transcript's assistant-turn usage between those bounds; and Skill attribution stops matching free text. "What did this phase cost?" and "what did this change cost?" are answerable from data the harness already writes — no new measurement channel, two timestamps and an id written where a file was already being written.

### Added

- **Phase window on every sidecar — `session_id`, `phase_opened_at`, `phase_closed_at`** (`templates/telemetry-sidecar.md`, `schema_version: 2`, plus the five emitting Skills: `test-plan`, `implement`, `verify`, `adversarial-review`, `finalize`). `phase_opened_at` is stamped the moment preconditions pass, before any subagent invocation; `phase_closed_at` at the terminal state, in the same write that lands the sidecar. Best-effort by contract: an unresolvable session id writes `null` and the phase reports as **unmeasured, never as zero** — a phase whose transcript was swept still spent tokens, and a zero would fold it into the averages as if it were free. The sidecar stays derivative, gitignored, never authoritative, and rides the commit that was happening anyway.
- **`scripts/telemetry/session_id.py`** — the session-id heuristic as shared code instead of prose duplicated per Skill. Prints `session_id`, `transcript_path`, `message_count` and a UTC `now` stamp in one read, so a Skill opening a phase gets both fields from one call. `/hstack:flag` now calls it rather than carrying its own copy of the heuristic (ADR-0005's v1 mechanism is unchanged — it just lives in one file, which is where the v2 harness-exposed session id will land).
- **`parsers/transcripts.py:phase_usage(sidecar)`** — opens the transcript named by `session_id` and sums `input + cache_creation_input + cache_read_input + output` over assistant records whose `timestamp` falls in `[phase_opened_at, phase_closed_at]`. Returns `null` on a missing transcript, a null session id, a v1 sidecar, or an inverted window. Read-only.
- **`parsers/sidecars.py`** — loads `hstack/specs/changes/*/.telemetry/*.json`. A malformed sidecar is skipped, never repaired.
- **TE-4 (cost per phase) and TE-5 (cost per change)** in `insights/token_economics.py`, rendered in the markdown report and the JSON twin. Both print an explicit **coverage fraction** — measured phases over emitted sidecars — because only five of the 27 Skills emit: `change-new`, `change-plan`, `security-review`, `data-review`, `ship` and the whole `configure` family contribute nothing to these sums, and subagent spend still lands in its host's window. Both notes point the reader at QO-4 and WS-2: cost without an outcome beside it can only argue for spending less, never for spending well. A new watch-list line fires when any emitted sidecar is unmeasured, so partial coverage is surfaced rather than inferred.
- **`scripts/test-telemetry-parsers.py`** (dev repo only, not shipped) — fixture tests for the bounded summation, the four null paths, and the structured-marker classifier. The dev repo is not a consumer, so these fixtures are the only place the parsers run against known-answer input.

### Fixed

- **Skill attribution no longer matches prose.** `classify_session` dropped the `/hstack:([a-z…])` regex over message text; it reads only structured markers the harness emits — `<command-name>` tags and `Skill` tool_use blocks — and classifies a session with neither as `(unattributed)`. Measured on 30 days of moso-app transcripts (760 sessions): 104 sessions move out of Skill buckets they never invoked, and the buckets built almost entirely from prose collapse — `tech-debt-new` 37 → 6 sessions, `finalize` 31 → 3, `configure` 27 → 1, `ship` 15 → 2, `tech-debt-stale` 3 → 0. On the hstack dev repo — which discusses these commands constantly and invokes none of them — every bucket goes to zero, including `/hstack:flag`'s phantom 35.5M tokens across 247 turns.
- **Honest correction to ADR-0009's own prediction:** `coord` does **not** shrink. It goes 81 → 92 sessions, because ADR-0007's hook makes the agent genuinely invoke `/hstack:coord` at session start — a real structured marker, not a quoted string. What credits `coord` with half the measured cache-read tokens is the missing end marker, not the regex; that is what TE-4/TE-5 supersede, and TE-1/TE-2 now say so in their notes rather than implying a per-Skill total.

### Changed

- **TE-1 and TE-2 keep their shape and gain a session-scoped note** naming what they can and cannot answer, the unattributed count, and their supersession by TE-4/TE-5 wherever sidecars exist. TE-2's `(non-hstack)` bucket is renamed `(unattributed)` — it now holds hstack sessions with no structured marker as well as plain non-hstack work.
- **JSON twin `schema_version` 1 → 2** (`counts.phase_sidecars`, `te_4_cost_per_phase`, `te_5_cost_per_change`). Additive: every v1 key keeps its shape.
- **`ui/lib/report.ts`** — `TelemetryReport` carries the new blocks as optional so a v1 report on disk still renders; `ui/components/repo-dashboard.tsx` renders TE-4/TE-5 cards with the coverage fraction in the card description, not below the table.
- **`hstack-telemetry` Skill** — the six-bucket summary names TE-4/TE-5, their coverage caveat, and the unmeasured-never-zero rule.

### Consumer action required

- Run `npx hstack@latest update`, then commit. No migration: sidecars written before this release stay at `schema_version: 1`, carry no window, and read as unmeasured — the timestamps they would need were never recorded. Coverage climbs from zero as new phases land.
- If `.telemetry/` is not gitignored in your repo, fix that before the next phase lands: sidecars now carry a local session id, and the discipline that keeps it out of git history is that one line.
- Transcript retention is now load-bearing for history. `cleanupPeriodDays` defaults to 30 days; a repo left at the default cannot recompute phase cost for changes older than a month, and the sidecar keeps pointing at a file that no longer exists (reported as unmeasured, never as zero).

## [0.9.0] - 2026-08-15

The consumer-side kernel is renamed `hstack/CLAUDE.md` → `hstack/KERNEL.md` (ADR-0010). Claude Code was loading it twice: once via the `@hstack/CLAUDE.md` import in the consumer's root `CLAUDE.md` (expanded at launch) and again via nested-`CLAUDE.md` discovery, which keys on the literal filename and injects the whole file on the first read of *any* artifact under `hstack/`. Measured at ~15k tokens in 46% of sessions on a real workload. Discovery cannot see `KERNEL.md`, so the import is now the single load path — the one that survives compaction and that subagents inherit. Filename only: the kernel's authority, content, precedence, and the "everything under `hstack/`" layout rule are unchanged.

### Changed

- **`template/CLAUDE.md` → `template/KERNEL.md`**, and `KERNEL.md` replaces `CLAUDE.md` in `FRAMEWORK_PATHS` (`src/manifest.ts`).
- **`src/lib/wire.ts`** — the appended import line becomes `See @hstack/KERNEL.md.` and the idempotency probe becomes `@hstack/KERNEL.md`, on both the `init` and `update` call sites. The old strings survive as `LEGACY_KERNEL_IMPORT_PROBE` / `LEGACY_KERNEL_PATH_PROBE` for the migration and for `doctor`.
- **~40 path references across 25 files** now point at the new name: the 14 subagent session-start context-load lists, the Skills that name the kernel (notably `hstack-brownfield-init`, `hstack-kernel-fit-scan`, `hstack-greenfield-init`, `hstack-configure`, `hstack-product-discovery`, `hstack-help`), the kernel's own heading and `kernel-fit-analyst` reading list, the telemetry renderer and templates, and `README.md`. The telemetry entry points (`report.py`, `run_kernel_fit.py`) accept either filename when run against an hstack-shaped tree, so an un-migrated repo keeps reporting.

### Added

- **`hstack update` migrates a pre-ADR-0010 install** — `git mv hstack/CLAUDE.md hstack/KERNEL.md` (falling back to a plain rename when the file is untracked) plus a probe-matched rewrite of the import line in the root `CLAUDE.md`. The rewrite is a substring swap of `@hstack/CLAUDE.md` → `@hstack/KERNEL.md`: everything else in that engineer-owned file is preserved verbatim. Both halves are one action so they land in one commit — a repo with the file renamed but the import still pointing at the old path has no kernel in context at all. The migration is planned only when the legacy state is on disk, so re-running `update` is a no-op. A hand-edited import that the probe does not match is **never** rewritten: `update` warns and `doctor` keeps flagging it, mirroring ADR-0007's settings-ownership contract.
- **`hstack doctor` finding `kernel-filename`** (level `error`) — fires when `hstack/CLAUDE.md` is still present (nested discovery still injects a second copy of the kernel) or when the root import still points at `@hstack/CLAUDE.md`, with the one-command fix `npx hstack update`. A root `CLAUDE.md` that mentions `hstack/CLAUDE.md` in a form the migration will not rewrite gets a distinct finding naming the manual fix.
- **New ADR** `adr/ADR-0010-kernel-file-renamed-to-avoid-double-load.md` — the measurements behind both load paths, why `claudeMdExcludes` was tested and rejected (it suppresses both paths rather than deduplicating), and the honest cost: the redundancy being removed was an accidental fail-safe, so a broken import now means an unkerneled session that looks completely normal.

### Consumer action required

- Run `npx hstack@latest update`, then commit. The rename, the import-line rewrite, and the framework sync land in that single commit. Verify with `npx hstack doctor` — a clean run means no `kernel-filename` finding.
- If `update` warns that it left your `CLAUDE.md` untouched, the import line was hand-edited: point it at `@hstack/KERNEL.md` yourself. `doctor` flags it until you do.

## [0.8.0] - 2026-07-29

`roadmap.md` replaces `mvp-scope.md` and enters the daily loop (ADR-0008): the medium-term product trajectory now reaches the moments where one-way-door architecture decisions are made — planning, ADR authoring, stack decisions — as advisory context with visible staleness, never a gate.

### Added

- **`templates/roadmap.md`** — fuzzy horizons Now / Next / Later / Not on the path, each item carrying a one-line **architectural implication** (proposed by `app-architect` / `data-architect` for their halves, confirmed by the engineer). No dates. During the MVP phase, Now IS the MVP scope — the artifact survives past MVP where mvp-scope died. Frontmatter `source: local | rhizome` marks who owns the truth (anticipating rhizome as the external product brain); `reviewed-on` feeds the 90-day staleness threshold.
- **`Forecloses / Enables` section on `templates/adr.md`** — which roadmap Next/Later item does this decision make more expensive or cheaper? "None" is a valid answer; a missing or stale roadmap reads `n/a — roadmap stale/missing`. Advisory — no validator rule blocks an ADR on roadmap grounds.
- **`Roadmap Alignment` section on `templates/plan.md`** — one honest line written by the `planner`; stale/missing roadmap yields `n/a — roadmap stale/missing (<detail>)` instead of pretending. This visible line is the staleness heartbeat mvp-scope never had.
- **Daily-loop reading-list entries** — `planner`, `spec-author` (when authoring an ADR), and `stack-architect` load `roadmap.md` at session start. Explicit carve-out from the kernel's missing-context halt rule: a stale or absent roadmap is surfaced in the output line, never a halt.
- **Brain signal "Roadmap earning its place"** (`brain/ANALYSIS.md`) — Forecloses/Enables fill-rate, `n/a` alignment lines, and per-repo roadmap staleness. If a quarter of data shows the artifact not earning its tokens, the recommendation is to kill or reshape it knowingly — unlike mvp-scope, which died unobserved.
- **New ADR** `adr/ADR-0008-roadmap-replaces-mvp-scope.md` — the autopsy of mvp-scope (in the reading lists of init-time atoms only; the daily loop loaded no product context; nothing ever surfaced its staleness) and the three design lessons baked into the replacement.

### Changed

- **Kernel § Product context** — `mvp-scope.md` entry replaced by `roadmap.md`; load-at-session-start rules updated for `product-manager`, `data-architect`, `app-architect`, `stack-architect`, `spec-author`, `planner`.
- **All `mvp-scope` references** (~30 across kernel, 8 subagents, 12 Skills, README) now point at `roadmap` — including `product-manager`'s story-drift check, which now flags stories drifting outside the **Now** horizon.
- **`product-manager`** — owns `roadmap.md` when `source: local`; refuses local edits when `source: rhizome`. Product lines are the engineer's; architectural-implication lines are proposed by the architect agents, never invented ("empty is better than vague").

### Removed

- **`templates/mvp-scope.md`** — superseded by `templates/roadmap.md`. `hstack update` removes the framework copy in consuming repos; the user-content `hstack/context/mvp-scope.md` is never touched by the installer (see migration below).

### Consumer action required

- Run `npx hstack@latest update` to receive the new template, kernel, agent, and Skill updates (this also removes the now-orphan `hstack/templates/mvp-scope.md`).
- Then run `/hstack:configure roadmap` — when a legacy `hstack/context/mvp-scope.md` exists with no `roadmap.md`, `product-manager` offers an extract+confirm conversion (In MVP → Now, v2 → Next, Deferred → Later or Not on the path) and prompts deletion of the legacy file once the roadmap lands at `current`.

## [0.7.1] - 2026-07-25

### Fixed

- **Coord scan cost ~6 s per prompt — now ~50 ms when nothing changed (~120× on real repos).** First-day telemetry from `events.jsonl` (190 hook runs across 4 worktrees) showed the hook's branch walk costing median 5.9 s / p90 8.2 s per prompt — the ADR-0006 "sub-second" assumption was off by 10× on branch-heavy repos, and this ran on *every* prompt. This is the "cache keyed on ref state" mitigation ADR-0007 named. `coord_scan.py` now keeps a per-worktree cache at `hstack/.session-state/coord-scan-cache.json` keyed on a fingerprint of every source repo's local refs (plus identity, branch, horizon, and the current date, bounding cache life at one day). Messages only appear via commits and commits only move refs, so an unchanged fingerprint proves the walk would return the same set — the cache changes how fast, never what surfaces. Acks filter after collection and never invalidate; a corrupt or stale cache fails open to the full walk; deleting the file costs one re-walk. `scan`/`hook` telemetry events now carry `"cache": "hit"|"miss"` to keep the improvement measurable.

## [0.7.0] - 2026-07-24

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
