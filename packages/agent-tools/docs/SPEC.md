# Tools Specification

## Scope

Owns the tool factory constructors, tool result types, sandbox execution ports, and sandbox workspace manifest contracts for the Robota SDK. This package provides the ergonomic tool-construction factories (`createFunctionTool`, `createZodFunctionTool`) — which construct the `FunctionTool` class owned by `@robota-sdk/agent-core` (DATA-005 SSOT) — and a set of 10 built-in CLI tools (`shell`, `bash`, `read`, `write`, `edit`, `glob`, `grep`, `webFetch`, `webSearch`, `askUserQuestion`) used by the agent CLI.

## Boundaries

- Does not own the abstract tool base class (`AbstractTool`) or tool interface contracts (`IToolWithEventService`, `IToolResult`, `IToolExecutionContext`). Those belong to `@robota-sdk/agent-core`.
- Does not own the concrete `FunctionTool` / `ToolRegistry` classes or their parameter validation. Those are dependency-free runtime primitives owned by `@robota-sdk/agent-core` (DATA-005). This package's factories construct core's `FunctionTool`.
- Does not own permission evaluation or hook execution. Tool permission wrapping is performed by consumers (e.g., `@robota-sdk/agent-session`).
- Does not own MCP tool protocol. MCP tools live in `@robota-sdk/agent-tool-mcp`.
- Does not own provider-specific behavior. Tools are provider-agnostic.
- Does not own provider SDK installation. Provider sandbox adapters are structural adapters; applications decide whether to install concrete provider SDKs such as E2B.
- Does not own CLI manifest file parsing. YAML/JSON CLI parsing belongs to the CLI composition layer and must converge into the `IWorkspaceManifest` contract owned here.

## Architecture Overview

```
index.ts              -- Main entry point (Node.js — all exports)
browser.ts            -- Browser-safe entry point (excludes Node.js-only tools and sandbox clients)
implementations/
  function-tool.ts      -- createFunctionTool / createZodFunctionTool factories (construct core's FunctionTool)
  function-tool/
    index.ts            -- Re-exports the function-tool factory-specific interface types
    types.ts            -- FunctionTool factory-specific interface types
types/
  tool-result.ts        -- IToolInvocationResult: result type for CLI tool invocations
sandbox/
  index.ts                       -- Re-exports all sandbox symbols
  types.ts                       -- ISandboxClient, IWorkspaceManifest*, TWorkspaceManifestEntry contracts
  in-memory-sandbox-client.ts    -- deterministic contract-test adapter
  e2b-sandbox-client.ts          -- structural adapter for E2B-compatible sandboxes
  workspace-manifest.ts          -- workspace manifest validation and generic sandbox application
builtins/
  index.ts              -- Re-exports all built-in CLI tools + classifyFetchError
  atomic-file-write.ts  -- Same-directory temp write + atomic rename helper for UTF-8 file replacement
  path-guard.ts         -- checkPathWithinCwd: path traversal guard for host-local tool operations
  shell-tool.ts         -- Shell + Bash (alias): execute host shell commands; OS-aware (PowerShell on Windows) via agent-core resolvePlatformShell
  read-tool.ts          -- Read: read file contents with line numbers
  write-tool.ts         -- Write: write content to a file
  edit-tool.ts          -- Edit: replace a string in a file
  glob-tool.ts          -- Glob: find files matching a pattern (uses fast-glob)
  grep-tool.ts          -- Grep: regex content search (files_with_matches/content/count, headLimit)
  web-fetch-tool.ts     -- WebFetch: fetch URL content (HTML→text conversion); classifyFetchError exported
  web-search-tool.ts    -- WebSearch: web search via Brave Search API
  ask-user-question-tool.ts -- AskUserQuestion: model asks the user structured questions via the CMD-004 ask port
```

**Design patterns used:**

- **Factory** -- `createFunctionTool` and `createZodFunctionTool` provide ergonomic construction of core's `FunctionTool` (the `ToolRegistry` / `FunctionTool` classes are owned by `@robota-sdk/agent-core`; DATA-005).
- **Adapter** -- `E2BSandboxClient` adapts E2B-compatible sandbox instances to `ISandboxClient`. (Zod-to-JSON-schema conversion is owned by the core package as the schema SSOT; this package imports it.)
- **Ports and adapters** -- `ISandboxClient` separates tool execution intent, workspace preparation, and provider-owned snapshot hydration from the concrete execution plane.
- **Declarative workspace setup** -- `IWorkspaceManifest` describes fresh-session sandbox files, directories, Git repositories, and future ephemeral storage mounts without putting manifest algorithms in SDK or CLI layers.

