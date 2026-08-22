<!-- The PR description hstack expects, filled by /hstack-wrap.
     This file is the seed: it is copied once to .github/pull_request_template.md,
     which is what GitHub renders and what /hstack-wrap fills from then on.
     Delete a section only when it is honestly empty. -->

<!-- SENSITIVE SURFACE — first line of the description, or deleted entirely.
     Agent or tool boundaries, auth, RLS, schema and migrations, pgvector,
     payments and credits. When one is touched, say so here and ask for the
     deep pass in a fresh session (/hstack-adversarial-review). -->

## Intention

<!-- What this change is for, in a sentence or two. The Notion feature it serves, with its URL, when there is one. -->

## Perimeter

<!-- What was announced, and what was actually touched. If they differ, say why. -->

## Decisions

<!-- What a reader would otherwise have to reverse-engineer from the diff: a trade-off taken,
     an approach rejected, a name chosen on purpose. A one-way door is an ADR, drafted in this
     PR — link it here. -->

## Living docs

<!-- Which living docs this diff invalidated, and how they were updated here. "None invalidated"
     is a real answer. A doc that is stale and could not be updated is named as stale — never
     silently left, never invented. -->

## Shortcuts & tech-debt

<!-- Conscious shortcuts that survive the merge, each with its hstack/tech-debt/TD-NNNN-<slug>.md
     file. "None" is a real answer when it is true. -->

## Review findings

<!-- /review and /security-review, in full. These are LLM judgments, not evidence: an empty list
     means the reviewer found nothing, not that there is nothing. CI is the only mechanical check. -->

**Fixed here:**

**Declared, not fixed:**

<!-- Each with the reason it was not fixed. -->
