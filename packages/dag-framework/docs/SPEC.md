# dag-framework SPEC

**Package:** `@robota-sdk/dag-framework`  
**Version:** `0.1.0-beta.*`  
**Status:** Active

---

## Purpose

`dag-framework` is the embeddable in-process DAG runtime composition package. It assembles
`dag-runtime`, `dag-worker`, `dag-adapters-local`, and default node definitions into a single
factory call. Consumers get a fully wired `IDagFramework` without managing individual
infrastructure objects.

Primary use case: `dag-cli mcp` and `dag-mcp-server` embedded mode — boot a DAG server
with zero external process dependencies.

---

## Public API

### Factory

```typescript
import { createDagFramework } from '@robota-sdk/dag-framework';

const framework = await createDagFramework(options?: IDagFrameworkOptions);
await framework.start();
// … use framework.client (IDagOrchestrationPort)
await framework.stop();
```

### `IDagFramework`

```typescript
interface IDagFramework {
  client: IDagOrchestrationPort; // 25-method transport-neutral orchestration port
  internals: {
    controllers: IDagControllerComposition;
    execution: IDagExecutionComposition;
    storage: IStoragePort;
    promptBackend: IPromptBackendPort & { getPromptIdForDagRun(id: string): string | undefined };
    assetStore: IAssetStore;
  };
  start(): Promise<void>; // Start background worker loop. Idempotent.
  stop(): Promise<void>; // Stop + drain. Idempotent.
}
```

### `IDagFrameworkOptions`

| Field                   | Type                             | Default                                                    | Description                                                                                                     |
| ----------------------- | -------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `nodes`                 | `IDagNodeDefinition[]`           | lazily-loaded catalog from `@robota-sdk/dag-nodes-default` | Node definitions to register                                                                                    |
| `providers`             | `readonly IProviderDefinition[]` | lazily-loaded `createDefaultProviderDefinitions()`         | Provider-definition registry injected into the collapsed `llm-text` node. **Ignored when `nodes` is supplied.** |
| `ports.storage`         | `IStoragePort`                   | `JsonFileStoragePort` (XDG path)                           | Persistent storage                                                                                              |
| `ports.queue`           | `IQueuePort`                     | `InMemoryQueuePort`                                        | Task queue                                                                                                      |
| `ports.deadLetterQueue` | `IQueuePort`                     | `InMemoryQueuePort`                                        | DLQ                                                                                                             |
| `ports.lease`           | `ILeasePort`                     | `InMemoryLeasePort`                                        | Distributed lease                                                                                               |
| `ports.clock`           | `IClockPort`                     | `SystemClockPort`                                          | Time source                                                                                                     |
| `ports.executor`        | `ITaskExecutorPort`              | `DirectTaskExecutorPort`                                   | Task executor                                                                                                   |
| `ports.assetStore`      | `IAssetStore`                    | `LocalFsAssetStore`                                        | File asset store                                                                                                |
| `ports.runDraftStore`   | `IRunDraftStore`                 | `InMemoryRunDraftStore`                                    | Run draft persistence                                                                                           |
| `paths.storageRoot`     | `string`                         | XDG / homedir                                              | Root for JSON storage                                                                                           |
| `paths.assetRoot`       | `string`                         | `<storageRoot>/assets`                                     | Root for file assets                                                                                            |
| `worker`                | `IWorkerLoopPolicyOptions`       | defaults                                                   | Worker backoff/poll settings                                                                                    |
| `autoStart`             | `boolean`                        | `false`                                                    | Auto-start worker loop in factory                                                                               |
| `logger`                | `IDagFrameworkLogger`            | no-op                                                      | Log info + error messages                                                                                       |

### Node Registries

The default node catalog was extracted to `@robota-sdk/dag-nodes-default` (ARCH-PROVIDER-004) and is
**not** re-exported by `dag-framework` — a pass-through re-export would force a hard
`dag-framework → dag-nodes-default` production edge. Import the registry factories directly from the
`@robota-sdk/dag-nodes-default` entry point at composition roots:

