---
name: hstack-test-audit
description: "Use on demand for one module whose tests look thin: map its business rules against the existing tests, name the gaps, write the missing tests, record the invariants found. Never a per-change phase."
---

## Purpose

`/hstack-test-audit <module>` audits one module's coverage of its **business rules** — the places
where the code decides something that would be wrong in silence — and closes the gaps the engineer
chooses to close. It produces tests and an `invariants.md` update. No artifact, no status, no
report file.

## When to invoke

When a module's tests look thin (kernel § Workflow trigger table), or before a module starts
carrying real users' money, data or identity. On demand only: the kernel's per-change rule is one
question at plan time, and this Skill is never a phase of a change.

## Inputs

`<module>` — a module from the Module Map in `app-architecture.md`, or a path.

## Steps

1. **Map the rules.** Read the module's code, `hstack/context/invariants.md`, the Module Map, and
   `data-architecture.md` when the module touches the database. Write each rule as *decides X;
   wrong in silence if Y*. A module whose code decides nothing has no gap to close — say so and
   stop rather than write tests for the sake of coverage.
2. **Map the existing tests onto the rules.** Existing test files are read-only here
   (kernel § Test immutability); this step reads them, it never edits them.
3. **Name the gaps** — rules with no test, and tests asserting something no rule needs.
4. **Interview the edges.** A handful of questions, not a script: *what does the user notice if
   this breaks in silence?* — plus concurrency, retries, and the cross-tenant case when the module
   touches tenant-scoped data. The answers sharpen the gap list.
5. **Propose extractions.** A rule buried in a component is a rule nobody can test. Propose
   pulling it into a pure function; the engineer decides, and an accepted extraction ships in the
   same PR as the test that justifies it.
6. **The engineer picks the gaps to close now.** A module with twenty uncovered rules would make
   an unreviewable PR. Close the chosen ones; name the rest in the PR description so the next
   audit starts there.
7. **Write the tests.** New test files need no authorization — "new" means the path did not exist
   at session start. If closing a gap requires editing or deleting an existing test, halt and ask;
   nothing in this Skill authorizes that.
8. **Record the invariants.** Every rule the audit surfaced goes into `hstack/context/invariants.md`
   in this PR — **including the gaps left open**. The memory is the cheap half; write it whether or
   not the test was written.

The heavy reading in steps 1–3 goes to the `test-strategist` subagent, which returns the rule map
and the gap list. Steps 4 and 6 are questions for the engineer and happen here, in this session.

## Output

New test files, an `invariants.md` diff, and a summary for the PR description naming the gaps left
open. Nothing else.

## Stop conditions

Beyond the kernel's:

- Closing a gap would require touching an existing test. Halt (§ Test immutability).
- The module cannot be located, or spans so much of the repo that "one module" is not what is
  being audited. Ask which one.
- An invariant the audit surfaces contradicts one already in `invariants.md`. Surface both; the
  engineer decides which is true.
