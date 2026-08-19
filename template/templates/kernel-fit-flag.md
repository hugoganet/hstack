---
id: flag-<YYYYMMDD>T<HHMMSS>-<session-id-short>
type: kernel-fit-flag
status: pending                          # pending | processed
session-id: <claude-code-session-uuid>   # FL-01: non-null at pin-time
session-transcript-path: <abs-path-to-jsonl>  # FL-01: non-null at pin-time
branch: <current-branch>                 # FL-01: non-null at pin-time
head: <current-HEAD-sha>                 # FL-01: non-null at pin-time
workspace: <abs-path-to-cwd>             # FL-01: non-null at pin-time
timestamp: <ISO-8601 timestamp at pin>   # FL-01: non-null at pin-time
pre-compaction-message-count: <integer>  # FL-01: non-null at pin-time; analyst uses this to detect truncation between pin and scan
hint: null                                # one-word string from --hint arg; null when no arg given
classification: null                      # FL-02: non-null when status: processed; one of friction | missing-guardrail | kernel-vs-practice-mismatch | not-actionable | transcript-truncated
classification-rationale: null            # FL-02: non-null when status: processed; one-line analyst note
folded-into: null                         # KF-NNNN-<slug> when the analyst folded the signal into an existing finding
emitted-as: null                          # KF-NNNN-<slug> when the analyst emitted a fresh finding from this pin
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

<!--
A kernel-fit-flag is a frontmatter-only pin. There is no body. Engineer
interpretation of the friction is deliberately excluded — the analyst reads
the transcript window and forms its own classification at processing time.

Validator rules (`node hstack/scripts/validate-spec.mjs <path>`; the pin itself
lands regardless — see `/hstack:flag` § does NOT halt on):

- FL-01: at pin-time (status: pending) every field marked above as
  "non-null at pin-time" must be populated. `hint` may be null; the four
  analyst-owned fields (classification, classification-rationale,
  folded-into, emitted-as) must remain null until processing.

- FL-02: at processing-time (status: processed) `classification` and
  `classification-rationale` must both be non-null. When the classification
  produced a finding, exactly one of `folded-into` or `emitted-as` is non-null
  (never both). When the classification did not produce a finding (closed as
  `not-actionable` or `transcript-truncated`), both remain null.

Pins are immutable from the engineer's perspective. The only legal writes
after creation are by the kernel-fit-analyst at processing time, setting the
four analyst-owned fields and flipping status to processed. The engineer
cannot edit a pin to add commentary — that would re-open the contamination
surface the analyst guards against. To add context, re-flag in a follow-up
turn (a new pin with a different timestamp).

Pins live at hstack/kernel-fit/flags/pending/ before processing and at
hstack/kernel-fit/flags/processed/ after. The directory is gitignored in
the consuming repo — see ADR-0005 for the rationale and the trade-off
(provenance gap unique to this artifact type).
-->
