---
'@robota-sdk/agent-tools': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-preset': minor
'@robota-sdk/agent-product': minor
'@robota-sdk/agent-cli': minor
---

Make the main entries of `@robota-sdk/agent-tools`, `@robota-sdk/agent-framework`, `@robota-sdk/agent-command`, `@robota-sdk/agent-preset` and `@robota-sdk/agent-product` platform-neutral. They run unchanged in a browser, a Web Worker, Node, Deno and Bun, and no longer map `"browser": null` on `.`. Every package is now in exactly one of ARCHITECTURE.md's three platform lists; the "Not yet neutral" list is gone.

- `@robota-sdk/agent-tools` no longer re-exports `GrepIsolationError`, `ReadByteLimitError`, `ReadCancelledError`, `createBashTool`, `createEditTool`, `createGlobTool`, `createGrepTool`, `createReadTool`, `createShellTool`, `createWriteTool` and `webFetchTool` from its main entry. They are on `@robota-sdk/agent-tools/node` only, which is where `@robota-sdk/workflows` 0.0.4 imports them.
- The five packages build once into `dist` (not `dist/node`) and their `exports` map `import` and `require` only. A Node-only subpath keeps `"browser": null`: `./node` on `agent-tools`, `agent-framework`, `agent-command` and `agent-preset`, and `./testing` on `agent-framework`. Specifiers and the code behind them are unchanged; only a deep import of `dist/node/*` breaks.
- `/user-local` and `executeUserLocalDirectCommand` read and write their storage root through an injected file system, as `/doctor` does through `doctorDeps`: `createUserLocalCommandModule(storageRoot, fsAsync)`, the `userLocalFileSystem` option of `createDefaultCommandModules` and the `fsAsync` option of `executeUserLocalDirectCommand`. They no longer import `NodeFileSystemAsync` themselves, and absent a file system the command is listed and answers that it is unavailable on this host; nothing is read or written.
- `@robota-sdk/agent-cli` passes `new NodeFileSystemAsync()` from `@robota-sdk/agent-framework/node` for both, so `/user-local` and `agent user-local` behave as before.
