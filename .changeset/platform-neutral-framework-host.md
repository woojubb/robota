---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-product': minor
'@robota-sdk/agent-subagent-runner': minor
'@robota-sdk/agent-ui-terminal': minor
---

Add the framework host and make `host` and `cwd` required wherever the framework builds a session. The host is passed and accepted but nothing reads it yet, so behaviour is unchanged.

- `@robota-sdk/agent-framework`: `IFrameworkHost` lists what a platform lends the framework (home directory, workspace resolver, path canonicalizer, exit flush, environment, files, git, git remotes, hook executors, background task runners, default tools, observer failure report, async scope, project mutation support). Every member is optional and an absent one means the capability is off, so `{}` is a valid host. `IAsyncScope` is the port behind `createAsyncScope`.
- `@robota-sdk/agent-framework/node` (new, `"browser": null`) exports `createNodeFrameworkHost({ createDefaultTools })`, which fills every member for a Node process. The composition root names `createDefaultTools` from `@robota-sdk/agent-tool-defaults`; pass `() => []` for sessions with no default tier. `@robota-sdk/agent-framework/testing` exports `createTestFrameworkHost(overrides?)`, the same host with the real default tools, where an override replaces a member and an explicit `undefined` removes it.
- `host` is required on `InteractiveSession` (both construction shapes, so on `buildRuntimeSession` and `startRuntimeHost` too), `createSession`, `createSubagentSession`, `createQuery`, `createAgentRuntime` and `createStatelessRuntime`, and on the options of `createInteractiveRuntime`, `createProgrammaticAgent`, `HeadlessInteractionChannel` and an in-process subagent runner. A missing `host` throws at construction, naming `createNodeFrameworkHost`.
- `cwd` is required, and absolute as it already had to be, on `createSession`, `createQuery`, `createStatelessRuntime` and an injected-session `InteractiveSession`. The `process.cwd()` fallback is gone: a caller that relied on it passes `process.cwd()` itself.
- `@robota-sdk/agent-cli`: `startCliCore` takes the host as its second argument and `runPrintMode` as its second after the product runtime; `startCli` and the headless entry build it with `createNodeFrameworkHost`. `IRunEvalDeps.host` is required unless `runFn` is given.
- `@robota-sdk/agent-subagent-runner`: `ISubagentWorkerComposition.host` is required; the worker builds its child session on it, and the product's composition supplies it.
- `@robota-sdk/agent-ui-terminal`: `IRenderOptions` and `ITuiInteractionChannelOptions` take `host`.
- `@robota-sdk/agent-command`, `@robota-sdk/agent-product`: their tests and scenario scripts pass a host; no published surface changes.
