# @robota-sdk/dag-node-tool

## 3.0.0-beta.64

### Minor Changes

- fec722f: Carry a trusted canonical absolute execution root from DAG product composition through worker task
  input and node lifecycle context. Filesystem-capable DAG nodes now use that injected authority instead
  of ambient `process.cwd()`, and authored `cwd` values may only narrow it.

  BREAKING: `ITaskExecutionInput`, `INodeExecutionContext`, worker composition dependencies,
  `LocalDagRuntimeProvider`, and the CLI-local runner now require an execution root at their non-convenience
  boundaries. `createDagFramework()` preserves no-argument construction by validating and capturing its
  current directory at the factory boundary. The filesystem-backed skill node is explicitly Node-only and
  no longer advertises a browser export condition.

### Patch Changes

- Updated dependencies [7b6234c]
- Updated dependencies [4eea54b]
- Updated dependencies [2345c0b]
- Updated dependencies [eb71c83]
- Updated dependencies [118fe0e]
- Updated dependencies [240777e]
- Updated dependencies [718bdf5]
- Updated dependencies [1698be4]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [267af5f]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [d23c848]
- Updated dependencies [807d161]
- Updated dependencies [fec722f]
- Updated dependencies [2d3b2c0]
- Updated dependencies [4772067]
- Updated dependencies [9fbab1b]
- Updated dependencies [a009f5b]
- Updated dependencies [61db70f]
- Updated dependencies [db80aba]
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
- Updated dependencies [6238e38]
- Updated dependencies [74bf844]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [833afe1]
- Updated dependencies [d6b9404]
- Updated dependencies [5a46402]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/agent-tools@3.0.0-beta.80
  - @robota-sdk/dag-core@3.0.0-beta.61
  - @robota-sdk/dag-node@3.0.0-beta.61

## 3.0.0-beta.63

### Patch Changes

- @robota-sdk/agent-tools@3.0.0-beta.79

## 3.0.0-beta.62

### Patch Changes

- @robota-sdk/agent-tools@3.0.0-beta.78
