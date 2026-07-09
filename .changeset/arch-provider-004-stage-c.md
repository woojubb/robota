---
'@robota-sdk/dag-nodes-default': minor
'@robota-sdk/dag-framework': minor
'@robota-sdk/agent-command-workflows': patch
'@robota-sdk/dag-cli': patch
'@robota-sdk/dag-mcp-server': patch
---

Provider DIP Stage C (ARCH-PROVIDER-004): extract the default DAG node catalog into a new
entry-point-only `@robota-sdk/dag-nodes-default` aggregator. `@robota-sdk/dag-framework` no
longer carries a hard dependency on any concrete node package — it loads the default catalog
lazily (typed diagnostic on failure) or via injected `options.nodes` / `nodeRegistry`. The
`createDefaultNodeRegistry` / `createDefaultNodeRegistrySync` functions moved out of
`dag-framework` (no longer re-exported); import them from `@robota-sdk/dag-nodes-default`.