**Dependency direction:** `@robota-sdk/agent-tools` has a peer dependency on `@robota-sdk/agent-core` and a production dependency on `@robota-sdk/agent-process` (process-tree termination in the shell built-in). No reverse dependency exists.

## Type Ownership

Types owned by this package (SSOT):

| Type                                    | Kind      | File                                     | Description                                                         |
| --------------------------------------- | --------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `IToolInvocationResult`                 | Interface | `types/tool-result.ts`                   | Result shape for CLI tool invocations                               |
| `IFunctionToolValidationOptions`        | Interface | `implementations/function-tool/types.ts` | Validation options for function tools                               |
| `IFunctionToolExecutionMetadata`        | Interface | `implementations/function-tool/types.ts` | Metadata returned by function tool execution                        |
| `IFunctionToolResult`                   | Interface | `implementations/function-tool/types.ts` | Extended result type for function tool execution                    |
| `ISandboxClient`                        | Interface | `sandbox/types.ts`                       | Provider-neutral command, file, manifest, and snapshot sandbox port |
| `ISandboxRunOptions`                    | Interface | `sandbox/types.ts`                       | Sandbox command execution options                                   |
| `ISandboxRunResult`                     | Interface | `sandbox/types.ts`                       | Sandbox command execution result                                    |
| `ISandboxToolOptions`                   | Interface | `sandbox/types.ts`                       | Built-in tool factory options for sandbox use                       |
| `IWorkspaceManifest`                    | Interface | `sandbox/types.ts`                       | Declarative sandbox workspace setup contract                        |
| `IWorkspaceManifestApplyOptions`        | Interface | `sandbox/types.ts`                       | Generic manifest application options                                |
| `IWorkspaceManifestApplyResult`         | Interface | `sandbox/types.ts`                       | Per-entry manifest application result                               |
| `IWorkspaceManifestAppliedEntry`        | Interface | `sandbox/types.ts`                       | Per-entry manifest application status                               |
| `IWorkspaceManifestFileEntry`           | Interface | `sandbox/types.ts`                       | Inline file entry (content + optional encoding)                     |
| `IWorkspaceManifestDirectoryEntry`      | Interface | `sandbox/types.ts`                       | Directory creation entry                                            |
| `IWorkspaceManifestLocalFileEntry`      | Interface | `sandbox/types.ts`                       | Host-local file copy entry                                          |
| `IWorkspaceManifestLocalDirectoryEntry` | Interface | `sandbox/types.ts`                       | Host-local directory copy entry                                     |
| `IWorkspaceManifestGitRepositoryEntry`  | Interface | `sandbox/types.ts`                       | Git repository clone entry                                          |
| `IWorkspaceManifestS3MountEntry`        | Interface | `sandbox/types.ts`                       | AWS S3 bucket mount entry                                           |
| `IWorkspaceManifestGcsMountEntry`       | Interface | `sandbox/types.ts`                       | GCS bucket mount entry                                              |
| `IWorkspaceManifestR2MountEntry`        | Interface | `sandbox/types.ts`                       | Cloudflare R2 bucket mount entry                                    |
| `IWorkspaceManifestAzureBlobMountEntry` | Interface | `sandbox/types.ts`                       | Azure Blob Storage mount entry                                      |
| `IWorkspaceManifestPermissions`         | Interface | `sandbox/types.ts`                       | Read/write path permission lists for a workspace manifest           |
| `TWorkspaceManifestEntry`               | Type      | `sandbox/types.ts`                       | Union of all manifest entry types                                   |
| `TWorkspaceManifestApplyStatus`         | Type      | `sandbox/types.ts`                       | `'applied' \| 'unsupported'` status for each applied manifest entry |
| `TInMemorySandboxRunHandler`            | Type      | `sandbox/in-memory-sandbox-client.ts`    | Custom run handler for `InMemorySandboxClient`                      |
| `IE2BSandboxAdapter`                    | Interface | `sandbox/e2b-sandbox-client.ts`          | Structural E2B-compatible adapter input                             |
| `IE2BSandboxClientOptions`              | Interface | `sandbox/e2b-sandbox-client.ts`          | E2B adapter construction and restore options                        |
| `IInMemorySandboxClientOptions`         | Interface | `sandbox/in-memory-sandbox-client.ts`    | In-memory sandbox construction options                              |

