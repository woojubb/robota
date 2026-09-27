# @robota-sdk/agent-tools

Tool implementations for the Robota SDK: factories for building your own tools from Zod schemas,
the built-in tools (Shell, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, AskUserQuestion,
ToolSearch), codebase retrieval and computer-use tools, and the sandbox clients that run tools
somewhere other than the host (E2B, an OS-level sandbox, or in memory for tests).

The tool contract itself (`FunctionTool`, `ToolRegistry`, `AbstractTool`, `IToolSchema`) lives in
`@robota-sdk/agent-core`. The ready-made default tool set that sessions use is
`createDefaultTools()` in `@robota-sdk/agent-tool-defaults`.

## Installation

```bash
npm install @robota-sdk/agent-tools @robota-sdk/agent-core
```

`@robota-sdk/agent-core` is a peer dependency. Requires Node.js 22.12 or later.

## Quick Start

### Create a tool with Zod

```typescript
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

const weatherTool = createZodFunctionTool(
  'get_weather',
  'Get current weather for a city',
  z.object({
    city: z.string().describe('City name'),
  }),
  async (args) => JSON.stringify({ city: args.city, temperature: 22, condition: 'sunny' }),
);
```

The schema is converted to the JSON schema the model sees, and the arguments are validated against
it before your function runs. The result is a `FunctionTool` from `@robota-sdk/agent-core`.

### Use built-in tools

```typescript
import {
  createBashTool,
  createReadTool,
  createGlobTool,
  createGrepTool,
} from '@robota-sdk/agent-tools';
import { Robota } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

// File tools are built for an explicit root and refuse paths outside it.
const cwd = process.cwd();

const agent = new Robota({
  name: 'DevAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: [
    createBashTool({ cwd }),
    createReadTool({ cwd }),
    createGlobTool({ cwd }),
    createGrepTool({ cwd }),
  ],
});
```

## Built-in tools

Every tool that touches the file system is a factory that takes the root it works in (`cwd`,
required). There is no ready-made instance of those tools: an instance created at import time could
carry no root, and a file tool without a root would have no boundary.

| Export                 | Tool name       | Description                                                              |
| ---------------------- | --------------- | ------------------------------------------------------------------------ |
| `createShellTool`      | Shell           | Run a shell command; OS-aware (POSIX `sh`/`bash`, Windows PowerShell)    |
| `createBashTool`       | Bash            | The same implementation as `Shell` under the name models are used to     |
| `createReadTool`       | Read            | Read a file with line numbers (`cat -n` style)                           |
| `createWriteTool`      | Write           | Write a file, creating parent directories                                |
| `createEditTool`       | Edit            | Replace a specific string in a file                                      |
| `createGlobTool`       | Glob            | Find files matching a glob pattern                                       |
| `createGrepTool`       | Grep            | Search file contents with a regular expression                           |
| `createToolSearchTool` | ToolSearch      | Load the schemas of deferred tools by query or exact name                |
| `webFetchTool`         | WebFetch        | Fetch a URL and convert HTML to text                                     |
| `webSearchTool`        | WebSearch       | Web search; the default provider is Brave Search (needs `BRAVE_API_KEY`) |
| `askUserQuestionTool`  | AskUserQuestion | Ask the user structured questions (options, multi-select or free text)   |

`webFetchTool`, `webSearchTool` and `askUserQuestionTool` are ready-made instances because they
touch no file system; `createWebFetchTool`, `createWebSearchTool` (with your own search `provider`)
and `createAskUserQuestionTool` build configured ones.

- For `Read`, `Write`, `Edit`, `Glob` and `Grep`, `cwd` is a containment boundary: paths outside it
  are refused, judged on resolved (symlink-free) paths. For `Shell` and `Bash` it is the starting
  directory, not a boundary. The tool description names the active OS and shell so the model writes
  the right syntax.
- `Write` and `Edit` replace files atomically and keep the existing file mode, so executable scripts
  stay executable. `Edit` reports the line where the change starts, so a UI can show a short hunk.
- `AskUserQuestion` asks one to four questions through the ask port the host injects. Each surface
  renders it its own way; a headless run gets a structured `unavailable` result instead of hanging.
- `Read` throws `ReadByteLimitError` when a read exceeds its byte budget and `ReadCancelledError`
  when it is aborted; `Grep` throws `GrepIsolationError` when its isolated search fails. These are
  hard failures, never partial content.

Built-in tools return an `IToolInvocationResult` (`success`, `output`, `error?`, `exitCode?`,
`startLine?`), serialized as JSON into the `IToolResult.data` field that the agent loop receives.

