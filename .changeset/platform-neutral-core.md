---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-tools': minor
---

Make `agent-core`'s main entry platform-neutral and declare every package's runtime platform.

- `@robota-sdk/agent-core` no longer reaches Node from its main entry. `runHooks` runs only the executors it is given (pass `new CommandExecutor()` and `new HttpExecutor()` from `@robota-sdk/agent-core/node`); `resolveEnvReference`, `hasUsableSecretReference`, `normalizeProviderConfig`, `resolveMediaProviderConfig`, `createImageProviderFromDefinition` and `createVideoProviderFromDefinition` take a required resolver; `processEnvResolver`, `resolvePlatformShell`, `UnsupportedShellError`, `IPlatformShell`, `IPlatformShellResolutionRequest` and `TShellKind` moved to `@robota-sdk/agent-core/node`.
- Every export subpath that needs a Node host now maps `"browser": null`, so a browser bundler refuses it by name instead of failing on a Node built-in. `@robota-sdk/agent-tools` no longer ships a separate browser build: its main entry is Node-only until it becomes platform-neutral. ARCHITECTURE.md "Runtime platforms" lists which packages are platform-neutral, browser-only, or Node-only.
