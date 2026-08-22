---
id: app-architecture
type: app-architecture
updated: <YYYY-MM-DD>
---

## 1. Module Map

_The modules, what each owns, and what reaches them. `Critical: yes` means the kernel's
mandatory-test rule applies to this module's paths._

_The **Exposure** column is the exposure map. One line per entry point: `path` · kind (`page`,
`api`, `action`, `job`, `webhook`) · status (`live`, `routable`, `off` — kernel § Context docs).
A module owning no entry point of its own names the ones that reach it; a module no live entry
point reaches is `dormant`, which is derived, not a fourth status. Updated in the PR that changes
exposure, verified at `/promote`, and checkable by diffing these paths against the real routes._

| Module | Owns | Critical | Traces to | Exposure — entry points |
| --- | --- | --- | --- | --- |
| <module> | <what it owns, one line> | yes \| no | <user action OR entity cluster> | `app/(app)/<x>/page.tsx` · page · **live**<br>`app/api/<x>/route.ts` · api · **live**<br>`jobs/<x>.ts` · job · **off** |
| <module> | ... | no | ... | _no entry point of its own — reached by `<module>` (live)_ |
| <module> | ... | no | ... | _dormant — no live entry point reaches it_ |

_This column grades the **product** severity of a finding, never its security severity. Every
routable entry point is covered by the kernel's security checklist whatever the status says._

**Drift challenge answered**

_"Does any module own something no user ever reaches, or does any user journey cross boundaries
this map does not support?"_

## 2. Agent Orchestration Model

_How the LLM calls compose: which module calls, what comes back, who consumes it, where the prompts
live. Named call sites, not "the LLM handles it"._

| Call site (module.fn) | Trigger | Model | Returns | Downstream consumer |
| --- | --- | --- | --- | --- |
| <module>.<function> | <what triggers it> | <model id> | <schema or one line> | <module> |

**Tool boundaries**

_Which tools each call site may invoke, which are out of bounds, and where the kill switch is._

**Drift challenge answered**

_"Does any LLM call site bypass its declared tool boundaries, or have an unnamed retry or fallback
path?"_

## 3. Deterministic-vs-LLM Split

_Per flow, per step: code or prompt, and why. A flow that genuinely is one model call is one row
with its schema and its rationale — the rule is against the undeclared boundary, not against short
tables._

### Flow: <flow-name>

| Step | Mechanism | Rationale (names a property) |
| --- | --- | --- |
| 1. <step> | deterministic \| llm | <one sentence — determinism \| cost \| latency \| capability> |

**Drift challenge answered**

_"Does any flow have a step whose mechanism is undeclared, or a rationale tied to no property?"_

## 4. State-Ownership Map

_Where conversation state, workspace state and ephemeral state live. Each names its owning module
from Section 1 and its persistence layer from `data-architecture.md`._

| State class | Owning module | Persistence layer | Lifetime |
| --- | --- | --- | --- |
| <e.g. conversation history> | <module> | <entity OR "ephemeral"> | durable \| session \| request |

**Drift challenge answered**

_"Does any state class lack an owning module from Section 1?"_

## 5. Surface Boundaries

_Which surfaces this application has, and which module carries each. The usual set is `ui`, `api`,
`agent`, `db`, `auth`, `infra`; add or omit as the product requires._

| Surface | Present? | Modules carrying it |
| --- | --- | --- |
| <surface> | yes \| no | <modules> |

**Drift challenge answered**

_"Does any surface have no module mapped to it?"_
