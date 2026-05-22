---
name: hstack-adversarial-review
description: |
  Use this skill only in a fresh Claude Code session — separate from the session that ran the implementer — after verification has landed at `status: passed` and the change is at `ready-for-review`. The Skill orchestrates the `adversarial-reviewer` subagent to produce a quota-driven critique. v1 fresh-session enforcement is honor-system; the Skill emits a clear instruction reminding the engineer that the v2 substrate will verify via session-id comparison. Examples:

  <example>
  Context: The implementer finished the last phase of a billing change; verification passed; the engineer has opened a fresh session for adversarial review.
  user: "I've opened a new session. /hstack:adversarial-review 2026-05-billing-overage-warning"
  assistant: "I'll invoke adversarial-reviewer. Findings floor is 5 because area=billing. I'll load every change artifact and the full diff; no implementer transcripts. Minimum 5 findings or a defended sub-floor justification — 'no issues found' is not a terminal state."
  <commentary>
  AR-06 raises the findings floor to 5 for changes in {agent, auth, billing}. The reviewer must spread findings across categories — clustering all findings in one category is a smell unless flagged in Methodology.
  </commentary>
  </example>

  <example>
  Context: A small copy-fix change has been verified and the reviewer can only honestly produce two findings.
  user: "/hstack:adversarial-review 2026-05-billing-copy-tweak"
  assistant: "I'll invoke adversarial-reviewer. If I can only honestly produce two findings, I'll set findings-fewer-than-floor: true and write a defended justification in section 4 — enumerate every category considered and explain why each produced no honest finding."
  <commentary>
  The sub-floor path is explicit and rare. AR-01 demands `findings` length ≥ `findings-floor` OR `findings-fewer-than-floor: true` plus non-empty `justification-when-fewer`. "The change is small" alone is insufficient.
  </commentary>
  </example>

  <example>
  Context: The adversarial reviewer finds a high-severity tenant-isolation issue the security review missed.
  user: "/hstack:adversarial-review 2026-06-retrieval-rpc-rewrite"
  assistant: "I'll invoke adversarial-reviewer with the new pgvector RPC under scrutiny. If a severity:high tenant-isolation finding lands, the resolution must be commit:<hash> or tech-debt:<id> — not justified-in-prose. High-severity security routed to justified-in-prose is a smell and I'll halt."
  <commentary>
  Resolution discipline matters: `commit:<hash>` for code fixes, `tech-debt:<id>` for deliberate deferral, `justified-in-prose` only for low-severity findings where in-prose reasoning is genuinely right. High-severity security via justified-in-prose is a halt condition.
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
  - "{{TODO-SCRIPT: hstack/scripts/validate-spec.ts — validates adversarial-review frontmatter and AR-01..AR-06}}"
  - "{{TODO-OTHER: fresh-session-attestation — in v1, the subagent self-attests the session is fresh; v2 substrate captures and compares Claude Code session ids automatically}}"
---

## Purpose

`hstack-adversarial-review` produces `adversarial-review.md` by orchestrating the `adversarial-reviewer` subagent in a Claude Code session separate from the one that ran the implementer. The output is structurally biased against "looks good" — the reviewer must produce at least the findings floor across the six categories or defend a smaller count with explicit rationale. In v1, fresh-session separation is honor-system; the Skill's first job is to remind the engineer of that.

## When to invoke

Invoke after `verification.md` reaches `status: passed`, in a **fresh Claude Code session**. The Skill opens with a clear instruction to the engineer naming the requirement. If the engineer reports they are in the same session as the implementer, halt and ask them to start a new session.

## Inputs

- `<change-id>` (required, positional): the change-spec id.

## Preconditions

Before any work:

- **Fresh-session attestation.** The Skill's first action is to print: "This Skill must run in a Claude Code session separate from the one that ran `hstack-implement`. The kernel's authoring-and-review-never-share-a-session principle is honor-system in v1; v2 substrate will verify via session-id comparison. Confirm you are in a fresh session before I proceed." Halt until the engineer confirms.
- Verify the change-spec exists and is at `status: ready-for-review`.
- Verify every required upstream artifact is at terminal status:
  - test-plan at `passed` or `concerns-acknowledged`
  - plan at `completed`
  - security-review at `passed` or `concerns-acknowledged`
  - data-review at `passed` or `concerns-acknowledged` when applicable
  - ui-brief at `drafted` and figma-handoff at `ready` when applicable
  - verification at `passed`
- Determine the findings floor: 3 default; 5 when `change-spec.area` is in {agent, auth, billing} per AR-06.

## Orchestration steps

1. **Open with the fresh-session reminder.** Print the message verbatim; wait for the engineer's confirmation.

2. **Invoke `adversarial-reviewer`.** Use the Task tool with `subagent_type: adversarial-reviewer` and context = [kernel, `hstack/templates/adversarial-review.md`, change-spec, plan, test-plan, ui-brief and figma-handoff when present, security-review, data-review when present, verification, full diff, module-spec, threat-model, hardening-checklist, data-architecture, tech-stack]. Explicitly NOT included: any implementer conversation transcript or scratchpad.

