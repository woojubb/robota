---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-executor': patch
'@robota-sdk/agent-provider-anthropic': patch
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-provider-gemini': patch
'@robota-sdk/agent-provider-openai-compatible': patch
'@robota-sdk/agent-provider-defaults': patch
'@robota-sdk/dag-core': patch
'@robota-sdk/dag-node-llm-text': minor
'@robota-sdk/dag-framework': minor
---

Provider DIP Stage B (ARCH-PROVIDER-003), part 1: collapse infrastructure. Adds the
provider-registry-driven `@robota-sdk/dag-node-llm-text` node that supersedes the
per-vendor LLM nodes + router, relocates the provider config resolver into
`agent-core`, adds SSOT cost/allowedModels fields, inverts the `llm-text` validator
tombstone, and wires `createDagFramework({ providers })`. Additive — the per-vendor
nodes still exist; consumer migration + their removal follow in part 2.
