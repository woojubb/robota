# Default DAG Node Catalog Specification

## Purpose

Owns the default node catalog composition for the Robota DAG framework. Exports
`createDefaultNodeRegistrySync()` (the base node set used by CLI `/workflows`) and
`createDefaultNodeRegistry()` (a private workspace async catalog: base set + the collapsed
`llm-text` node bound to an injected/lazy provider registry + dynamically loaded media/skill
nodes). The async catalog is not a supported entry point in a clean CLI installation.

Is a **composition aggregator** — imported statically only at composition roots (apps, CLI,
command/MCP entry packages). `dag-framework` may lazy-load it from library-internal source when a
caller does not inject a node registry.

## Contract

- `createDefaultNodeRegistrySync()` constructs only nodes with no optional provider-SDK peer
  dependency, so it always succeeds to construct.
- `createDefaultNodeRegistry(providers?, loadDefaults?)` adds the LLM node plus dynamically-loaded
  optional media/skill nodes on top of the sync base set.
- The default provider set for the `llm-text` node is loaded lazily from
  `@robota-sdk/agent-builtin-providers` (an optional dependency); a load failure surfaces a
  diagnostic naming that package rather than falling back to a silent empty registry.
- The async media/skill loaders skip a node after any import or construction failure, not only a
  missing optional package. Callers that require a particular node must inject it explicitly
  instead of relying on that fallback.

## Non-goals

- Does NOT depend on `@robota-sdk/dag-framework` — the dependency is one-way; the framework
  lazy-loads this package, not the reverse.
- Not the place to build a custom catalog: consumers that want one inject
  `createDagFramework({ nodes })` and skip this package entirely.

## Design decisions

- The plural `dag-nodes-` prefix (vs. singular `dag-node-` leaves) marks this package as an
  aggregator sitting above the leaf node packages; its dependencies on sibling node packages are
  intentional, not a layering violation.