3. **Findings generation across six categories.** The subagent produces findings in security, scope-drift, invariant-breach, spec-compliance, data-integrity, and code-quality. Clustering in one category is a smell — when it happens, the subagent flags the clustering in Methodology and explains why the change genuinely lives in one risk dimension. Test-plan adherence is a first-class lens: missing edge-case tests surface as spec-compliance findings; missing tenant-isolation tests surface as data-integrity findings; unmet performance budgets surface as code-quality or data-integrity findings depending on cause; unmapped invariants in `verification.test-plan-coverage` surface as spec-compliance findings. **Test-immutability audit:** the subagent diffs every pre-existing test file against the branch base; any modification, deletion, or snapshot update without a matching `Ok to change/delete/update/refresh ...` authorization echo in a commit message is a mandatory finding under spec-compliance at minimum `severity: high`. Bulk snapshot-update flags visible in the diff or in CI logs escalate to `severity: critical`. These findings are filed even when they push the total over the findings-floor.

4. **Findings-floor compliance.** Per AR-01, `findings` length must be ≥ `findings-floor`. If the subagent honestly cannot produce the floor, it sets `findings-fewer-than-floor: true` and writes a defended `justification-when-fewer` enumerating every category considered and why each produced no honest finding. "The change is small" alone is insufficient.

5. **Resolution discipline.** Each finding's `resolution` is one of:
   - `commit:<hash>` — must reference an existing commit on the change's branch (AR-04).
   - `tech-debt:<id>` — must reference an existing tech-debt artifact at `open` or `in-progress` (AR-05). When the engineer chooses this path, they invoke `hstack-tech-debt-new` to create the tech-debt artifact before this review terminates.
   - `justified-in-prose` — reserved for low-severity findings only. High-severity findings routed to `justified-in-prose` halt the Skill.

6. **Fresh-session attestation in frontmatter.** The subagent writes `fresh-session-attestation: "session <id>; opened <timestamp>; no prior implementer context loaded"`. v1 records this as honor-system text; v2 substrate captures the actual session id from Claude Code's session file.

7. **Findings-open is non-terminal.** The subagent does not advance `status: findings-resolved` until every finding has `status: resolved` and a `resolution` value.

8. **Owner response loop.** For each finding, the engineer (the change owner) responds with a resolution. The Resolution Log section records each response. The Skill walks the engineer through every finding sequentially.

