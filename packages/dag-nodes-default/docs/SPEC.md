# Default DAG Node Catalog Specification

## Scope

- Owns the **default node catalog composition** for the Robota DAG framework (ARCH-PROVIDER-004 / Stage C).
- Exports `createDefaultNodeRegistrySync()` (the 23-node base set used by CLI `/workflows`) and
  `createDefaultNodeRegistry()` (a private workspace async catalog: base set + the collapsed
  `llm-text` node bound to an injected/lazy provider registry + dynamically loaded media/skill
  nodes). The async catalog is not a supported entry point in a clean CLI installation.
- Is a **composition aggregator** — imported statically only at composition roots (apps, CLI,
  command/MCP entry packages). `dag-framework` may lazy-load it from library-internal source when
  a caller does not inject a node registry.

## Boundaries

- Depends on the concrete node packages (`@robota-sdk/dag-node-*`) + `@robota-sdk/dag-node` (assembly base) +
  `@robota-sdk/dag-core`/`agent-core` contracts. It does NOT depend on `@robota-sdk/dag-framework` (one-way:
  the framework lazy-loads this package, not the reverse).
- The default provider set for the `llm-text` node is loaded lazily from
  `@robota-sdk/agent-builtin-providers` (optional dependency); a load failure surfaces a diagnostic
  naming that package, never a silent empty registry. The async media/skill loaders currently skip a
  node after any import or construction failure, not only a missing optional package. Callers that
  require a particular node must inject it explicitly instead of relying on that fallback.
- This is an aggregator ABOVE the `@robota-sdk/dag-node-*` leaf layer; the plural `dag-nodes-` prefix
  distinguishes its composition role from singular `dag-node-` leaves. Its dependencies on sibling
  node packages are intentional. No leaf-invariant scan currently runs.

## Architecture Overview

- `createDefaultNodeRegistrySync()` — constructs the base nodes that have no optional provider-SDK peer
  dependency (input, multi-input, transform, text-template, text-output, image-loader, image-source,
  ok-emitter, tool, and the utility-text family).
- `createDefaultNodeRegistry(providers?, loadDefaults?)` — the base set + `LlmTextNodeDefinition(providers ??
await loadDefaults())` + the dynamically-loaded optional media/skill nodes.
- `loadDefaultProviderDefinitions` — the lazy provider-set loader with the typed diagnostic.

## Type Ownership

| Type/Symbol                      | Location       | Purpose                                                     |
| -------------------------------- | -------------- | ----------------------------------------------------------- |
| `createDefaultNodeRegistrySync`  | `src/index.ts` | SDK-free base node set                                      |
| `createDefaultNodeRegistry`      | `src/index.ts` | Full async default catalog                                  |
| `TProviderDefinitionLoader`      | `src/index.ts` | Lazy provider-set loader signature (test seam)              |
| `TMediaProviderDefinitionLoader` | `src/index.ts` | Lazy media-provider definition loader signature (test seam) |

## Public API Surface

| Export                           | Kind     |
| -------------------------------- | -------- |
| `createDefaultNodeRegistrySync`  | function |
| `createDefaultNodeRegistry`      | function |
| `TProviderDefinitionLoader`      | type     |
| `TMediaProviderDefinitionLoader` | type     |

## Extension Points

- Adding/removing a default node = editing this package's `createDefaultNodeRegistry(Sync)`, not the framework.
- Consumers that want a custom catalog inject `createDagFramework({ nodes })` and do not load this package.

## Error Taxonomy

| Condition                                   | Behavior                                                          |
| ------------------------------------------- | ----------------------------------------------------------------- |
| default provider set cannot load (SDK gone) | throws an Error naming `@robota-sdk/agent-builtin-providers`      |
| media/skill import or construction fails    | node silently skipped (`// allow-fallback`), catalog still builds |

## Test Strategy

`src/index.test.ts` covers the sync base set, the source-built async catalog including collapsed
`llm-text`, provider injection versus lazy default, and a failed default provider loader. Its
"optional loading" tests exercise the success path; they do not simulate a missing node package or a
constructor failure. A one-off clean CLI tarball check on 2026-09-24 observed the supported 23-node
`/workflows` catalog; this is not an automated test in this package.
