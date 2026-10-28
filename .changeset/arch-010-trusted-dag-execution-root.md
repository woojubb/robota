---
'@robota-sdk/agent-core': minor
---

Carry a trusted canonical absolute execution root from DAG product composition through worker task
input and node lifecycle context. Filesystem-capable DAG nodes now use that injected authority instead
of ambient `process.cwd()`, and authored `cwd` values may only narrow it.

BREAKING: `ITaskExecutionInput`, `INodeExecutionContext`, worker composition dependencies,
`LocalDagRuntimeProvider`, and the CLI-local runner now require an execution root at their non-convenience
boundaries. `createDagFramework()` preserves no-argument construction by validating and capturing its
current directory at the factory boundary. The filesystem-backed skill node is explicitly Node-only and
no longer advertises a browser export condition.
