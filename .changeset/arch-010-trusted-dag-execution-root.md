---
'@robota-sdk/agent-core': minor
'@robota-sdk/dag-core': major
'@robota-sdk/dag-worker': major
'@robota-sdk/dag-framework': major
'@robota-sdk/dag-cli': major
'@robota-sdk/dag-node-tool': minor
'@robota-sdk/dag-node-file-read': minor
'@robota-sdk/dag-node-file-write': minor
'@robota-sdk/dag-node-skill': major
'@robota-sdk/agent-command-workflows': patch
'@robota-sdk/dag-mcp-server': patch
'@robota-sdk/dag-runtime-server': patch
---

Carry a trusted canonical absolute execution root from DAG product composition through worker task
input and node lifecycle context. Filesystem-capable DAG nodes now use that injected authority instead
of ambient `process.cwd()`, and authored `cwd` values may only narrow it.

BREAKING: `ITaskExecutionInput`, `INodeExecutionContext`, worker composition dependencies,
`LocalDagRuntimeProvider`, and the CLI-local runner now require an execution root at their non-convenience
boundaries. `createDagFramework()` preserves no-argument construction by validating and capturing its
current directory at the factory boundary. The filesystem-backed skill node is explicitly Node-only and
no longer advertises a browser export condition.
