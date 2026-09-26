# SPEC: agent-tool-defaults

## Purpose

Composition leaf that assembles the SDK's own built-in default tool set — the tools every product
session gets when its composition root supplies no tool list of its own. Two entries are
conditional on an adapter the caller supplies (a retrieval adapter and a computer driver); there is
no host fallback for either, so an absent adapter means an absent tool rather than a silently
degraded one.

This package composes exactly one lower-layer package (`agent-tools`); it does not bundle
sibling `agent-tool-*` packages. It is a defaults leaf, meant to be imported only at composition
roots — not something a mid-layer assembly library owns, publishes, and self-consumes.

The framework package still offers this tier to zero-config consumers, but reaches it only through
a dynamic import, never statically and never by re-export — a re-export would restore a direct
dependency this package's extraction was meant to remove.

## Contract and guarantees

- `cwd` is a required option: it is the execution root every host file tool is contained by. File
  tools routed to a sandbox with its own filesystem hand their paths to that sandbox, where `cwd`
  does not confine them. A context-free tool construction is the shape of bug this package's
  contract exists to prevent.
- The function is pure and side-effect-free at construction: the same options always produce the
  same tool list, with no registry, no lazy initialization, and no I/O performed while assembling
  it.
- Every tool this tier returns is resident (no deferred loading) — the tier is small enough that
  deferring any of it would be a net loss rather than a saving, and it alone satisfies the
  "at least one resident tool" invariant owned by `agent-core` whenever the tier is present.
  Tool-search itself is not part of this tier; it is added only by session assembly, and only when
  the assembled set actually contains a deferred tool.
- The package throws nothing of its own — it has no runtime validation branch and no I/O. Failures
  a caller sees at use time (e.g. path-containment refusals) come from the tools themselves.

## Non-goals / boundaries

- Does not implement any tool itself — every factory it calls is owned by `agent-tools`.
- Must never import `agent-framework` or any higher layer; the dependency runs the other way.
- Does not decide when a session should decline the default tier — that is the caller's decision,
  expressed by passing its own tool set instead.
- Provides no extension point (no registry, merge, or override) on this package itself. A caller
  that wants a different or additional surface composes it at the composition root rather than
  configuring this package.

## Design decisions

- No plug-in seam was added here deliberately: doing so would recreate the library-level authority
  over a product-level tool decision that this package's extraction was meant to remove.
- The one type this package owns is a parameter object describing what the caller must supply, not
  a domain concept; every type it references is owned and exported by its owner package instead of
  being re-exported here, so this package never becomes a second name for someone else's contract.
