---
'@robota-sdk/agent-preset': patch
'@robota-sdk/dag-framework': minor
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-provider-anthropic': patch
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-provider-gemini': patch
---

- External presets accept every permission mode a session does, `auto` included; `auto` used to fail validation.
- `createDagFramework({ ports: { costMeta } })` wires cost-metadata management; without it cost operations still report that they are unsupported.
- `startCli()` runs the subagent worker when a subagent starts the embedder's entry script again, as the `robota` executable already did; an embedded CLI used to start a second CLI there.
- The provider `executor` option docs no longer import a `RemoteExecutor` that does not exist, and `IRemoteExecutorConfig` is marked deprecated: nothing implements a remote executor.
