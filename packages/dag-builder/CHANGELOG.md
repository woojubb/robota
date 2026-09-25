# @robota-sdk/dag-builder

## 0.1.0-beta.1

### Patch Changes

- 82736ee: Provider DIP Stage B (ARCH-PROVIDER-003), part 2: migrate the dag-cli consumer surface
  to the collapsed `llm-text` node and delete the five per-vendor LLM node packages + the
  router. DAG nodes now use `nodeType: 'llm-text'` with `config.provider` (single) or
  `config.providers[]` (multi-provider fallback). The `@robota-sdk/dag-node-llm-text-<vendor>`
  and `-router` packages are removed.
- Updated dependencies [eb71c83]
- Updated dependencies [fec722f]
- Updated dependencies [9fbab1b]
- Updated dependencies [caabd3c]
- Updated dependencies [6238e38]
- Updated dependencies [74bf844]
- Updated dependencies [5a46402]
  - @robota-sdk/dag-core@3.0.0-beta.61