## Sandbox execution

`ISandboxClient` is the provider-neutral port for running tools somewhere other than the host. The
sandbox-aware factories (`createShellTool`, `createBashTool`, `createReadTool`, `createWriteTool`,
`createEditTool`) accept an optional `sandboxClient`; without one they run on the host, contained by
`cwd`.

| Client                  | What it is                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `E2BSandboxClient`      | Adapts an E2B sandbox that your application creates; this package does not depend on E2B                           |
| `OsSandboxClient`       | Confines shell commands on the host with bubblewrap (Linux, WSL2) or Seatbelt (macOS); file tools stay on the host |
| `InMemorySandboxClient` | Deterministic client for tests                                                                                     |

```typescript
import { E2BSandboxClient, createBashTool, createReadTool } from '@robota-sdk/agent-tools';
import type { IE2BSandboxAdapter } from '@robota-sdk/agent-tools';

declare const e2b: IE2BSandboxAdapter; // e.g. `await Sandbox.create()` from the `e2b` package

const sandboxClient = new E2BSandboxClient({ sandbox: e2b });

// `cwd` is still required: it is the root inside the sandbox, and the host path guard applies to any
// tool that runs on the host.
const cwd = '/workspace';
const bashTool = createBashTool({ sandboxClient, cwd });
const readTool = createReadTool({ sandboxClient, cwd });
```

`E2BSandboxClient` needs an object with `commands.run`, `files.read` and `files.write`, and optionally
snapshot and reconnect methods. `snapshot()` returns a provider-owned reference to the workspace, and
`restore(snapshotId)` brings it back.

`detectOsSandbox()` reports whether an OS sandbox backend is available here; `OsSandboxClient` takes
that result and the sandbox settings (writable and unreadable paths, network access, excluded
commands). `routesFilesThroughSandbox(client)` tells whether a client has its own file system, in
which case file tools go through it instead of the host.

### Workspace manifests

`IWorkspaceManifest` declares what a fresh sandbox workspace should contain before a session starts.
Paths are workspace-relative and cannot escape the target root.

```typescript
import { applyWorkspaceManifest, E2BSandboxClient } from '@robota-sdk/agent-tools';
import type { IE2BSandboxAdapter } from '@robota-sdk/agent-tools';

declare const sandbox: IE2BSandboxAdapter;
const sandboxClient = new E2BSandboxClient({ sandbox });

await applyWorkspaceManifest(sandboxClient, {
  entries: {
    'task.md': { type: 'file', content: 'Analyze this repository.\n' },
    repo: { type: 'gitRepo', url: 'https://github.com/example/project.git', ref: 'main' },
    output: { type: 'dir' },
  },
});
```

The applicator writes inline and local files, creates directories and clones Git repositories
through `ISandboxClient`. Cloud storage mount entries (S3, GCS, R2, Azure Blob) are part of the
contract but report `unsupported` until a provider-specific adapter implements mounting.

## Codebase retrieval

`createRetrievalTool({ adapter })` adds a `CodebaseRetrieval` tool that returns the most relevant
slice of the codebase (a ranked map of symbols) within a token budget. `RepoMapRetrievalAdapter` is
the built-in adapter; `buildRepoMapIndex`, `updateRepoMapIndex`, `serializeRepoMapIndex` and
`deserializeRepoMapIndex` build and store its index. You supply the source parser.

## Computer use

`createComputerTool({ driver })` returns two tools: `ComputerView` (take a screenshot, read-only) and
`Computer` (one action: click, type, key press, scroll, drag, wait, or hand control to the user).
They drive an `IComputerDriver`; `PageComputerDriver` adapts a browser page object. There is no host
fallback without a driver.

## Dependencies

| Dependency                  | Kind | Purpose                                              |
| --------------------------- | ---- | ---------------------------------------------------- |
| `@robota-sdk/agent-core`    | Peer | Tool contract, `FunctionTool`, schemas, event types  |
| `@robota-sdk/agent-process` | Prod | Terminating shell process trees on cancel or timeout |
| `fast-glob`                 | Prod | Glob matching                                        |
| `p-limit`                   | Prod | Concurrency limit in the Glob tool                   |
| `zod`                       | Prod | Tool parameter schemas and validation                |

## Documentation

- [docs/SPEC.md](./docs/SPEC.md) — package contract and design decisions
- [`@robota-sdk/agent-tool-defaults`](../agent-tool-defaults/README.md) — the default tool set

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
