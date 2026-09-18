---
id: code-standards
type: code-standards
updated: <YYYY-MM-DD>
---

_The rules that need judgment. Size, typing, unread errors, console and `process.env` are the
linter's job (`hstack/templates/eslint-clean-code.mjs`, at `error`, with a suppressions ratchet);
nothing here repeats what it already fails. Read this file before writing application code;
`/hstack-wrap` reads the diff against it before the PR. Each rule carries one example from this
repo — the observed failure it exists for — so a reader knows the rule is about here, not about a
book. Fill the `Seen here` lines from the codebase; leave a rule's line empty when it has not
happened yet, and add the example in the PR where it does._

## 1. Where things live

_The one sanctioned path for each cross-cutting concern. A second one is a finding._

| Concern | Module | What it gives you |
| --- | --- | --- |
| Logging | `<lib/observability/logger>` | structured, redacted, tenant-tagged |
| Configuration | `<lib/env>` | every variable validated once at boot |
| Database client | `<lib/supabase/{server,client,admin}>` | the RLS posture chosen for you |
| Errors | `<lib/errors>` | `AppError` with `code` and `cause`; the boundary handler |
| Retry / sleep / chunk | `<lib/retry>` | abort-aware, already tested |
| Shared UI primitives | `<components/ui>` | — |

## 2. Before writing, search

Before adding a helper, a client, a wrapper, a parser or a formatter, grep for one that exists.
If it exists, use it. If it is almost right, fix it in place and move the callers. Never write a
second one beside the first — the copies drift, and the drift is a bug nobody planned.

Seen here: _<e.g. seven `sleep` definitions; three copies of the same vendor client, one with
retry and two without>_

## 3. One function, one responsibility, one level of abstraction

A function either orchestrates — calls named steps in order — or is one step. When a reader needs
a comment to find where the next phase starts, the function is two functions and the comment is
the name of the second. Extract until each name says what its body does.

Seen here: _<e.g. a stream handler that gates, fetches, builds the prompt, persists, retries and
reports cost, in one body>_

## 4. A React component does not talk to the network

Fetching, streaming, protocol decoding and retry live in a hook or a service module. The
component receives data and callbacks, and renders. A component that parses a response body is
a service wearing a template.

Seen here: _<e.g. a chat component parsing server-sent events by hand inside a mutation>_

## 5. A file's name says what it contains, and it contains one thing

If the folder or the file cannot be named after its single responsibility, it has more than one.
One vendor client per file. No `helpers.ts` past two hundred lines. No file that is a barrel
(`index.ts`) and an implementation at the same time.

Seen here: _<e.g. a file named after one OAuth broker holding six vendor APIs>_

## 6. Names describe behaviour, not category

`get*` reads and has no side effect. `is*` / `has*` return a boolean. A name that needs its
docblock to be understood is the wrong name. One word per concept across the codebase — pick one
of the synonyms and use it everywhere. No `v2`, `new`, `old`, `legacy` in a name: the name says
what it is, git says how old.

Seen here: _<e.g. `getX` that creates and connects; card / job / task for one entity>_

## 7. A returned error is a handled error

Errors travel one way: thrown (with `cause`) from where they happen, caught once at the boundary
— the route, the job, the server action — where a single handler logs them and shapes the
response. In between, code neither logs-and-rethrows nor catches-and-continues. A `catch` either
handles, rethrows with `cause`, or carries a one-line justification for swallowing. A client
that returns `{ data, error }` instead of throwing has `error` read on every call. A write is
never followed by `ok: true` without its result being checked.

Seen here: _<e.g. an update whose result was never read, answered with `{ ok: true }`>_

## 8. Replace, do not add beside

A new implementation of an existing thing ships in the PR that deletes the old one, with every
import moved. No parallel folder, no second system left wired "for now", no legacy path still
reachable from a live route.

Seen here: _<e.g. two component trees for one screen; three agent loops each with its own cost
tracker>_

## 9. Delete what nothing imports

An unused file, export or dependency is removed in the PR that orphaned it, not recorded as
debt. Dead code is read by the next agent as live.

Seen here: _<e.g. whole component folders no route reaches>_

## 10. Constants live in one place

Table names, status strings, limits, timeouts and model ids are imported from a constants module,
never retyped as literals at the call site. A rename is one edit.

Seen here: _<e.g. one table name typed by hand in a hundred places>_

**Drift challenge answered**

_"Which rule above has the repo violated since this file was last updated, and where?"_
