---
name: hstack-security-review
description: Use when a change-spec is at `ready-to-plan` or later and needs `security-review.md` before implementation. Runs independently of `/hstack:change-plan` and `/hstack:data-review`.
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
  - "{{TODO-SCRIPT: hstack/scripts/score-security-review.ts — computes overall status from the scores map}}"
  - "node hstack/scripts/validate-spec.mjs — validates security-review frontmatter and SR-01..SR-05"
  - "{{TODO-MCP: Supabase MCP — optional in v1 for live RLS introspection; v2 substrate will hard-fail when unreachable for db-surface changes}}"
---

## Purpose

`hstack-security-review` produces `security-review.md` for a change-spec by orchestrating the `security-reviewer` subagent. In hstack v1, the artifact is a structured LLM judgment against the hardening checklist plus three mandatory challenge prompts. It is not an executable test artifact; v2 substrate replaces the scoring with real probe outcomes (prompt-injection corpora, RLS bypass attempts, tenant_id fuzzing, secret-redaction probes). This Skill enforces the v1 honesty framing on every output.

## When to invoke

Invoke when a change-spec reaches `status: ready-to-plan` or later. Security-review can run before, after, or concurrently with `hstack-change-plan` and `hstack-data-review` — none of those gate one another. The implementer refuses to start unless this artifact is at `status: passed` or `concerns-acknowledged`.

## Inputs

- `<change-id>` (required, positional): the change-spec id.

## Preconditions

Before any work:

- Verify the change-spec exists and is at `status: ready-to-plan` or later.
- Verify `hstack/context/threat-model.md` is at `status: current` (not `needs-refresh` or absent). Halt otherwise — the subagent refuses to score against a stale or missing threat model.
- Verify `hstack/context/hardening-checklist.md` is at `status: current`.
- Read `hstack/context/tech-stack.md` and `ci-cd.md` (loaded by `security-reviewer` for grounding).
- Determine whether `surfaces` includes any of `agent`, `auth`, `api`, `db`. If yes, set `threat-model-delta-required: true` for the subagent's session.
- Note whether the Supabase MCP is wired up. If `surfaces` includes `db` and the MCP is unreachable, the Skill proceeds in v1 degraded mode (flagged in rationale) per the v1/v2 split; v2 substrate hard-fails here.

## Orchestration steps

1. **Invoke `security-reviewer`.** Use the Task tool with `subagent_type: security-reviewer` and context = [kernel, `hstack/templates/security-review.md`, change-spec, threat-model, hardening-checklist, tech-stack, ci-cd]. The subagent scores each applicable hardening item against PASS / CONCERNS / FAIL / not-applicable, with a one-paragraph rationale per item.

2. **Threat-model delta.** When `threat-model-delta-required: true`, the subagent writes section 3 with a non-empty delta against the current threat-model.md. SR-03 enforces this at validation.

3. **Three challenge prompts (mandatory).** Per SR-02 and the subagent's contract, the subagent answers all three challenge prompts verbatim:
   - "What attack vector did the In-Scope diff create that is NOT covered by the hardening checklist? If none, justify."
   - "Which tenant_isolation guarantee does this change depend on? Cite the line of code that enforces it."
   - "What part of this change would behave incorrectly under a malicious payload that the test suite does not cover?"
   Each answer is at least one paragraph. The Skill verifies `challenge-prompts-answered: 3` in frontmatter.

4. **Scoring discipline.** Per the subagent's contract, scoring biases toward CONCERNS when evidence is thin. The Skill does not override this bias. Tenant-isolation citations reference real lines of code; the subagent greps to verify.

5. **v1 framing.** Every rationale paragraph uses language like "based on the diff, RLS policy mirrors X" rather than "verified". The Skill rejects any rationale that asserts test-backed evidence — that is v2 substrate territory.

6. **Status transitions.** When every applicable score is `pass` or `not-applicable`, the subagent transitions to `status: passed`. When any score is `concerns`, the subagent transitions to `concerns-acknowledged` only when `concerns-acknowledged-by` is non-null (a human handle the owner has explicitly provided) and section 5 enumerates each open concern. Per SR-05, `passed` is impossible if any score is `concerns` or `fail`.

7. **Tech-debt for deferred concerns.** When a CONCERNS finding is being deferred rather than fixed, the subagent prompts the engineer to invoke `hstack-tech-debt-new` to create the paper trail. The Skill does not file the tech-debt itself; it surfaces the recommendation.

8. **Validate.** Run `node hstack/scripts/validate-spec.mjs <path>` and `{{TODO-SCRIPT: hstack/scripts/score-security-review.ts}}` — SR-01 through SR-05.

## Outputs

- `hstack/specs/changes/<change-id>/security-review.md` at `status: passed` or `concerns-acknowledged`.
- Optional surfaced recommendation to file tech-debt for any deferred CONCERNS.

## Auto-commit triggers

- Status transition to `in-progress` after the first scores land.
- Status transition to terminal (`passed` or `concerns-acknowledged`). Commit message: `security-review(<change-id>): passed` or `concerns-acknowledged`.
- Edits to the `scores` map (because SR-05's terminal-gating depends on it).
- Edits to `concerns-acknowledged-by` (because it gates SR-04).

## Idempotency contract

- Re-running on a terminal security-review without diff changes: the subagent reads the existing artifact and produces a no-op diff aside from `updated` timestamps.
- Re-running after the change-spec's `in-scope` has expanded: the subagent re-scopes the diff read and may produce new scores; the engineer confirms or amends.
- Re-running mid-authoring after a halt: the subagent reads the partial artifact and resumes at the next un-scored item or unanswered challenge prompt.

## Stop conditions

Beyond the kernel's general stop conditions:

- `threat-model.md` or `hardening-checklist.md` at `needs-refresh` or absent. Halt.
- Supabase MCP unreachable and `surfaces` includes `db` in a high-stakes context (new schema, new RLS). Halt in v1 if the change is high-stakes; v2 always hard-fails here.
- A score would require evidence (a test result, runtime check) that does not yet exist. The subagent marks CONCERNS with the missing evidence named; does not synthesize a PASS.
- `concerns-acknowledged-by` would be written without the owner's explicit acknowledgement. Halt.
- A forbidden surface is touched (service_role Supabase key in agent code, raw shell against production, Pipedream Connect against live customer accounts). Halt — kernel-level stop condition.

## Failure modes

- **Threat-model stale.** Halt; refresh via `hstack-configure --interview threat-model`.
- **Tenant-isolation citation cannot be produced because the In-Scope diff drops tenant context.** Halt and surface — the change introduces a tenant-isolation bug.
- **Validator fails SR-02 (fewer than 3 challenge prompts answered).** Halt; the subagent re-runs the missing prompt.
- **v1 framing slips in a rationale.** The Skill detects "verified by test" language in any rationale paragraph and halts; the subagent re-words.
