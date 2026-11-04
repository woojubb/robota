---
'@robota-sdk/agent-tools': minor
'@robota-sdk/agent-tool-defaults': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': minor
---

Split `@robota-sdk/agent-tools` into a platform-neutral main entry and a Node-only `@robota-sdk/agent-tools/node`.

- `@robota-sdk/agent-tools/node` (new, `"browser": null`) holds what touches a host: `createShellTool`, `createBashTool`, `createReadTool`, `ReadByteLimitError`, `ReadCancelledError`, `createWriteTool`, `createEditTool`, `createGlobTool`, `createGrepTool`, `GrepIsolationError`, `webFetchTool`, `createWebFetchTool`, `DEFAULT_OS_SANDBOX_SETTINGS`, `detectOsSandbox`, `OsSandboxClient`, `bubblewrapArguments`, `protectedWorkspaceEntries`, `seatbeltProfile`, their option and status types, and the new `createNodeWorkspaceHostFiles`. `fast-glob`, `@robota-sdk/agent-process` and `@robota-sdk/agent-file-authority` are reached only from it. Import these from `/node`.
- The main entry keeps `createFunctionTool`, `createZodFunctionTool`, `createAskUserQuestionTool`, `createToolSearchTool`, `matchDeferredTools`, the sandbox ports, `E2BSandboxClient`, `InMemorySandboxClient`, `applyWorkspaceManifest`, retrieval and computer use, and the option types of the built-in tools. Its source reaches no Node built-in or Node global: `AskUserQuestion` ids come from `randomId`, `E2BSandboxClient` decodes a binary file read with `TextDecoder` (a leading byte-order mark is kept, as before), and `PageComputerDriver` encodes screenshots with `btoa`.
- `applyWorkspaceManifest` no longer reads the host itself. The `hostRoot` option is replaced by `hostFiles` (`IWorkspaceHostFiles`: the root a relative `src` is read from, `readText`, `readDirectory`). Absent, a manifest that names a `localFile` or `localDir` entry is refused before any entry is applied, with an error naming `hostFiles`; a manifest with no local entry still applies. `createNodeWorkspaceHostFiles(root)` from `/node` is the Node implementation, and `agent-framework` passes it with the session's working directory.
- Temporary: the main entry still re-exports the eleven Node names that the published `@robota-sdk/workflows` 0.0.3 (bundled by `agent-cli`) imports from it, and keeps `"browser": null`. They leave with the next workflows release, and the main entry becomes platform-neutral then.
- `agent-tool-defaults`, `agent-framework` and `agent-cli` import the Node tools and the OS sandbox from `@robota-sdk/agent-tools/node`.
