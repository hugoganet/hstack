---
id: ADR-0008-roadmap-replaces-mvp-scope
type: adr
status: accepted
owner: hugoganet
decision-date: 2026-07-29
supersedes: null
superseded-by: null
related-change-specs: []
related-modules: []
promoted-from-kernel-fit: []
created: 2026-07-29
updated: 2026-07-29
schema-version: 2
---

## Title

`roadmap.md` replaces `mvp-scope.md` in the context layer and enters the daily loop: planner, spec-author (ADR authoring), and stack-architect load it at session start, the ADR template gains a "Forecloses / Enables" section, and the plan template gains a one-line "Roadmap Alignment" statement. The roadmap is advisory context with visible staleness — never a gate.

## Status

Accepted on 2026-07-29. Ships as one PR: the `roadmap.md` template (Now / Next / Later / Not on the path, with per-item architectural implications), the removal of `mvp-scope.md`, the reading-list and template updates across kernel, agents, and Skills, and the migration path via `/hstack:configure roadmap`.

## Context

hstack's product-context layer had three altitudes: `product-brief.md` (upstream reasoning), `vision.md` (timeless direction), and `mvp-scope.md` (In MVP / v2 / Deferred). The missing altitude is the trajectory — the medium-term product direction that changes which architecture decision is right today ("Later: multi-user orgs" should stop an engineer from coupling `user_id` everywhere now). ADRs record decisions after the fact; nothing captured the forward-looking forces that should shape them.

`mvp-scope.md` demonstrated the failure mode to avoid. On paper it sat in the reading lists of `data-architect`, `app-architect`, `product-manager`, and `researcher`. In practice it rotted unread, because those atoms run at init and at architecture refreshes — rarely. The daily loop, where architecture decisions are actually made, loaded no product context at all: `planner` read only `tech-stack.md`, `spec-author` read `glossary.md` + `tech-stack.md`, `stack-decide` read `app-architecture.md`, and ADR authoring read nothing product-shaped. Three lessons follow: (1) injection must target the daily loop, not the init atoms; (2) reading-list membership alone is insufficient — the artifact needs a mandatory touchpoint in the *output* or it is read and ignored; (3) staleness must be visible somewhere a loop actually passes, or the artifact rots silently.

Two constraints shaped the design. First, the engineer's explicit requirement that hstack not become a rigid workflow: a roadmap that gates changes ("not on the roadmap → refused") would kill adoption and trust. Second, the Moso architecture direction: product truth will eventually be owned by rhizome (the startup's central brain), with hstack as its engineering consumer — so the artifact must be machine-readable and carry an ownership marker from day one.

## Decision

Replace `mvp-scope.md` with `hstack/context/roadmap.md`: fuzzy horizons **Now / Next / Later / Not on the path** (no dates, no sprint sequencing), where each Now/Next/Later item carries a one-line **architectural implication** — the load-bearing field. During the MVP phase, Now *is* the MVP scope; the artifact survives past MVP where mvp-scope died. Frontmatter carries `source: local | rhizome`: today `local`, edited via `product-manager` refreshed from the brief like its siblings; when rhizome exists, `source: rhizome` means product-manager refuses local edits and points at the sync.

Inject it into the daily loop, passively and actively. Passively: `planner`, `spec-author` (when authoring an ADR), and `stack-architect` add `roadmap.md` to their session-start reading lists; init-time readers (`data-architect`, `app-architect`, `product-manager`, `researcher`) swap their `mvp-scope` reference for `roadmap`. Actively: `templates/adr.md` gains a **"Forecloses / Enables"** section — which Next/Later item does this decision make more expensive (foreclose) or cheaper (enable)? "None" is a valid answer — and `templates/plan.md` gains a one-line **"Roadmap Alignment"** statement written by the planner.

The roadmap is advisory, never enforced. No validator rule blocks a change, plan, or ADR on roadmap grounds. Staleness is surfaced, not enforced: when `roadmap.md` is missing, not at `status: current`, or `updated` more than 90 days old, the planner writes `n/a — roadmap stale/missing (<detail>)` in the Roadmap Alignment line instead of pretending. That visible line is the heartbeat mvp-scope never had.

Migration: `hstack/context/` is user content, so `hstack update` never touches an existing `mvp-scope.md`. `/hstack:configure roadmap` (via `product-manager`) detects `mvp-scope.md` present with `roadmap.md` absent and offers an extract+confirm conversion (In MVP → Now, v2 → Next, Deferred → Later or Not on the path, each item prompted for its architectural implication). `/hstack:help` reports `roadmap` in the canonical context-doc walk, which flags the missing artifact on un-migrated repos.

## Consequences

The medium-term product view now reaches the moments where one-way-door decisions are made, at near-zero ceremony cost: two one-line template sections and a handful of reading-list entries. The "Forecloses / Enables" prompt converts the roadmap from a document agents skim into a question they must answer, which is what mvp-scope lacked. The `source:` field means rhizome integration later is a frontmatter flip plus a sync mechanism, not a redesign.

Two consequences that look bad. First, the per-prompt cost is real: every plan and every ADR now spends tokens loading and answering against a document that is often irrelevant to the change at hand — "None" will be the honest answer most of the time, and an agent under pressure may start writing "None" reflexively, reproducing the read-and-ignore failure in a new place. Second, the architectural-implication field asks product items to carry engineering judgment; written lazily by the engineer alone it degrades into vague fortune-telling ("might need to scale"), which is worse than absence because it launders speculation into load-bearing context. The mitigation for both is measurement, not enforcement: the brain layer should track the Forecloses/Enables fill-rate (non-"None" entries per ADR) and roadmap staleness across consuming repos, and if after a quarter the data shows the artifact is not earning its tokens, it gets killed knowingly — unlike mvp-scope, which died unobserved.

Neutral: the roadmap does not enter `implement` or `adversarial-review`. Alignment is decided at plan/ADR time; execution and review stay roadmap-blind until evidence says otherwise.

## Alternatives Considered

**Add roadmap.md as a fourth artifact alongside mvp-scope.md.** Rejected: four overlapping product docs (brief, vision, mvp-scope, roadmap) is proliferation, and mvp-scope is structurally a roadmap special-case (In MVP == Now during the MVP phase) with a built-in expiry date. Generalizing beats stacking.

**A roadmap-keeper subagent or a roadmap-conformance review lens.** Rejected as the path to the rigidity the engineer explicitly refused: a gate agent turns advisory context into an approval step, and an adversarial-review lens adds per-session cost before there is evidence the plan/ADR touchpoints are insufficient. Revisitable on evidence.

**Dated milestones / sequenced roadmap.** Rejected: dates guarantee staleness within weeks, and hstack has no mechanism (nor should it) to hold product dates truthful. Fuzzy horizons plus a 90-day staleness surface is the honest resolution.

**Enforced alignment via validator rule (e.g., block a plan whose change matches nothing on the roadmap).** Rejected outright: exploration, refactors, and tech-debt work legitimately match nothing on a roadmap. The day a script refuses a change because it is "not on the roadmap", the tool is dead.
