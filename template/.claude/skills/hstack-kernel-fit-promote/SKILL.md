---
name: hstack-kernel-fit-promote
description: |
  Use this skill when the engineer has decided that an `acknowledged` (or `open`) kernel-fit finding warrants a kernel change captured as an ADR. The Skill seeds the finding's Evidence + Kernel surface + Proposed direction into an ADR Context section and routes through `/hstack:adr-new --from-kernel-fit <id> --slug <slug>`, where `spec-author` runs the normal Nygard interview — the human gate the kernel's "AI writes, humans confirm" contract requires at the kernel-modification layer. After the ADR lands, the Skill writes the reciprocal `promoted-to` back-reference on the finding and flips it to `status: promoted`. Two commits in v1 — the ADR commit (from `adr-new`) and the back-reference commit (from this Skill); see Failure modes for the recoverable-two-commit carve-out (analogous to the `/hstack:finalize` in-progress carve-out). Examples:

  <example>
  Context: The engineer reviewed KF-0001 (KF-P1, Category-A claim spans production paths), acknowledged it via triage last week, and now wants to land an ADR tightening the SP-13 guidance.
  user: "/hstack:kernel-fit-promote KF-0001 --slug sp-13-prose-guidance-tightening"
  assistant: "I'll read KF-0001, verify status (open or acknowledged), construct the ADR Context seed from Evidence + Kernel surface + Proposed direction, and invoke `/hstack:adr-new --from-kernel-fit KF-0001 --slug sp-13-prose-guidance-tightening`. spec-author runs the Nygard interview — Title, Status, Context (seeded), Decision, Consequences (with the challenge prompt), Alternatives Considered. After the ADR lands at terminal status, I'll write `promoted-to: adr:ADR-NNNN-...` on KF-0001, flip status to `promoted`, append a Triage Log entry, and commit. The ADR commit and the back-reference commit are separate — see Failure modes for the recoverable carve-out."
  <commentary>
  The promote Skill is the only path that elevates a kernel-fit finding to an ADR. The kernel's "AI writes, humans confirm" contract is preserved because `/hstack:adr-new`'s spec-author interview is the human gate; the engineer reviews and confirms every Nygard section before the ADR lands. The promote Skill itself performs no field-level interview — it is a mechanical wrapper plus a reciprocal back-reference write per ADR-0001.
  </commentary>
  </example>

  <example>
  Context: The engineer wants to route a finding to tech-debt instead of an ADR — the kernel surface is not yet ready for revision but the team wants to track the gap.
  user: "/hstack:kernel-fit-promote KF-0004 --target tech-debt --slug halt-enum-missing-figma-mcp-case"
  assistant: "I'll route through `/hstack:tech-debt-new --from-kernel-fit KF-0004 --slug halt-enum-missing-figma-mcp-case`. spec-author runs the six-section TD interview (Title, Why we took the shortcut, What it costs us, Fix sketch, Pre-conditions, Acceptance). After the TD lands, I'll write `promoted-to: tech-debt:TD-NNNN-...` on KF-0004 and flip status to `promoted`."
  <commentary>
  The `--target tech-debt` flag is the secondary promotion path — useful when the engineer recognizes the kernel-fit gap but does not yet have a defensible Decision section for an ADR. Tech-debt captures "we know about this; here's what fixing it would look like; here's what's blocking us from fixing it now." Same reciprocal write contract as the ADR path.
  </commentary>
  </example>

  <example>
  Context: A scan-Skill run between `/hstack:kernel-fit-promote` invocations has superseded the finding the engineer is now trying to promote.
  user: "/hstack:kernel-fit-promote KF-0001 --slug internal-tooling-split"
  assistant: "I'll halt — KF-0001 is at `status: superseded` (`superseded-by: KF-0007`). Promote KF-0007 instead; its body restates the same pattern with newer evidence. The promote Skill never promotes a superseded finding because the audit trail would route the ADR back to a stale body."
  <commentary>
  Promote refuses on terminal-from-promote statuses (`promoted`, `dismissed`, `superseded`, `archived`). The Skill is conservative — re-running on a superseded finding would write the back-reference on the wrong artifact and the audit trail would skew. The engineer's recovery is to promote the superseding finding.
  </commentary>
  </example>

tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates the finding back-reference and the new ADR/TD frontmatter (KF-04 reciprocity, AD-01..AD-04 for ADR, TD-01..TD-04 for tech-debt)}}"
---

## Purpose

`hstack-kernel-fit-promote` elevates a kernel-fit finding to a durable kernel-change artifact (ADR by default; tech-debt as a secondary path). It is the only Skill that flips a kernel-fit finding to `status: promoted`. The Skill is a mechanical wrapper per ADR-0001: it constructs the seed material from the finding's body and invokes the appropriate authoring Skill, then performs the reciprocal back-reference write directly. No subagent is invoked by this Skill itself — the authoring Skill it routes to (`/hstack:adr-new` or `/hstack:tech-debt-new`) invokes `spec-author` for the open-ended sections.

The contract the user explicitly required at design time: **no agent creates an ADR without a human gate.** Here the human gate is `spec-author`'s Nygard interview, which the engineer walks every section of before the ADR's `status: accepted` write lands. The promote Skill never auto-creates an ADR — it routes; the engineer confirms.

## When to invoke

Invoke when:

- A kernel-fit finding at `status: open` or `acknowledged` warrants a kernel change and the engineer is ready to author the ADR (or capture the tech-debt). The team has discussed the finding; the proposed direction is approximately right; the engineer is ready to commit time to the interview.
- The finding's Counter-explanations have been considered and the team has decided they do not weaken the finding enough to dismiss.

Do NOT invoke when:

- The finding is at `confidence: low`. Low-confidence findings should be either dismissed (with substantive rationale) or left at `open` until the next scan accumulates evidence enough to upgrade them. Promoting `low` skips the implicit signal the analyst encoded.
- The finding has just been written and not yet triaged. Take 24–48 hours to think; the kernel is a high-stakes artifact and the cost of a bad ADR cascades.
- A scan run has just superseded the finding (`status: superseded`). Promote the superseding finding instead.

## Inputs

- `<finding-id>` (required, positional): the finding id, e.g. `KF-0001-category-a-claim-spans-production` or the short form `KF-0001`.
- `--slug <text>` (required): kebab-case slug for the destination artifact. Passed through to the authoring Skill (`/hstack:adr-new --slug <text>` or `/hstack:tech-debt-new --slug <text>`).
- `--target <adr | tech-debt>` (optional, default `adr`): destination artifact type. ADR is the primary path; tech-debt is the secondary path for findings that name a gap but do not yet have a defensible Decision section.

## Preconditions

- `hstack/kernel-fit/findings/<finding-id>*.md` exists. If missing, halt.
- The finding is at `status: open` or `status: acknowledged`. If at any other status (`dismissed`, `promoted`, `superseded`, `archived`), halt with the current status named.
- `--slug` is non-empty and matches `^[a-z][a-z0-9-]*$`.
- `--target` is in the controlled enum (`adr` or `tech-debt`).
- The downstream Skill (`hstack-adr-new` or `hstack-tech-debt-new`) is reachable from the consuming repo's `.claude/skills/`. (Auto-wired via the symlink delta on `npx hstack update`; this check is a defense against drift.)

## Orchestration steps

1. **Resolve and read the finding.** Glob `hstack/kernel-fit/findings/<finding-id>*.md`; on zero or multiple matches, halt. Parse frontmatter; verify status precondition. Print the finding body in full — the engineer reviews before committing the time to the interview.

2. **Construct the seed material.** Extract three sections from the finding body verbatim:
   - `## Evidence` (the bullet list with inline citations)
   - `## Kernel surface implicated` (the single-sentence pointer)
   - `## Proposed direction` (the one paragraph sketch)

   Compose them into a "Seeded from kernel-fit finding <KF-id>" preface plus the three section bodies, verbatim. This preface becomes the Context seed for the downstream authoring Skill. The Counter-explanations section is NOT seeded — the engineer's Decision section must engage with the kernel-change question fresh, not pre-anchored by the analyst's challenge-prompt output.

3. **Confirm before routing.** Print the proposed slug, the target (adr or tech-debt), and the seed preface. Ask "Route to /hstack:<target>-new with this seed? (Y/n)". Default Yes. On `n`, abort without writing.

