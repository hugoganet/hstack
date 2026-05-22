---
id: <STORE>:<store-native-id>          # one of NOTION:<id> | LINEAR:<key> | GH:<num> | REPO:<slug>
type: story
status: drafted                        # drafted | ready | in-flight | shipped | archived
owner: <git-handle>
persona: <persona-id>                  # single persona id
job-to-be-done: <one-sentence summary; mirrors section 1>
success-metric: <how shipping is measured>
linked-change-specs: []                # required non-empty when status: in-flight
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## Who and Why

_Persona id (pointer, not duplicated) and the job-to-be-done. 1–2 sentences._

## What Shipping Looks Like

_What the user sees, does, feels. One paragraph, 3–5 sentences._

## Success Metric

_Pointer to the `success-metric` frontmatter field with a one-sentence explanation of how it is measured._

## Edge Cases the User Cares About

_Challenge prompt: what does the user notice if this ships but is slightly broken? 2–5 bullets._

-

## Out of Scope for This Story

_Adjacent functionality this story does not cover. 2–3 bullets._

-
