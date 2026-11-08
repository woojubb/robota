---
'@robota-sdk/agent-tools': minor
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-roundtable-robota': patch
---

The default tool set is now the Node-only `defaults` subpath of `@robota-sdk/agent-tools`: import `createDefaultTools` from `@robota-sdk/agent-tools/defaults`. It maps `browser: null` like `./node`, and the root and `./node` entries are unchanged. The exported names and signatures are unchanged, and a consumer's install does not grow: the subpath adds no dependency to the package. `@robota-sdk/agent-tool-defaults` no longer receives releases.
