# Default DAG Node Catalog Specification

## Scope

- Owns the **default node catalog composition** for the Robota DAG framework (ARCH-PROVIDER-004 / Stage C).
- Exports `createDefaultNodeRegistrySync()` (the SDK-free base node set) and `createDefaultNodeRegistry()`
  (the full async catalog: base set + the collapsed `llm-text` node bound to an injected/lazy provider
  registry + lazily-loaded optional media/skill nodes).
- Is a **composition aggregator, entry-point-only** — imported only at composition roots (apps, CLI,
  command/MCP entry packages), never by a library-internal `src` of a mid-layer package.

## Boundaries

- Depends on the concrete node packages (`@robota-sdk/dag-node-*`) + `@robota-sdk/dag-node` (assembly base) +
  `@robota-sdk/dag-core`/`agent-core` contracts. It does NOT depend on `@robota-sdk/dag-framework` (one-way:
  the framework lazy-loads this package, not the reverse).
- The default provider set for the `llm-text` node is loaded lazily from `@robota-sdk/agent-provider-defaults`
  (optional dependency); a load failure surfaces a **typed diagnostic naming the missing package**, never a
  silent empty registry. Optional media/skill nodes (gemini-image-edit, text-to-image, seedance-video, skill)
  are dynamically imported and silently skipped when their optional SDK peer is absent (`// allow-fallback`).
- This is an aggregator ABOVE the `@robota-sdk/dag-node-*` leaf layer; the plural `dag-nodes-` prefix
  intentionally diverges from the singular `dag-node-` leaf prefix, so the leaf-invariant scan
  (`checkDagNodesLeaf`) does not police its sibling node dependencies.

## Architecture Overview

- `createDefaultNodeRegistrySync()` — constructs the base nodes that have no optional provider-SDK peer
  dependency (input, multi-input, transform, text-template, text-output, image-loader, image-source,
  ok-emitter, tool, and the utility-text family).
- `createDefaultNodeRegistry(providers?, loadDefaults?)` — the base set + `LlmTextNodeDefinition(providers ??
await loadDefaults())` + the dynamically-loaded optional media/skill nodes.
- `loadDefaultProviderDefinitions` — the lazy provider-set loader with the typed diagnostic.

## Type Ownership

| Type/Symbol                     | Location       | Purpose                                        |
| ------------------------------- | -------------- | ---------------------------------------------- |
| `createDefaultNodeRegistrySync` | `src/index.ts` | SDK-free base node set                         |
| `createDefaultNodeRegistry`     | `src/index.ts` | Full async default catalog                     |
| `TProviderDefinitionLoader`     | `src/index.ts` | Lazy provider-set loader signature (test seam) |

## Public API Surface

| Export                          | Kind     |
| ------------------------------- | -------- |
| `createDefaultNodeRegistrySync` | function |
| `createDefaultNodeRegistry`     | function |
| `TProviderDefinitionLoader`     | type     |

## Extension Points

- Adding/removing a default node = editing this package's `createDefaultNodeRegistry(Sync)`, not the framework.
- Consumers that want a custom catalog inject `createDagFramework({ nodes })` and do not load this package.

## Error Taxonomy

| Condition                                   | Behavior                                                          |
| ------------------------------------------- | ----------------------------------------------------------------- |
| default provider set cannot load (SDK gone) | throws a typed Error naming `@robota-sdk/agent-provider-defaults` |
| optional media/skill SDK peer absent        | node silently skipped (`// allow-fallback`), catalog still builds |

## Test Strategy

`src/index.test.ts` (moved from `dag-framework`) covers the sync base set, the async catalog incl. the
collapsed `llm-text` node, provider injection vs lazy default, the partial-install typed diagnostic, and the
optional-loader skip paths — with stubbed providers/mocked dynamic imports (no real provider call).