## Public API Surface

### Tool Infrastructure

| Export                                  | Kind     | Description                                                                                                                                                |
| --------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFunctionTool`                    | Function | Factory constructing core's `FunctionTool` from a plain schema + handler                                                                                   |
| `createZodFunctionTool`                 | Function | Generic factory (`<S extends ZodType>`): runtime `safeParse` validation AND `z.infer<S>`-typed executor args (SDK-009); executor receives the parsed value |
| `IToolInvocationResult`                 | Type     | Result shape for CLI tool invocations                                                                                                                      |
| `E2BSandboxClient`                      | Class    | Adapter for E2B-compatible sandbox instances and snapshots                                                                                                 |
| `InMemorySandboxClient`                 | Class    | Deterministic sandbox client for tests                                                                                                                     |
| `ISandboxClient`                        | Type     | Provider-neutral sandbox execution and hydration port                                                                                                      |
| `IWorkspaceManifest`                    | Type     | Provider-neutral sandbox workspace manifest                                                                                                                |
| `IWorkspaceManifestFileEntry`           | Type     | Inline file entry type                                                                                                                                     |
| `IWorkspaceManifestDirectoryEntry`      | Type     | Directory creation entry type                                                                                                                              |
| `IWorkspaceManifestLocalFileEntry`      | Type     | Host-local file copy entry type                                                                                                                            |
| `IWorkspaceManifestLocalDirectoryEntry` | Type     | Host-local directory copy entry type                                                                                                                       |
| `IWorkspaceManifestGitRepositoryEntry`  | Type     | Git repository clone entry type                                                                                                                            |
| `IWorkspaceManifestS3MountEntry`        | Type     | AWS S3 bucket mount entry type                                                                                                                             |
| `IWorkspaceManifestGcsMountEntry`       | Type     | GCS bucket mount entry type                                                                                                                                |
| `IWorkspaceManifestR2MountEntry`        | Type     | Cloudflare R2 bucket mount entry type                                                                                                                      |
| `IWorkspaceManifestAzureBlobMountEntry` | Type     | Azure Blob Storage mount entry type                                                                                                                        |
| `IWorkspaceManifestPermissions`         | Type     | Read/write path permission lists for a workspace manifest                                                                                                  |
| `TWorkspaceManifestEntry`               | Type     | Union of all manifest entry types                                                                                                                          |
| `TWorkspaceManifestApplyStatus`         | Type     | `'applied' \| 'unsupported'` status per applied manifest entry                                                                                             |
| `TInMemorySandboxRunHandler`            | Type     | Custom run handler type for `InMemorySandboxClient`                                                                                                        |
| `applyWorkspaceManifest`                | Function | Applies a workspace manifest through an `ISandboxClient`                                                                                                   |
| `validateWorkspaceManifestPath`         | Function | Validates and normalizes manifest entry paths                                                                                                              |
| `createRetrievalTool`                   | Function | SELFHOST-003 — the `CodebaseRetrieval` tool over an injected `IRetrievalAdapter` (adapter-gated; no corpus in the package)                                 |
| `RepoMapRetrievalAdapter`               | Class    | SELFHOST-003 — neutral repo-map graph-centrality ranking adapter (source parser injected, corpus from the surface; token-budgeted)                         |
| `IRetrievalAdapter`                     | Type     | SELFHOST-003 — codebase-retrieval port (`retrieve(request) → ranked result within a token budget`)                                                         |
| `IRetrievalSourceParser`                | Type     | SELFHOST-003 — duck-typed source-parser port injected into the ranking adapter                                                                             |
| `buildRepoMapIndex`                     | Function | SELFHOST-003 P2 — parse the corpus once into a serializable `IRepoMapIndex` (build-once, rank-many)                                                        |
| `serializeRepoMapIndex`                 | Function | SELFHOST-003 P2 — serialize a built index to a neutral JSON string for surface persistence                                                                 |
| `deserializeRepoMapIndex`               | Function | SELFHOST-003 P2 — restore a built index from JSON (throws on unsupported `version`)                                                                        |
| `REPO_MAP_INDEX_VERSION`                | Const    | SELFHOST-003 P2 — persisted-schema version for `IRepoMapIndex`                                                                                             |
| `IRepoMapIndex`                         | Type     | SELFHOST-003 P2 — a built, serializable repo-map index (the corpus parsed once)                                                                            |

### Built-in CLI Tools

| Export                | Kind   | Tool Name         | Description                                                                                                  |
| --------------------- | ------ | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `shellTool`           | Object | `Shell`           | Execute host shell commands; OS-aware (POSIX `sh`/`bash`, Windows PowerShell)                                |
| `bashTool`            | Object | `Bash`            | Model-familiar alias of `Shell` — same OS-aware implementation                                               |
| `readTool`            | Object | `Read`            | Read file contents with line numbers (cat -n)                                                                |
| `writeTool`           | Object | `Write`           | Write content to a file (creates parent dirs)                                                                |
| `editTool`            | Object | `Edit`            | Replace a specific string in a file                                                                          |
| `globTool`            | Object | `Glob`            | Find files matching a glob pattern (fast-glob)                                                               |
| `grepTool`            | Object | `Grep`            | Regex content search — modes: files_with_matches/content/count; `headLimit` caps results                     |
| `webFetchTool`        | Object | `WebFetch`        | Fetch URL content with HTML-to-text conversion                                                               |
| `webSearchTool`       | Object | `WebSearch`       | Web search via Brave Search API                                                                              |
| `askUserQuestionTool` | Object | `AskUserQuestion` | Model-issued structured questions (options/multi-select/free text) via `IToolExecutionContext.ask` (CMD-005) |

`AskUserQuestion` (CMD-005) consumes the injected `IToolExecutionContext.ask` port (CMD-004): each of
its 1–4 questions maps onto the `IActionRequest` SSOT and is rendered by the attached environment; a
dismissed question cancels the remaining unasked ones; without an ask port (headless) the tool returns
a structured `{ unavailable: true }` result — never a silent guess, never a thrown error.

> `classifyFetchError` is **not** part of the package Public API Surface — it is not re-exported from `src/index.ts`. It remains internal, exported only from the builtins barrel (`src/builtins/index.ts`).

Each built-in tool is an `IToolWithEventService`-compatible object with `getName()`, `getDescription()`, `getSchema()`, and `execute()` methods.

`createShellTool` (and its alias `createBashTool`), `createReadTool`, `createWriteTool`, `createEditTool`, and `createAskUserQuestionTool` create tool instances (the first four are sandbox-aware; `createAskUserQuestionTool` binds the ask port). When an `ISandboxClient` is supplied, shell command execution plus Read/Write/Edit filesystem operations are routed through the sandbox client. When no sandbox client is supplied, the singleton exports keep host-local behavior, resolving the shell per-OS through agent-core's `resolvePlatformShell` (POSIX `sh`/`bash`, Windows PowerShell). The `Shell` tool's description is built dynamically from the resolved shell so the model writes syntax the host shell can run.

**WriteTool output**: Reports actual UTF-8 byte count via `Buffer.byteLength(content, 'utf8')`, not JS `content.length` (which is character count and differs for multibyte content).

**Atomic write semantics**: `Write` and `Edit` replace UTF-8 file content by writing to a temporary file in the same directory and then renaming it into place. When replacing an existing target, the temporary file is assigned the target's existing mode bits before the rename so executable scripts and other permission-sensitive files keep their permissions. The temporary file is removed after failed writes when possible. This keeps built-in filesystem mutations provider-agnostic while preventing partially written target files during self-hosting edit/build/verify loops.

### IToolInvocationResult Shape

```typescript
interface IToolInvocationResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
  startLine?: number; // Start line number of the edit in the original file (Edit tool only)
}
```

This is the inner result type used by built-in tools. It is serialized to JSON and placed inside the `IToolResult.data` field before being returned to the Robota execution loop.

## Extension Points

1. **createFunctionTool / createZodFunctionTool** -- Consumers create custom tools from plain functions (or from Zod schemas for parameter validation); both factories construct the `FunctionTool` class owned by `@robota-sdk/agent-core` (DATA-005). Zod object schemas marked with `passthrough()` are converted to root `additionalProperties: true`, and core's `FunctionTool` validation accepts unknown root parameters for those schemas. (The `ToolRegistry` and `FunctionTool` classes themselves are imported from `@robota-sdk/agent-core`.)

2. **ISandboxClient** -- Consumers inject provider-backed execution planes into sandbox-aware built-in tool factories. The optional `snapshot()` and `restore(snapshotId)` methods return and hydrate provider-owned resumable workspace references. `E2BSandboxClient` adapts E2B-compatible objects without adding an `e2b` package dependency to `agent-tools`; it supports both `createSnapshot()` style checkpoint references and `pause()`/`connect()` style resumable sandbox IDs. `InMemorySandboxClient` supports deterministic contract tests.

3. **IWorkspaceManifest / applyWorkspaceManifest** -- Consumers declare fresh-session sandbox contents using workspace-relative paths. The generic applicator writes inline/local files, creates directories, and clones Git repositories through `ISandboxClient`; provider-specific storage mounts are represented in the contract but return explicit `unsupported` entries until an adapter supplies native mount capability.

## Error Taxonomy

This package does not define a custom error hierarchy. Built-in tools return errors via the `IToolInvocationResult.error` field rather than throwing.

`classifyFetchError` in `web-fetch-tool.ts` maps network-layer errors (Node.js `ErrnoException` codes and `AbortError`) to human-readable strings; it does not throw. Path traversal violations detected by `checkPathWithinCwd` in `path-guard.ts` are returned as a serialized `IToolInvocationResult` error string rather than thrown exceptions.

## Class Contract Registry

### Interface Implementations

| Interface                      | Implementor             | Kind         | Location                                  |
| ------------------------------ | ----------------------- | ------------ | ----------------------------------------- |
| `ISandboxClient` (agent-tools) | `E2BSandboxClient`      | production   | `src/sandbox/e2b-sandbox-client.ts`       |
| `ISandboxClient` (agent-tools) | `InMemorySandboxClient` | test/utility | `src/sandbox/in-memory-sandbox-client.ts` |

`IFunctionTool` / `IToolRegistry` (agent-core) are implemented by the `FunctionTool` / `ToolRegistry` classes owned by `@robota-sdk/agent-core` (DATA-005); this package's factories construct core's `FunctionTool`.

### Inheritance Chains

None. This package defines no tool classes; the factories construct core's `FunctionTool` (which itself implements `IFunctionTool` directly without extending `AbstractTool`, owned by `@robota-sdk/agent-core`).

### Cross-Package Port Consumers

| Port (Owner)                       | Consumer                                       | Location                                                                      |
| ---------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `FunctionTool` (agent-core)        | `createFunctionTool` / `createZodFunctionTool` | `src/implementations/function-tool.ts`                                        |
| `IToolWithEventService` shape      | Built-in CLI tools                             | `src/builtins/*.ts`                                                           |
| `ISandboxClient` (agent-tools)     | Built-in CLI tool factories                    | `src/builtins/shell-tool.ts`, `read-tool.ts`, `write-tool.ts`, `edit-tool.ts` |
| `IWorkspaceManifest` (agent-tools) | `agent-framework` interactive session assembly | `packages/agent-framework/src/interactive/interactive-session-options.ts`     |

## Test Strategy

### Current Test Coverage

| File                                       | Scope | Description                                                                                           |
| ------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------- |
| `src/__tests__/atomic-file-write.test.ts`  | Unit  | Atomic UTF-8 write replacement, mode preservation, cleanup, and handoff                               |
| `src/__tests__/sandbox-tools.test.ts`      | Unit  | Sandbox client contracts, sandbox-aware tools, E2B adapter behavior, and snapshot/restore paths       |
| `src/__tests__/workspace-manifest.test.ts` | Unit  | Workspace manifest path validation and generic sandbox application                                    |
| `src/__tests__/function-tool.test.ts`      | Unit  | `createFunctionTool` + core `FunctionTool` (imported from agent-core) creation, execution, validation |
| `src/__tests__/tool-registry.test.ts`      | Unit  | core `ToolRegistry` (imported from agent-core) registration, lookup, listing                          |

### Gaps

- **Built-in tools** -- `globTool` and `grepTool` still need dedicated unit coverage beyond provider-agnostic composition tests.
- **IToolInvocationResult** -- No tests verifying the result shape contract.

## Dependencies

### Production (4)

- `@robota-sdk/agent-process` -- Process-tree termination (`killProcessTree`) for the shell built-in tool (`builtins/shell-tool.ts`)
- `fast-glob` -- High-performance glob matching for the glob built-in tool
- `p-limit` -- Concurrency limiting used by the glob built-in tool (`builtins/glob-tool.ts`)
- `zod` -- Schema validation for function tool parameters

### Dev (notable)

### Peer (1)

- `@robota-sdk/agent-core` -- Abstract tool base class, tool interfaces, event service types
