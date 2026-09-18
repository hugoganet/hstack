---
id: ADR-0016-the-linter-enforces-the-doc-judges
type: adr
status: accepted
owner: hugoganet
decision-date: 2026-09-18
supersedes: null
superseded-by: null
related-change-specs: []
related-modules: []
promoted-from-kernel-fit: []
created: 2026-09-18
updated: 2026-09-18
schema-version: 2
---

## Title

Code quality gets two halves with a hard line between them. Everything a linter can measure — function size, nesting, parameter count, `any`, unread errors, console, `process.env` — is a lint rule at `error`, frozen once into a suppressions file so only new violations fail. Everything that needs judgment — a second implementation of an existing thing, a component talking to the network, a legacy path left wired — is one living doc, `code-standards.md`, read before writing and re-read against the diff by `/hstack-wrap`. The adversarial reviewer's code-quality lens becomes that file, and stops calling lint-shaped findings filler.

## Status

Accepted on 2026-09-18, ships as v0.18.0. It adds to the light version (ADR-0015) without adding per-change ceremony: the lint runs where lint already ran, the doc is read where `tech-stack.md` already was, and the wrap step is one more question inside a Skill that already fires once per change.

## Context

The first consumer, moso-app, was audited on 2026-09-18 after Hugo said he was no longer satisfied with the code agents produced under hstack. The audit measured 6,163 production functions: 170 over 200 lines, 25 over 500, one React component of 2,825 lines holding 39 hook calls. It found the same vendor client written three times with the copies drifted — one retries on a 429, one does not — `sleep` defined seven times, a hand-rolled SSE parser four times, three agent stacks each with its own tool loop and cost tracker, all reachable from live routes. It found ~50 files nothing imports, 520 unused exports, 631 `as any`, and 64 server-side Supabase writes whose returned `error` nothing reads — one of them answered with `{ ok: true }`.

Two facts about that repo decide the shape of the fix.

First, **prose alone did not hold.** The repo's `CLAUDE.md` had said *"If it's not imported, delete it"* and *"One library per job"* for months; both were ignored at scale. The reviewer's own rubric made it worse: `finding-categories.md` § code-quality listed *"anything a formatter or a linter would have said"* under filler, so a reviewer who noticed a 400-line function was told not to file it.

Second, **the one mechanical rule held.** moso-app carries a custom ESLint rule that forbids instantiating an LLM client outside its factory. It is one of two rules in the config at `error` — everything else, including `no-explicit-any` and `no-floating-promises`, is at `warn`. The factory rule was respected everywhere; the warnings were not read. An agent that sees four hundred yellow lines learns to scroll; an agent that sees one red line fixes it.

The guide Hugo brought — *clean-code-typescript* — is sound on the timeless rules and dated on the rest (class-heavy, getters and setters, method chaining, TSLint). Loading its 25,000 words into every session would cost more than the kernel and change nothing the agent did not already know. What was missing was not knowledge; it was a rule that bites and a place the judgment rules live.

## Decision

**Two halves, one line between them.**

The **mechanical half** is `template/templates/eslint-clean-code.mjs`, a flat-config the consumer imports rather than copies, so `hstack update` can move it. Every rule is at `error`. Thresholds are options, not edits. It carries one custom rule, `hstack/supabase-unread-error`, because the audit's most damaging pattern — a `{ data, error }` result with `error` never read — is invisible to a human reviewer and to every stock rule. The ratchet is ESLint's own: `--suppress-all` once, commit the file, and from then on the count only goes down.

The **judgment half** is `hstack/context/code-standards.md`, from a new template, ten rules, each with a `Seen here` line the consumer fills from its own codebase. It repeats nothing the linter fails on. It is named in the kernel's living-doc list with a read trigger — *application code → code-standards* — and `/hstack-wrap` gets a step that reads the diff against it, rule by rule, and fixes what it finds before the reviews run.

The **reviewer** changes accordingly: the code-quality lens *is* the file, a finding names the rule it breaks, and the filler clause is rewritten so it excludes what the linter already caught only when the linter is wired.

The **kernel** gains three sentences: the fast lane runs locally and is green before the push, CI being the backstop; lint is at `error` with a ratchet and a `warn` is not a rule; wrap reads the diff against the standards. This is the "twice" the kernel asks for — the audit counted it in hundreds.

## Alternatives considered

- **Ship the guide as a Skill or a rules file.** Rejected: 25,000 words a session for rules the model already knows, a third of them class-oriented advice that would push a functional React codebase the wrong way.
- **Prose only — a standards doc, no lint change.** Rejected on the moso-app evidence: the same repo already had the prose and ignored it.
- **Lint at `warn` for a month, then `error`.** Rejected by Hugo: the yellow phase is the phase nobody reads, and the ratchet makes `error` safe on day one.
- **A `PostToolUse` hook that lints every edit.** Rejected: it reverses ADR-0015's removal of the hook wiring, and the local fast lane inside `/hstack-wrap` covers the same need once per change instead of once per keystroke.
- **Put the standards in the kernel.** Rejected: ~600 words on every turn, for rules that matter at write time and at wrap time. The living-doc slot with a read trigger costs one line.

## Consequences

- A consumer wires three things once: the import in `eslint.config.mjs`, the suppressions file, and `code-standards.md` with its `Seen here` lines. moso-app does this after its dead-code cleanup lands.
- `lint` goes red on new violations of size, nesting, `any`, unread Supabase errors, console and `process.env`. The agent fixes them locally, before the commit, because `/hstack-wrap` says so and the kernel forbids suppressing to get past.
- The reviewer files code-quality findings by rule number. A finding it cannot number is not a finding.
- The `Seen here` lines make the doc a record: when a rule has no example yet, the first PR that violates it writes one.
- What this does not do: it does not clean up what is already there. The ratchet freezes the existing debt; paying it down is the work of touching those files, one PR at a time.
