# @robota-sdk/dag-runtime-server

## 3.0.0-beta.4

### Patch Changes

- fec722f: Carry a trusted canonical absolute execution root from DAG product composition through worker task
  input and node lifecycle context. Filesystem-capable DAG nodes now use that injected authority instead
  of ambient `process.cwd()`, and authored `cwd` values may only narrow it.

  BREAKING: `ITaskExecutionInput`, `INodeExecutionContext`, worker composition dependencies,
  `LocalDagRuntimeProvider`, and the CLI-local runner now require an execution root at their non-convenience
  boundaries. `createDagFramework()` preserves no-argument construction by validating and capturing its
  current directory at the factory boundary. The filesystem-backed skill node is explicitly Node-only and
  no longer advertises a browser export condition.

- Updated dependencies [eb71c83]
- Updated dependencies [0214ff8]
- Updated dependencies [792b726]
- Updated dependencies [a58fc4b]
- Updated dependencies [fec722f]
- Updated dependencies [9fbab1b]
- Updated dependencies [82736ee]
- Updated dependencies [9eb7607]
- Updated dependencies [caabd3c]
- Updated dependencies [6238e38]
- Updated dependencies [cd848eb]
- Updated dependencies [74bf844]
- Updated dependencies [a0eac8f]
- Updated dependencies [34768aa]
- Updated dependencies [5a46402]
- Updated dependencies [78dcc65]
  - @robota-sdk/dag-core@3.0.0-beta.61
  - @robota-sdk/dag-framework@1.0.0-beta.4
  - @robota-sdk/dag-builder@0.1.0-beta.1
  - @robota-sdk/dag-api@3.0.0-beta.61
  - @robota-sdk/dag-cost@3.0.0-beta.61
  - @robota-sdk/dag-orchestration-client@3.0.0-beta.61

## 3.0.0-beta.3

### Patch Changes

- @robota-sdk/dag-framework@0.1.0-beta.3

## 3.0.0-beta.2

### Patch Changes

- @robota-sdk/dag-framework@0.1.0-beta.2

## 3.0.0-beta.1

### Patch Changes

- @robota-sdk/dag-framework@0.1.0-beta.1
