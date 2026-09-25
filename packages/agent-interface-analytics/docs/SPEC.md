# SPEC.md — @robota-sdk/agent-interface-analytics

## Scope

This package owns the **usage and run-trace contracts**: how many tokens a turn consumed, what it
cost, which execution unit, model, provider, and product surface it is attributed to, the per-turn
timeline a trace view renders, and the provider-neutral cross-session personal-usage report shape.

It contains type declarations only. No class, no runtime logic, no mechanism, no runtime value
export — there is no vocabulary or discriminators at runtime.

## Boundaries

| Concern                                       | Owner                               |
| --------------------------------------------- | ----------------------------------- |
| Assembling a report from recorded usage       | `agent-session-analytics`           |
| Recording usage as a turn completes           | `agent-framework`                   |
| Model pricing, and computing a turn's cost    | `agent-core`                        |
| Carrying a report across the sidecar boundary | `agent-transport`                   |
| Rendering a trace or cost view                | `agent-ui-terminal`, `agent-ui-web` |
| Session, turn and interaction contracts       | `agent-interface-session`           |

**This package declares the SHAPE of a measurement. It measures nothing and decides no policy** — not
what counts as a turn, not how cost is derived, not what a report should contain.

A canonical usage observation may also carry an optional prompt-execution root identity, describing
only the prompt call through its first terminal callback, not final turn settlement — that
first-callback outcome may later differ from the observation's turn outcome. Related child-span
entries (provider-call, tool-body) carry the same root linkage and timing. A provider-call child may
also carry only attested usage evidence for a table-derived cost estimate. No entry ever carries prompt,
response, tool, user, or session content.

A bounded live prompt-trace projection exposes only this execution evidence, plus correlation IDs
that are validated or opaque: a tool-call ID that joins tool children to live-only
permission-decision children, and a provider-returned request ID on an invoked provider-call child.
The provider-call child's request-ID field is live-projection-only: it is never written to the persisted
provider-call trace and never becomes a metric (the same value reaches assistant-message metadata
and live traces and logs by separate routes). None of
these entries represents final turn settlement, a cost total, detached-work completion, or collector
receipt. Older observations without the root identity remain valid. Opt-in prompt, response and tool
text never joins that projection: it has its own content batch, linked only by the prompt's trace
and root span IDs (and a tool item by its call's tool span when the trace kept one), so a consumer
that never asks for content never holds any.

**Zero dependencies by design.** Every field of every declaration here is a primitive or another
declaration in this package, so it depends on nothing at all — not even `agent-core`. It is the only
contract package in this family with no dependencies, and that is a property worth keeping: the
moment one of these types needs a foreign type, the boundary has moved.

Composition runs downward into it: consumers name this package's types, this package names no
session, turn, or transport type.

## Extension Points

None by design. A consumer needing a different projection declares it in its own package and states
how it relates to the types here.

## Error Taxonomy

This package declares no error type and throws nothing. `IUsageSnapshot.costStatus` distinguishes
`unknown` / `estimated` / `exact`, which is a statement about **confidence in a measurement**, not a
failure — local price-table calculations are estimates even for an exact model ID, while an unpriced
model yields `unknown` and no `costUsd`.