```typescript
import {
  createDefaultNodeRegistrySync,
  createDefaultNodeRegistry,
} from '@robota-sdk/dag-nodes-default';

// Core nodes only (23 nodes, sync, no optional peer deps)
createDefaultNodeRegistrySync(): IDagNodeDefinition[]

// Core + collapsed llm-text + optional media/skill nodes (async, silently skips unavailable SDKs)
createDefaultNodeRegistry(providers?: readonly IProviderDefinition[]): Promise<IDagNodeDefinition[]>
```

**Core nodes (always available, 23):** `input`, `multi-input`, `transform`, `text-template`,
`text-output`, `image-loader`, `image-source`, `ok-emitter`, `tool`, and the 14 `utility-text`
nodes: `string-to-number`, `number-to-string`, `text-join`, `text-split`, `text-replace`,
`text-length`, `text-upper`, `text-lower`, `text-trim`, `json-extract`, `conditional-text`,
`text-count-lines`, `text-repeat`, `text-slice`.

**LLM node (always present via `createDefaultNodeRegistry`):** the collapsed single `llm-text` node
(`@robota-sdk/dag-node-llm-text`) bound to an injected/lazy provider-definition registry (the
per-vendor `llm-text-openai/anthropic/gemini/deepseek/qwen` nodes were collapsed into it).

**Optional media/skill nodes (loaded if SDK installed):** `gemini-image-edit`,
`gemini-image-compose`, `text-to-image`, `seedance-video`, `skill`.

### Infrastructure Adapters (re-exported)

```typescript
import {
  DagPromptBackend,
  LocalFsAssetStore,
  createExecutionComposition,
} from '@robota-sdk/dag-framework';
import type { IWorkerLoopDriverLogger } from '@robota-sdk/dag-framework';
```

### Runtime Providers

Transport-neutral runtime providers used by the CLI/MCP layers to run DAGs either in-process
or against a native DAG runtime server.

```typescript
import { LocalDagRuntimeProvider, HttpDagRuntimeProvider } from '@robota-sdk/dag-framework';
import type {
  ILocalDagRuntimeProviderOptions,
  IHttpDagRuntimeProviderOptions,
} from '@robota-sdk/dag-framework';
```

- `LocalDagRuntimeProvider` — embeds the runtime, worker, and adapters in-process (no server).
- `HttpDagRuntimeProvider` — talks to a native DAG runtime server over HTTP.

#### `ILocalDagRuntimeProviderOptions`

| Field          | Type                   | Default                           | Description                                                                                 |
| -------------- | ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------- |
| `nodeRegistry` | `IDagNodeDefinition[]` | `createDefaultNodeRegistrySync()` | Base node registry. CLI typically passes a registry including LLM/provider-backed nodes.    |
| `projectDir`   | `string`               | —                                 | DAG project directory (reserved for future local node-file scanning).                       |
| `workspace`    | `IWorkspaceLayout`     | —                                 | **FLOW-007**: injected workspace layout (root dir + workflow ext) for local node discovery. |
| `instantNodes` | `IDagNodeDefinition[]` | —                                 | Instant nodes (typically injected from an MCP session context).                             |
| `extraNodes`   | `IDagNodeDefinition[]` | —                                 | Extra nodes appended at the end (test/special-purpose).                                     |

#### `IHttpDagRuntimeProviderOptions`

| Field     | Type           | Default        | Description                                 |
| --------- | -------------- | -------------- | ------------------------------------------- |
| `baseUrl` | `string`       | (required)     | Base URL of the native DAG runtime server.  |
| `fetch`   | `typeof fetch` | global `fetch` | Fetch implementation; injectable for tests. |

### Workspace Catalog Reader

`scanWorkspaceCatalog` is the shared workspace-catalog reader (**FLOW-007 C3**) — it scans a
workspace directory for authored workflow definition files and returns their metadata.

```typescript
import { scanWorkspaceCatalog } from '@robota-sdk/dag-framework';
import type { IWorkspaceCatalogEntry, IWorkspaceCatalogMeta } from '@robota-sdk/dag-framework';

scanWorkspaceCatalog(
  dir: string,
  layout?: IWorkspaceLayout, // defaults to DEFAULT_WORKSPACE_LAYOUT
): Promise<IWorkspaceCatalogEntry[]>
```

