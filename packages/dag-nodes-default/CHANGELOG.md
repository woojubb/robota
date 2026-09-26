# @robota-sdk/dag-nodes-default

## 0.1.0-beta.2

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
- Updated dependencies [007fd90]
- Updated dependencies [18b52cc]
- Updated dependencies [9843fe6]
  - @robota-sdk/agent-core@3.0.0-beta.81
  - @robota-sdk/agent-framework@3.0.0-beta.81
  - @robota-sdk/agent-interface-command@3.0.0-beta.81
  - @robota-sdk/dag-node-llm-text@3.0.0-beta.65
  - @robota-sdk/dag-node-seedance-video@3.0.0-beta.65
  - @robota-sdk/dag-node-skill@3.0.0-beta.65
  - @robota-sdk/dag-node-text-to-image@3.0.0-beta.65
  - @robota-sdk/dag-node-tool@3.0.0-beta.65

## 0.1.0-beta.1

### Minor Changes

- 9eb7607: Provider DIP Stage C (ARCH-PROVIDER-004): extract the default DAG node catalog into a new
  entry-point-only `@robota-sdk/dag-nodes-default` aggregator. `@robota-sdk/dag-framework` no
  longer carries a hard dependency on any concrete node package — it loads the default catalog
  lazily (typed diagnostic on failure) or via injected `options.nodes` / `nodeRegistry`. The
  `createDefaultNodeRegistry` / `createDefaultNodeRegistrySync` functions moved out of
  `dag-framework` (no longer re-exported); import them from `@robota-sdk/dag-nodes-default`.

### Patch Changes

- d312755: Provider DIP Stage D (ARCH-PROVIDER-005): invert the skill node's dependency on the
  agent-framework assembly. New `ISkillExecutionPort` contract in
  `@robota-sdk/agent-interface-transport`; `@robota-sdk/agent-framework` exports
  `createSkillExecutionPort()`; `@robota-sdk/dag-node-skill` now requires an injected
  `skillPort` (via `ISkillNodeDefinitionOptions.skillPort`) and no longer depends on
  `agent-framework`. The concrete port is injected at the `dag-nodes-default` composition
  root. Closes ARL-11 (skill-half).

  BREAKING (@robota-sdk/dag-node-skill): `SkillNodeDefinition`/`SkillResolverRuntime` now
  require an injected `skillPort`; the no-arg `createSkillNodeDefinition()` factory is removed.

- Updated dependencies [9c19c50]
- Updated dependencies [7b6234c]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [08a9bd6]
- Updated dependencies [818f0c8]
- Updated dependencies [4eea54b]
- Updated dependencies [eb71c83]
- Updated dependencies [1698be4]
- Updated dependencies [9368d00]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [af2f2ad]
- Updated dependencies [267af5f]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [a5cc36e]
- Updated dependencies [d23c848]
- Updated dependencies [b70fa3d]
- Updated dependencies [2711ec6]
- Updated dependencies [4dd45cc]
- Updated dependencies [4c5148e]
- Updated dependencies [37af5dc]
- Updated dependencies [807d161]
- Updated dependencies [fec722f]
- Updated dependencies [e82215f]
- Updated dependencies [52b7346]
- Updated dependencies [2ebff01]
- Updated dependencies [2ebff01]
- Updated dependencies [2d3b2c0]
- Updated dependencies [b078afa]
- Updated dependencies [2d3b2c0]
- Updated dependencies [baa6863]
- Updated dependencies [2d3b2c0]
- Updated dependencies [3a8876b]
- Updated dependencies [4772067]
- Updated dependencies [7b85767]
- Updated dependencies [0f98419]
- Updated dependencies [64ba748]
- Updated dependencies [9fbab1b]
- Updated dependencies [d312755]
- Updated dependencies [a009f5b]
- Updated dependencies [1e3f91a]
- Updated dependencies [4f3c075]
- Updated dependencies [475e085]
- Updated dependencies [e477440]
- Updated dependencies [9dcb5da]
- Updated dependencies [a95ca85]
- Updated dependencies [b6d14ce]
- Updated dependencies [0382a51]
- Updated dependencies [93d061d]
- Updated dependencies [39554a1]
- Updated dependencies [d28430a]
- Updated dependencies [caabd3c]
- Updated dependencies [bed26ea]
- Updated dependencies [6238e38]
- Updated dependencies [fe48835]
- Updated dependencies [1e40b5b]
- Updated dependencies [74bf844]
- Updated dependencies [4b76cfa]
- Updated dependencies [d9bd9ec]
- Updated dependencies [8865acf]
- Updated dependencies [90e7a10]
- Updated dependencies [fcb0da3]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [9665c6e]
- Updated dependencies [44393be]
- Updated dependencies [c7fa299]
- Updated dependencies [5134b3b]
- Updated dependencies [dd444c1]
- Updated dependencies [1f57e7f]
- Updated dependencies [833afe1]
- Updated dependencies [d6b9404]
- Updated dependencies [7863b16]
- Updated dependencies [fde558e]
- Updated dependencies [db5c439]
- Updated dependencies [5a46402]
- Updated dependencies [4a01a87]
- Updated dependencies [cbee54e]
- Updated dependencies [9814afc]
- Updated dependencies [242a644]
  - @robota-sdk/agent-interface-command@3.0.0-beta.80
  - @robota-sdk/agent-framework@3.0.0-beta.80
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/dag-core@3.0.0-beta.61
  - @robota-sdk/dag-node-tool@3.0.0-beta.64
  - @robota-sdk/dag-node-skill@3.0.0-beta.64
  - @robota-sdk/dag-node-llm-text@3.0.0-beta.64
  - @robota-sdk/dag-node-seedance-video@3.0.0-beta.64
  - @robota-sdk/dag-node-text-to-image@3.0.0-beta.64
  - @robota-sdk/dag-node@3.0.0-beta.61
  - @robota-sdk/dag-node-image-loader@3.0.0-beta.61
  - @robota-sdk/dag-node-image-source@3.0.0-beta.61
  - @robota-sdk/dag-node-input@3.0.0-beta.61
  - @robota-sdk/dag-node-multi-input@3.0.0-beta.61
  - @robota-sdk/dag-node-ok-emitter@3.0.0-beta.61
  - @robota-sdk/dag-node-text-output@3.0.0-beta.61
  - @robota-sdk/dag-node-text-template@3.0.0-beta.61
  - @robota-sdk/dag-node-transform@3.0.0-beta.61
  - @robota-sdk/dag-node-utility-text@3.0.0-beta.61