9. **Validate.** Run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` — AR-01 through AR-06.

10. **Change-spec advance (mechanical, only on `findings-resolved`, Skill-orchestrator write per ADR-0002).** When and only when the subagent returned with `adversarial-review.md` at `status: findings-resolved`, read `hstack/specs/changes/<change-id>/spec.md` and inspect its `status` frontmatter. If `status: ready-for-review`, print a proposed-diff preview of the change-spec edit (`status: ready-for-review → ready-to-ship`; `updated: <today>`) and prompt "Proceed with this change-spec advance? (Y/n)". Default Yes. On confirmation, perform the edit via the `Edit` tool, run `{{TODO-SCRIPT: hstack/scripts/validate-spec.ts}}` against the change-spec, then `git add` and commit with message `change-spec(<change-id>): ready-to-ship`. This is a separate commit from the adversarial-review transition commits, matching the verify and finalize precedents. If the change-spec is already at `ready-to-ship` or any downstream status (`shipped`, `archived`), this step is a no-op (idempotent on re-runs). When adversarial-review status is `findings-open` or `in-progress`, this step does not run — the change-spec remains at `ready-for-review` until every finding is resolved. Do NOT invoke `spec-author` and do NOT delegate the write to the `adversarial-reviewer` subagent; per the kernel's Mechanical operations section and ADR-0002, the value to write is fully determined by the adversarial-review postcondition and the change-spec's current status, so the Skill orchestrator writes directly. The `adversarial-reviewer` subagent retains its critique-only lane and writes only `adversarial-review.md`.

## Outputs

- `hstack/specs/changes/<change-id>/adversarial-review.md` at `status: findings-resolved`.
- When `adversarial-review.md` lands at `findings-resolved` and the change-spec was at `ready-for-review`: an edit to `hstack/specs/changes/<change-id>/spec.md` advancing `status: ready-for-review → ready-to-ship` and bumping `updated:` (per ADR-0002, written by the Skill orchestrator).
- Optional new tech-debt artifacts produced via `hstack-tech-debt-new` invocations when findings route to `tech-debt:<id>`.
- Optional new commits on the change's branch when findings route to `commit:<hash>` and the implementer is re-invoked (separately, via `hstack-implement`) to make the fix.

## Auto-commit triggers

- Status transition to `in-progress` after Methodology lands.
- Status transition to `findings-open` after all findings are written.
- Status transition to `findings-resolved` when every finding has `status: resolved`.
- Edits to the `findings` array.
- Edits to any finding's `resolution`.
- **Change-spec status transition `ready-for-review` → `ready-to-ship`** (per ADR-0002, Skill-orchestrator write). When `adversarial-review.md` reaches `findings-resolved`, the Skill orchestrator performs the change-spec advance directly via `Edit` (orchestration step 10), in a separate auto-commit with message `change-spec(<change-id>): ready-to-ship`. The change-spec becomes eligible for `hstack-ship` only after this commit lands. `hstack-ship` itself remains read-only across artifact statuses — it reads the already-written `ready-to-ship` and computes the merge-readiness scorecard. The `adversarial-reviewer` subagent does not write this transition; it stays in its critique-only lane.

## Telemetry sidecar

At the change-spec advance commit (only when adversarial-review status is `findings-resolved`), write `hstack/specs/changes/<change-id>/.telemetry/adversarial-review.json` in the same `git add && git commit` as the change-spec advance. The sidecar is derivative of git + frontmatter (see `hstack/templates/telemetry-sidecar.md`). Schema:

```json
{
  "schema_version": 1,
  "skill": "hstack-adversarial-review",
  "change_id": "<change-id>",
  "reviewed_at": "<ISO-8601, when status reached findings-resolved>",
  "findings_floor": <int, 3 or 5 per AR-06>,
  "findings_count": <int, length of frontmatter findings array>,
  "findings_fewer_than_floor": <bool>,
  "category_counts": {
    "security": <int>,
    "scope-drift": <int>,
    "invariant-breach": <int>,
    "spec-compliance": <int>,
    "data-integrity": <int>,
    "code-quality": <int>
  },
  "severity_counts": {
    "critical": <int>,
    "high": <int>,
    "medium": <int>,
    "low": <int>
  },
  "resolution_mix": {
    "commit": <int>,
    "tech-debt": <int>,
    "justified-in-prose": <int>
  },
  "fresh_session_attestation": "<verbatim copy of frontmatter field>",
  "halt_reasons": [<kernel halt-sentinel enum values, if any>]
}
```

When the review ends at `findings-open` or `in-progress` (no change-spec advance), the sidecar still lands with the same shape on whichever transition commit terminates the current run; `findings_fewer_than_floor` reflects the current value. `.telemetry/` is git-ignored. If the sidecar write fails, log and continue; the canonical commit must still land. This is the most directly Goodhart-resistant of the five v1 sidecars — `category_counts` + `severity_counts` + `resolution_mix` jointly surface findings-quota-gaming patterns no single field could detect.

## Idempotency contract

- Re-running on a `findings-resolved` review: the subagent reads the existing artifact and produces a no-op aside from `updated` timestamps, unless new code or artifacts have landed since the prior run (in which case new findings may be generated and the status drops back to `findings-open`).
- Re-running mid-resolution after a halt: the subagent reads the partial artifact and resumes with the first finding still at `status: open`.
- The change-spec advance step (step 10) is idempotent: a re-run against a change-spec already at `ready-to-ship` (or `shipped`, `archived`) produces a no-op for that step. The Skill does not re-advance and does not regress.

## Stop conditions

Beyond the kernel's general stop conditions:

- Engineer has not confirmed they are in a fresh Claude Code session.
- A required upstream artifact is non-terminal.
- A high-severity security or tenant-isolation finding would route to `justified-in-prose`. Halt.
- A `commit:<hash>` resolution would reference a commit not on the change's branch.
- A `tech-debt:<id>` resolution would reference a non-existent tech-debt artifact (the engineer must invoke `hstack-tech-debt-new` first).
- The findings floor cannot honestly be met and the sub-floor justification cannot be defended.
- The diff includes changes outside `change-spec.in-scope` that CI did not catch — surface a scope-drift finding and halt the CI gap as a separate concern.
- An implementer transcript or scratchpad is visible in the session.

## Failure modes

- **Engineer claims fresh session but conversation shows prior implementer transcripts.** Halt; ask the engineer to truly start a new session.
- **Reviewer cannot produce honest findings to meet the floor and the sub-floor justification feels thin.** Re-prompt for each category; if still under floor, the engineer must defend the sub-floor explicitly.
- **A finding routes to `tech-debt:<id>` but the engineer hasn't created the tech-debt artifact.** The Skill prompts to invoke `hstack-tech-debt-new`; the review does not terminate until the artifact exists.
- **A commit hash named in `resolution` does not exist on the change's branch.** Halt — the engineer either re-references the correct commit or the resolution is reconsidered.

## Anti-patterns

- Never return "no issues found" without a defended sub-floor justification.
- Never run in the same Claude Code session as `hstack-implement`. Honor-system in v1; CI-verified in v2.
- Never cluster all findings in one category without flagging in Methodology.
- Never use `justified-in-prose` for a high-severity finding.
- Never propose code changes directly — the reviewer surfaces findings; the owner or implementer (via `hstack-implement`) resolves them.
- Never invent a tech-debt id. The artifact must exist or be authored before the review terminates.
- Never accept a `commit:<hash>` that does not exist on the change's branch.
- Never advance status to `findings-resolved` while any finding has `status: open`.
- Never load implementer transcripts. If visible, halt.