- `IWorkspaceCatalogEntry` — `{ id, filePath, definition: IDagDefinition, meta }` for one discovered workflow (a missing/unreadable root yields an empty catalog).
- `IWorkspaceCatalogMeta` — optional `{ description?, displayName?, tags? }` sidecar metadata.

### Package Identity

```typescript
import { DAG_FRAMEWORK_PACKAGE_NAME } from '@robota-sdk/dag-framework';
// '@robota-sdk/dag-framework'
```

---

## Lifecycle

```
createDagFramework(options)
  → resolves storage root path
  → creates infrastructure ports (storage, queue, lease, clock, etc.)
  → builds node assembly (manifests)
  → creates controller composition (design, run, observability, cost)
  → creates execution composition (workerLoop, runOrchestrator)
  → creates DagFrameworkOrchestrationAdapter (the IDagOrchestrationPort impl)
  → creates WorkerLoopDriver (AbortController-based background loop)
  → returns IDagFramework (not yet started)

framework.start()
  → WorkerLoopDriver.start()
  → background loop calls workerLoop.processOnce() with exponential backoff
  → MIN_IDLE_DELAY=25ms, MAX_IDLE_DELAY=500ms

framework.stop()
  → AbortController.abort()
  → awaits loop drain
  → state returns to 'idle'
```

---

## Internal Components

### `WorkerLoopDriver`

Drives `IRuntimeWorkerLoopPort.processOnce()` in a background loop with exponential idle backoff. Uses `AbortController` for cancellation. Timers are `unref()`'d to prevent process hang.

- `start()`: idempotent (double-start is no-op)
- `stop()`: idempotent (stop-when-idle is no-op)
- Error on iteration → logs via `IWorkerLoopDriverLogger`, backs off to `MAX_IDLE_DELAY`
- Processed work → resets delay to `MIN_IDLE_DELAY`

### `DagFrameworkOrchestrationAdapter`

In-process implementation of all 25 `IDagOrchestrationPort` methods. Wraps the controller composition directly (no HTTP). Response envelope format mirrors the HTTP client so `dag-mcp-tools` consumers are reused unchanged.

Uses `IClockPort.nowIso()` for all timestamp generation (deterministic in tests).

Not-yet-implemented methods return `{ status: 501, ... NOT_IMPLEMENTED_IN_FRAMEWORK ... }`.

---

## Extension Points

1. **Custom node registry**: pass `options.nodes` to `createDagFramework`
2. **Custom storage**: inject `options.ports.storage` (e.g. SQLite adapter)
3. **Custom run draft store**: inject `options.ports.runDraftStore` for persistent drafts
4. **Custom asset store**: inject `options.ports.assetStore`
5. **Custom clock**: inject `options.ports.clock` for test determinism
6. **Logger**: inject `options.logger` to forward logs to your logging system

---

## Dependency Rules

- `dag-framework` MAY import from: `dag-core`, `dag-api`, `dag-runtime`, `dag-worker`,
  `dag-adapters-local`, `dag-orchestration-client`, `dag-cost`, `dag-node`, and the
  default node packages (`dag-node-*`).
- `dag-framework` MUST NOT import `@robota-sdk/agent-*` packages.
- LLM node packages (`dag-node-llm-text-*`, `dag-node-gemini-*`) are declared as
  `optionalDependencies` — loaded via dynamic import with silent skip on missing SDK.
- `dag-node-text-to-image`, `dag-node-seedance-video`, and `dag-node-skill` load via the same
  dynamic-import silent-skip path (`tryImport`), but are currently declared as hard
  `dependencies` rather than `optionalDependencies`.

---

## Peer Dependencies (optional)

| Package             | Required version | When needed                   |
| ------------------- | ---------------- | ----------------------------- |
| `openai`            | `^4.98.0`        | LLM text OpenAI node          |
| `@anthropic-ai/sdk` | `^0.80.0`        | LLM text Anthropic node       |
| `@google/genai`     | `^1.51.0`        | LLM text Gemini + image nodes |
