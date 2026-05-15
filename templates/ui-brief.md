---
id: <parent-change-id>-ui-brief
type: ui-brief
status: draft                          # draft | drafted | superseded
owner: <git-handle>
parent-change: <change-spec-id>
reused-components: []                  # design-system component ids
new-components: []                     # any non-empty entry requires a justification subsection
design-system-version: <version>       # must match hstack/config.yaml
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## Goal

_One paragraph. What the UI must achieve from the user's POV._

## Layouts and States

_For every visible state of every new or modified surface: layout, content, interaction. Paragraph or bullets per state._

## Reused Components

_Bullets pointing to existing components by design-system id._

-

## New Components

_For each: name, props, justification for not reusing. Challenge prompt: why is this new and not a reuse?_

### <ComponentName>

**Props.** `{ ... }`

**Justification.**

## Copy

_Exact strings the user sees. Reviewed by cofounder. Bullets._

-

## Accessibility Notes

_Anything that requires non-default handling (focus order, screen reader copy, contrast deviation). Bullets._

-
