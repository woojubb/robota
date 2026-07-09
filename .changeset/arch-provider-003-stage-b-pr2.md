---
'@robota-sdk/dag-cli': minor
'@robota-sdk/dag-builder': patch
---

Provider DIP Stage B (ARCH-PROVIDER-003), part 2: migrate the dag-cli consumer surface
to the collapsed `llm-text` node and delete the five per-vendor LLM node packages + the
router. DAG nodes now use `nodeType: 'llm-text'` with `config.provider` (single) or
`config.providers[]` (multi-provider fallback). The `@robota-sdk/dag-node-llm-text-<vendor>`
and `-router` packages are removed.
