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

A canonical usage observation may also carry an optional prompt-execution root identity, UTC
start/end times, and first-callback outcome. These describe only the prompt call through its first
terminal callback, not final turn settlement. A separate provider-call entry can carry a content-free
child span with explicit root linkage, actual times, round and outcome; no tool child is implied. The first-callback
outcome may differ from the observation's later turn outcome. Older observations without them remain valid;
the identity carries no prompt, response, tool, user, or session content.

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
failure — an unpriced model yields `unknown` and no `costUsd`, and that is a normal outcome.
