# The six finding categories — a calibration rubric

Reference file for `hstack-adversarial-review` and the `adversarial-reviewer` subagent. Read it
when a category is unfamiliar, when a finding feels thin and you want to know whether it is real,
or when calibrating a severity. It is **not** a checklist: nothing here says how many findings a
review should produce, and a review landing entirely in one category is the correct outcome when
the change carries its risk in one dimension (ADR-0014).

---

## security

**What it means.** The change creates or widens a path an attacker can use, or weakens a control
that was closing one. Distinct from `data-integrity`: this is about an adversary, not about
accidental corruption.

**Real findings look like.** A new endpoint that reads a user-supplied id and queries by it without
re-deriving the caller's scope. A prompt that concatenates retrieved document text into a system
message. A secret moved from an env read to a literal. An auth check that runs after the side
effect. A dependency bump that pulls a package with a known CVE.

**Filler looks like.** "Consider adding rate limiting" on a change that touches no network surface.
Restating an item of the kernel's security checklist with no evidence from the diff that it was
missed.

**Severity.** Anything exploitable by an unauthenticated caller, or that crosses a tenant boundary,
is `critical` or `high` — never `medium` because it is unlikely. Likelihood belongs in the severity
rationale, not in the level.

---

## scope-drift

**What it means.** The diff touches things the PR description's announced perimeter does not name
(kernel § Scope rules), or the change quietly grew a second purpose.

**Real findings look like.** A refactor of a shared util nothing in the change asked for. A
migration altering a table outside the change's module. A "while I was in there" rename that makes
the diff unreviewable. A new dependency satisfying a convenience nobody asked for.

**Filler looks like.** Flagging a file the announced perimeter does cover. Flagging generated
files, lockfiles or formatter output the repo's conventions produce automatically.

**Severity.** Usually `medium`. It escalates when the drift lands on a path `invariants.md` covers,
because then it is also `invariant-breach`.

---

## invariant-breach

**What it means.** Something `hstack/context/invariants.md` or a living doc declares as always-true
is no longer always-true after this diff.

**Real findings look like.** An invariant about ordering that the new code path can violate under
concurrency. An invariant still true but now enforced by convention where it used to be enforced by
a type or a database constraint. A boundary a living doc describes — "no direct SQL outside this
module" — and a new query in an adjacent file.

**Filler looks like.** Paraphrasing an invariant back and calling it a risk. Naming an invariant the
diff does not touch.

**Severity.** `high` by default — an invariant that breaks silently is worse than a bug that throws.
Drop to `medium` only when an existing test fails loudly on the breach.

---

## intent-compliance

**What it means.** The diff and what the PR says it does disagree. The widest category and the one
most often under-used. The PR description is the contract here: it names the perimeter, the Notion
feature, the shortcuts taken, the living docs updated.

**Real findings look like.** Behaviour the description promises and the diff does not land.
Behaviour the diff adds that no line of the description anticipated — undeclared scope is a
compliance gap in the other direction. A living doc the change invalidated and left untouched
(kernel § Context docs). A conscious shortcut visible in the code and named nowhere. **Any
test-file modification without its disclosure tag** (`KERNEL.md` § Tests); this one is mandatory
and never subject to judgment about whether it is worth filing.

**Filler looks like.** "The description could have been clearer." Style disagreements with how the
work was sequenced.

**Severity.** Undisclosed test changes: `high` minimum, `critical` for a bulk snapshot update or a
silent neutralization. A
stale living doc: `high`, because the next session will read it and believe it. Everything else:
judgment.

---

## data-integrity

**What it means.** Data can end up wrong, lost, or visible to the wrong tenant without anybody
attacking anything.

**Real findings look like.** A migration adding a NOT NULL column with no default and no backfill.
A destructive DDL with no stated rollback. An RLS policy whose predicate does not match the tenancy
model in `data-architecture.md`. A tenant-scoped RPC missing its tenant filter. A write path that
is not idempotent under retry. A pgvector retrieval filtering after the similarity search rather
than inside it.

**Filler looks like.** Speculating about scale on a table with a bounded row count. Recommending an
index with no query to justify it.

**Severity.** Cross-tenant leakage is `critical` — always, including when the leak needs an unlikely
sequence to trigger. Irreversible data loss is `critical`. Recoverable inconsistency is `high`.

---

## code-quality

**What it means.** The change works and will cost more than it should to live with. The rubric is
`hstack/context/code-standards.md`: a finding here names the rule it breaks, and a rule the file
does not hold is not a finding. The easiest category to pad, which is why the rule number is
required.

**Real findings look like.** A second implementation of something the repo already had — a
client, a parser, a retry — written beside the first instead of found (rule 2). A function that
orchestrates and also does the steps, so the next phase starts at a comment (rule 3). A component
that fetches or decodes a protocol (rule 4). A file whose name stopped describing its contents in
this diff (rule 5). A `get*` that writes (rule 6). A result carrying `error` that nothing reads,
or a `catch` that continues with no justification (rule 7). A new path wired beside the old one
with the old one still reachable (rule 8). Code this diff orphaned and left in place (rule 9).

**Filler looks like.** Naming preferences that do not make a name lie. Suggested comments.
Requests to extract a function used once. Anything the repo's linter already fails on — size,
`any`, console, `process.env` — when the linter is wired; when it is not, one finding says so
instead of listing what it would have caught.

**Severity.** `low` or `medium`. Rule 7 escalates on a write path: an unread error after an
`update` or `delete` is `data-integrity`, not `code-quality`. Any other `high` here is usually
mis-categorized — look again at `invariant-breach` or `data-integrity`.

---

## Resolution

Independent of category, a finding names what would resolve it:

- **A corrective commit on the branch** — the author fixes it before the merge.
- **A tech-debt file in the same PR** — the finding is real and is being lived with, on the record
  and grep-able by `related-modules` (kernel § Tech-debt).
- **An argument in the comment thread** — the finding is real and the right answer is to explain
  why nothing changes. Fine for a `low`; a `high` answered this way stays open, and a security or
  tenant-isolation finding answered this way is escalated, not closed.