4. **Route to the authoring Skill.**

   For `--target adr` (default):
   - Invoke `/hstack:adr-new --from-kernel-fit <finding-id> --slug <slug>` via the Task tool or Skill orchestration mechanism. `spec-author` walks the six Nygard sections; the seeded Context is the engineer's starting material to review and revise.
   - On the engineer's confirmation at `status: accepted`, `adr-new` writes the ADR file with `promoted-from-kernel-fit: [<finding-id>]` in its frontmatter and auto-commits with message `adr(ADR-NNNN-<slug>): accepted`.
   - The ADR commit lands first. The back-reference commit lands second. See Failure modes for the recoverable carve-out.

   For `--target tech-debt`:
   - Invoke `/hstack:tech-debt-new --from-kernel-fit <finding-id> --slug <slug>`. `spec-author` walks the six TD sections; the seeded Context is split into Why we took the shortcut, What it costs us, and Fix sketch as appropriate.
   - On terminal-state, `tech-debt-new` writes the TD file with `introduced-by: kernel-fit:<finding-id>` (the kernel-fit-origin variant of the TD `introduced-by` field; documented as a v1 carve-out — the existing field accepts a `kernel-fit:` prefix to disambiguate from change-spec origins) and auto-commits.

5. **Capture the new artifact id.** Parse the downstream Skill's terminal commit message for `ADR-NNNN-<slug>` or `TD-NNNN-<slug>`. On parse failure (downstream Skill halted mid-interview), the promote Skill halts too — re-invocation will resume from the same step once the downstream Skill completes.

6. **Write the reciprocal back-reference on the finding.** Per ADR-0001 (mechanical writes by the Skill orchestrator), the promote Skill performs the `Edit` itself:
   - `promoted-to: adr:ADR-NNNN-<slug>` (or `tech-debt:TD-NNNN-<slug>`)
   - `status: <prev> → promoted`
   - `owner: <git-handle>` (if not already set by triage)
   - `updated: <today>`
   - Append to `## Triage Log`: `- \`status: <prev> → promoted\` on <today> by <owner>. Promoted to: <promoted-to>. Triggered by \`/hstack:kernel-fit-promote <id> --slug <slug>\`.`

   Defensive Triage Log check: if `## Triage Log` is not present (legacy finding), append the section header first.

