---
id: app-architecture
type: app-architecture
status: draft                          # draft | current | needs-refresh | archived
owner: <git-handle>
derived-from: [product-brief, data-architecture]
downstream: [threat-model, hardening-checklist, tech-stack, module-spec/*]
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
schema-version: 1
---

## 1. Module Map

_The set of modules and what each owns. Each module must trace to either a persona-named action in `product-brief.md` or to a logical clustering of entities from `data-architecture.md`. Orphan modules (no trace) halt the section with the drift challenge._

**Modules**

| Module | Owns | Traces to |
| --- | --- | --- |
| <module-name> | <one-line statement of what this module owns> | <persona-action OR entity-cluster> |

**Drift challenge answered**

_"Does any module here own state a persona never interacts with, OR does any persona's journey traverse modules in a way the boundaries don't support?"_

## 2. Agent Orchestration Model

_How LLM calls compose. Which modules call the LLM, what each call returns, how downstream modules consume the output. Tool boundaries. Where prompts live. For an AI-native SaaS, this is the meaty section — implicit "the LLM handles it" answers are rejected; named call sites and downstream consumers are required._

**LLM call sites**

| Call site (module.fn) | Trigger | Model | Returns | Downstream consumer |
| --- | --- | --- | --- | --- |
| <module>.<function> | <what triggers this call> | <model identifier> | <structured-output schema or one-line description> | <module that consumes> |

**Tool boundaries**

_Which tools each call site can invoke, and which are explicitly out-of-bounds. Names the kill switches for LLM-driven actions._

**Drift challenge answered**

_"Does any LLM call site bypass the tool boundaries declared, or have an unnamed retry / fallback path?"_

## 3. Deterministic-vs-LLM Split

_Per user-facing flow, the per-step decision: code or prompt, with a rationale that ties to a measurable property (determinism, cost, latency, capability). Implicit "AI handles it end-to-end" answers are rejected; per-step declaration is mandatory._

**Flow tables**

For each flow named in the brief's persona vignettes:

### Flow: <flow-name>

_From <persona>'s Tuesday-morning workflow._

| Step | Mechanism | Rationale (ties to measurable property) |
| --- | --- | --- |
| 1. <step description> | deterministic \| llm | <one sentence — property: determinism \| cost \| latency \| capability> |
| 2. ... | ... | ... |

**Drift challenge answered**

_"Does any flow have a step where the mechanism is undeclared, or a rationale that doesn't tie to a measurable property?"_

## 4. State-Ownership Map

_Where conversation state lives, workspace state lives, ephemeral / browser-session state lives. Each state class names its owning module from Section 1 and its persistence layer from `data-architecture.md`. State without an owning module triggers the drift challenge._

**State classes**

| State class | Owning module | Persistence layer | Lifetime |
| --- | --- | --- | --- |
| <e.g., conversation history> | <module from §1> | <entity from data-architecture OR "ephemeral"> | <durable \| session \| request> |

**Drift challenge answered**

_"Does any state class lack an owning module from Section 1?"_

## 5. Surface Boundaries

_What the project's `surfaces` enum contains. The canonical floor is `[ui, api, agent, db, auth, infra]`; projects may add (e.g., `payments`) or omit (e.g., no `auth` if relying on a host system). Each declared surface is mapped to at least one module from Section 1._

**Surface declaration**

| Surface | In v1? | Modules carrying this surface | Deferred to |
| --- | --- | --- | --- |
| ui | yes/no | <module names> | <v2 \| later \| N/A> |
| api | ... | ... | ... |
| agent | ... | ... | ... |
| db | ... | ... | ... |
| auth | ... | ... | ... |
| infra | ... | ... | ... |
| <custom> | ... | ... | ... |

**Drift challenge answered**

_"Does any surface in the enum have no module from Section 1 mapped to it?"_

## Coherence check (end-of-atom)

_When the atom reaches terminal state, the agent re-runs all five drift challenges to ensure section-targeted edits did not silently break other sections. The coherence check is fatal — any unanswered challenge halts the commit._
