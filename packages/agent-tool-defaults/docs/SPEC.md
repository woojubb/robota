# SPEC: agent-tool-defaults

## Overview

Composition leaf that aggregates the built-in tool set. `createDefaultTools()` returns the ten
always-present tools — Shell, Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch,
AskUserQuestion — and gates two more on the adapters the caller supplies: `CodebaseRetrieval` when a
`retrievalAdapter` is given (SELFHOST-003), and the Computer tools when a `computerDriver` is
(SELFHOST-010). There is no host fallback for either; absent adapter means absent tool.

ARCH-035 moved this out of `@robota-sdk/agent-framework`. It is a defaults aggregator, and
`.agents/project-structure.md` classifies that family as a composition leaf "imported only at
composition roots (entry-point-only)" — not something a mid-layer assembly library owns, publishes and
self-consumes.

**The move is what carries the guarantee.** `agent-subagent-runner` legitimately depends on
`agent-framework`, so while the aggregator was on that barrel a neutral runner could compose the
product's tool surface and only a scan stood in the way. It has no manifest edge to THIS package, so
the same import is now `TS2307` — the identical shape ARCH-021 achieved on the provider axis with
`@robota-sdk/agent-builtin-providers`.

`agent-framework` still offers the tier to zero-config consumers (`createQuery` and the headless
runtime have no `defaultTools` seam, and the published contract in its README says the built-in tools
are assembled for SDK sessions). It reaches this package by dynamic `import()` only, never statically
and never by re-export — a re-export would restore the closed route and STRUCT-07 bans it
independently.

## Package Identity

- **npm name**: `@robota-sdk/agent-tool-defaults`
- **Layer**: composition leaf (depends on `agent-core` and `agent-tools` only; never imports from `agent-framework`, `agent-session`, `agent-command`, or `agent-transport`)
- **SDK**: (none directly — composes the tool factories)
- **Platform**: node

## Public API

Every runtime export of the package entry (`src/index.ts`).

| Symbol                       |
| ---------------------------- |
| `createDefaultTools`         |
| `ICreateDefaultToolsOptions` |

`cwd` is REQUIRED on the options (ARCH-010): it is the execution root every file tool is contained
by, and a context-free tool is how a subagent `Read` once returned `/etc/hostname`.

## Dependencies

| Package                   | Role                                                          |
| ------------------------- | ------------------------------------------------------------- |
| `@robota-sdk/agent-core`  | `IToolWithEventService`                                       |
| `@robota-sdk/agent-tools` | every tool factory this package assembles, and its port types |

## Circular Dependency Policy

This package depends on `@robota-sdk/agent-core` and `@robota-sdk/agent-tools` only.
`agent-framework` and all higher-layer packages must never be imported — the dependency runs the other
way, and reversing it is the defect this package exists to prevent.

## Consumers

Import it at a composition root. `@robota-sdk/agent-framework` reaches it through a dynamic `import()`
so it takes no static edge; `@robota-sdk/pack-coding` consumes the always-present subset as the
product's tool tier. `scripts/harness/check-dependency-direction.mjs` (Rule 8, `GUARDED_AGGREGATORS`)
holds the entry-point-only property, and a new sanctioned importer is a deliberate decision.

## Build Output Contract

```
dist/
└── node/
    └── index.js / index.cjs / index.d.ts   # root export
```

## Scope

Assembling the default tool set, and nothing else. This package decides WHICH tools a zero-config
session gets and under what condition each appears. It does not implement a tool — every factory it
calls belongs to `@robota-sdk/agent-tools` — and it holds no session, product, or provider concern.

## Boundaries

- **In:** the default list; its order; the adapter gating that decides whether `CodebaseRetrieval` and
  the Computer tools are present; the `cwd` containment contract every file tool inherits.
- **Out:** tool implementations (`agent-tools`), session assembly (`agent-framework`), the product's
  own tool surface (`pack-coding` and the profile that composes it), sandboxing policy, and any
  decision about WHEN a session should decline the default tier — that is the caller's, expressed by
  passing its own set.
- **Never:** an import from `agent-framework` or above. The dependency runs the other way, and
  reversing it is the defect this package exists to prevent.

## Architecture Overview

One pure function over factories. `createDefaultTools(options)` calls the `agent-tools` factories in a
fixed order and returns `IToolWithEventService[]`. There is no state, no IO at construction, no
registry, and no lazy initialisation — the same options always produce the same list.

Two of the twelve possible entries are conditional, and both are gated on a PORT the caller supplies
rather than on configuration: `retrievalAdapter` produces `CodebaseRetrieval` (SELFHOST-003) and
`computerDriver` produces the Computer tools (SELFHOST-010). Neither has a host fallback — absent
adapter means absent tool, deliberately, because a library-side "local" default for either would be a
capability the caller never granted.

## Type Ownership

This package owns exactly one type, `ICreateDefaultToolsOptions`, and it is a parameter object — it
describes what the caller must supply, not a domain concept.

Everything it references is owned elsewhere and imported: `IToolWithEventService` from
`@robota-sdk/agent-core`; `ISandboxClient`, `IRetrievalAdapter` and `IComputerDriver` from
`@robota-sdk/agent-tools`. None is re-exported — a consumer that needs one imports it from its owner,
which is what keeps this package from becoming a second name for someone else's contract (STRUCT-07).

## Public API Surface

| Symbol                       | Kind     | Contract                                                                             |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `createDefaultTools`         | function | Returns the default tool list for one execution root. Pure; safe to call repeatedly. |
| `ICreateDefaultToolsOptions` | type     | Its parameter object. `cwd` is REQUIRED (ARCH-010); the three ports are optional.    |

Nothing else is exported, and the barrel exists to keep it that way.

## Extension Points

There is deliberately **no** extension point on this package — no registry, no merge, no override.
Extension happens at the composition root, which decides between this list and its own: session
assembly takes a caller-supplied set that REPLACES this tier outright, and a product that owns its
tool surface passes its own (`robota` passes an empty set and composes from `pack-coding`).

Adding a plug-in seam here would recreate the problem ARCH-035 removed — a library-level authority
over a product-level decision.

## Error Taxonomy

This package throws nothing of its own. It has no IO, no validation branch, and no failure mode: the
one required field is enforced by the type system rather than at runtime, because a missing `cwd`
should never reach execution.

Errors a caller may still see come from the tools themselves, at USE time, and belong to
`@robota-sdk/agent-tools` — path-containment refusals from the file tools being the ones most likely
to be mistaken for a fault here. They are not: containment is enforced by the tool, using the `cwd`
this package threaded into it.

## Test Strategy

Unit only; no integration surface exists to test. The suite asserts the exact list and its order, that
a sandbox client does not change the list, and that each adapter adds exactly its own tool and nothing
else — the last is the case that matters, because a gate that adds one tool too many is how a
capability the caller never granted reaches a model.

The tool BEHAVIOURS are not retested here; they belong to `agent-tools` and duplicating them would
create a second place to update when one changes.

## User-Facing Contract

Consumers of `@robota-sdk/agent-framework` reach this package's output without naming it: a session
constructed without an explicit tool set receives this list. That is the contract the framework's
README states, and preserving it is why ARCH-035 extracted this package rather than deleting the tier.

A consumer that wants a different surface supplies its own set at the composition root; a consumer
that wants THIS surface plus more imports this package directly and appends.

## Class Contract Registry

None. This package exports no class and constructs none — it is one function over factories, and a
class here would be state where none is needed.