7. **Print the proposed-diff preview** for the back-reference edit (per the kernel's mechanical-operations confirmation gate). Ask "Apply back-reference and flip status to promoted? (Y/n)". Default Yes.

8. **Edit + validate + commit.** On `Y`:
   - `Edit` the finding file.
   - Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the finding. KF-04 (promoted requires `promoted-to` non-null AND referenced ADR/TD exists) must pass; the reciprocity check verifies the ADR's `promoted-from-kernel-fit` contains this finding's id.
   - On validation pass: `git add` the finding file and commit with message `kernel-fit(<finding-id>): promoted to <promoted-to>`.
   - On validation failure: halt; revert via `git checkout -- <finding-file>`. The ADR commit from step 4 has already landed and is correct — re-invoke promote (it is idempotent on the finding's promoted status, and the back-reference write will retry).

9. **Confirm completion.** Print "Promote complete. Finding <finding-id> is now `promoted` with `promoted-to: <promoted-to>`. The kernel change lives in <promoted-to>; this finding is now read-only from kernel-fit's perspective (further edits would require a new finding via the next scan)."

## Outputs

- A new ADR at `hstack/adr/ADR-NNNN-<slug>.md` OR a new TD at `hstack/tech-debt/TD-NNNN-<slug>.md` (via the downstream authoring Skill).
- An edit to `hstack/kernel-fit/findings/<finding-id>*.md` setting `promoted-to` and `status: promoted`, plus a Triage Log entry.
- Two commits — one from the authoring Skill (ADR or TD), one from this Skill (finding back-reference).

## Auto-commit triggers

- Two commits per promote: the authoring Skill's own commit at the ADR or TD terminal state, and this Skill's own commit at the finding's `status: promoted` flip.

## Idempotency contract

- Re-running on a finding already at `status: promoted`: the Skill prints "already promoted to <promoted-to>" and exits no-op.
- Re-running after step 4 succeeded but step 8 failed (the recoverable carve-out): the Skill detects the ADR or TD exists with the correct `promoted-from-kernel-fit` (or `introduced-by: kernel-fit:<id>`), skips re-invoking the authoring Skill, and goes straight to step 6 (back-reference write). Convergence in one re-invocation.
- Re-running on a `dismissed` or `superseded` finding: halt with the status named. The engineer cannot promote a finding that has been ruled out or restated.

## Stop conditions

Beyond the kernel's general stop conditions:

- The finding does not exist, or is at a terminal-from-promote status (`dismissed`, `promoted`, `superseded`, `archived`). Halt with the status named.
- `--slug` is missing or malformed. Halt with the regex shown.
- `--target` is not in the enum. Halt with usage.
- The downstream authoring Skill halts mid-interview (`spec-author` could not produce two consequences for the ADR Consequences challenge, or the engineer aborted). Propagate the halt; re-invoke when ready.
- The downstream artifact's commit cannot be parsed for its id at step 5 (e.g., the authoring Skill committed under a non-canonical message format). Halt with a diagnostic and let the engineer reconcile.
- The validator fails at step 8 because the back-reference is inconsistent with the ADR's `promoted-from-kernel-fit` array. Halt and reconcile — most likely cause is the engineer aborted the authoring Skill before reciprocal write, leaving inconsistent on-disk state.

## Failure modes

- **Recoverable two-commit carve-out (analogous to `/hstack:finalize` in-progress carve-out).** The kernel's atomicity rule (KERNEL.md `## Mechanical operations § Atomicity for reciprocal pairs`) requires both halves of a reciprocal write to land in the same commit. The finalize Skill carves out an exception for multi-TD resolutions where intermediate state is intentional and recoverable by re-running. Promote adopts the same shape: the ADR (or TD) commit and the finding back-reference commit are separate, and an interruption between them is recoverable by re-running this Skill. During the window between the two commits, on-disk state shows the ADR with `promoted-from-kernel-fit: [<id>]` and the finding still at `status: open` or `acknowledged` — this is intentional and re-runnable. The Forbidden-no-matter-what kernel bullet about reciprocal-pair atomicity applies to **standing** state (post-promote), not the transient window during a single promote invocation. v2 substrate could add `--defer-commit` to the authoring Skills so both writes land atomically; v1 accepts the two-commit pattern for honest implementation reality.
- **Authoring Skill writes the wrong `promoted-from-kernel-fit` id.** Defense: this Skill's validation at step 8 cross-checks. If the ADR's array does not contain the finding id, the back-reference write is refused and the engineer reconciles by editing the ADR's frontmatter (this is itself a mechanical write per ADR-0001; manual `git commit --amend` is the recovery path, but the engineer should prefer re-running promote after correcting the ADR).
- **Drive-by promote.** The Skill's preflight does not detect promote attempts on `low`-confidence findings — the engineer is trusted to make this judgment. If a pattern of `low`-confidence promotes emerges, that itself becomes a future kernel-fit detection pattern (KF-Pn: "engineers promote findings the analyst rated low").
- **Engineer wants to promote two findings to one ADR.** Not supported in v1. Run promote twice with the same `--slug` — the second invocation will halt because the slug collides on `adr-new`'s precondition check. The engineer's recovery is to dismiss one of the findings with a rationale ("subsumed by KF-other-id promoting under slug X") and promote only the canonical one.

## Anti-patterns

- Never auto-promote without engineer invocation. The contract is non-negotiable per ADR-0004.
- Never promote a finding at `low` confidence without a real reason. The analyst encoded a signal by setting confidence; ignoring it is a smell.
- Never edit the finding's body (Evidence, Kernel surface, Proposed direction, Counter-explanations, Confidence rationale) during promote. Those are the analyst's domain and are immutable from this Skill's perspective. The Triage Log append and the four frontmatter changes (status, promoted-to, owner, updated) are the only writes permitted.
- Never write the ADR or TD body. That is `spec-author`'s job, routed via the authoring Skill. Even pre-filling the Decision section based on the finding's Proposed direction is forbidden — the engineer's Decision must engage with the kernel-change question fresh.
- Never promote a `superseded` finding. The audit trail would route the ADR to a stale body.
- Never invoke `spec-author` directly from this Skill. Route through the appropriate authoring Skill (`hstack-adr-new` or `hstack-tech-debt-new`) so the existing challenge-prompts and validation rules apply.
- Never bypass the validator at step 8. KF-04 reciprocity is the load-bearing check that makes the kernel-fit-to-ADR audit chain reconstructible.
