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

Primary use case: local workflow execution composed by the agent CLI `/workflows` command,
with zero external runtime-server process dependencies.

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
  client: IDagOrchestrationPort; // orchestration operations (cost capability is separate)
  costMeta: ICostMetaOperationsPort; // typed cost capability
  runDrafts: IRunDraftOperationsPort; // typed create/get/replace/reset/overwrite capability
  assets: IAssetStore; // domain asset storage and byte streaming
  internals: {
    controllers: IDagControllerComposition;
    execution: IDagExecutionComposition;
    storage: IStoragePort;
    promptBackend: IPromptBackendPort & { getPromptIdForDagRun(id: string): string | undefined };
    assetStore: IAssetStore;
  };
  start(): Promise<void>; // Start queue advancement. Idempotent only while running.
  stop(): Promise<void>; // Close prompt admission and quiesce owned work. Idempotent.
}
```

`IDagExecutionComposition` is owned by `dag-framework` because it is an assembly result, not an API
controller contract. It exposes `runAdvancement` and never exposes the raw worker loop. Product
consumers cannot call `processOnce()` or create a second advancement loop.

### `IDagFrameworkOptions`

| Field                   | Type                             | Default                                                    | Description                                                                                                     |
| ----------------------- | -------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `nodes`                 | `IDagNodeDefinition[]`           | lazily-loaded catalog from `@robota-sdk/dag-nodes-default` | Node definitions to register                                                                                    |
| `executionRoot`         | `string`                         | canonicalized `process.cwd()`                              | Trusted absolute root propagated to every task and node; invalid explicit roots are refused                     |
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

`createDagFramework` is the sole generic convenience boundary allowed to capture `process.cwd()` when
`executionRoot` is omitted. It validates and canonicalizes that value once. Lower execution composition,
worker, task, and lifecycle contracts require the root and never default it. Product-specific callers
that already know their project directory pass it explicitly.

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
import type { IDagExecutionComposition } from '@robota-sdk/dag-framework';
```

`NoopDeadLetterReinject` (exported) is the diagnostics reinject port the default composition wires:
it has no queue to drain, and it says so — `ok: false` with
`DAG_VALIDATION_DLQ_REINJECT_UNSUPPORTED` (CORE-027). It must never answer
`{ ok: true, reinjected: false }`, which reads as "the dead-letter queue is empty", a claim about a
queue the composition does not have.

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
- On a failed local run, its result retains the terminal task's `errorCode` and `errorRetryable` for nested composite callers.
- `HttpDagRuntimeProvider` — talks to a native DAG runtime server over HTTP.

#### `ILocalDagRuntimeProviderOptions`

| Field           | Type                   | Default                           | Description                                                                                 |
| --------------- | ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------- |
| `executionRoot` | `string`               | (required)                        | Trusted absolute root validated at provider construction and propagated to every node.      |
| `nodeRegistry`  | `IDagNodeDefinition[]` | `createDefaultNodeRegistrySync()` | Base 23-node registry. CLI uses this default and injects saved instant nodes separately.    |
| `projectDir`    | `string`               | —                                 | DAG project directory (reserved for future local node-file scanning).                       |
| `workspace`     | `IWorkspaceLayout`     | —                                 | **FLOW-007**: injected workspace layout (root dir + workflow ext) for local node discovery. |
| `instantNodes`  | `IDagNodeDefinition[]` | —                                 | Instant nodes injected by the caller's composition root.                                    |
| `extraNodes`    | `IDagNodeDefinition[]` | —                                 | Extra nodes appended at the end (test/special-purpose).                                     |
| `lineage`       | `IDagExecutionLineage` | —                                 | Trusted in-process parent lineage passed to every node in a nested child DAG run.           |

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
  → creates execution composition (runAdvancement, runOrchestrator, runQuery, runCancel)
  → creates DagFrameworkOrchestrationAdapter (the IDagOrchestrationPort impl)
  → returns IDagFramework (not yet started)

framework.start()
  → execution.runAdvancement.start()
  → the dag-worker coordinator owns the sole processOnce actor for this composition

framework.stop()
  → prompt backend closes admission and drains already-admitted submissions through waiter registration
  → runAdvancement.stop() settles observers and awaits at most the current worker step
  → prompt backend awaits every owned history-observation job
  → remains stopped; restart is rejected
```

---

## Internal Components

### Prompt advancement ownership

`DagPromptBackend` receives only run creation and `IRunAdvancementCoordinator`; it cannot reach the
raw worker step. It tracks admitted submissions and terminal-observation promises from creation,
attaches rejection handlers immediately, records a success/error history entry, and removes each job
in `finally`. Framework shutdown closes prompt admission before stopping advancement and resolves only
after those owned jobs have settled. Submitting before `framework.start()` remains supported because a
run waiter itself creates advancement demand.

### `DagFrameworkOrchestrationAdapter`

In-process implementation of the remaining `IDagOrchestrationPort` methods. The separate
`costMeta` capability is implemented by `UnsupportedCostMetaOperations` and returns `TResult` domain values. Until cost persistence and formula
execution are wired with an explicit policy, all seven cost operations return
`DAG_COST_META_UNSUPPORTED`; they do not manufacture HTTP 501 responses or URIs.

The separate `runDrafts` capability implements the five draft editing operations through the
injected `IRunDraftStore` and `IClockPort`, returns `TResult<IRunDraft, IDagError>`, and never
manufactures HTTP status codes or route URIs. Missing drafts return `DAG_RUN_DRAFT_NOT_FOUND`.

Remaining orchestration methods still use their existing HTTP-shaped response contract.
Asset storage and byte streaming are exposed separately as `framework.assets: IAssetStore`.
The orchestration adapter does not encode upload bytes, fabricate download URLs, or wrap asset
metadata in HTTP envelopes. The runtime server owns the JSON/base64 and binary HTTP mapping.

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
  `dag-adapters-local`, `dag-orchestration-client`, `dag-cost`, `dag-node`, `dag-builder`,
  `dag-projection`, and the default node packages (`dag-nodes-default`, `dag-node-*`).
- `dag-framework` MAY import neutral shared contracts from `@robota-sdk/agent-core` (the
  provider-definition and trusted-root SSOT contracts approved in ARCH-PROVIDER-003/004 and
  ARCH-010). It MUST NOT import concrete provider packages (the `agent-provider-*` family, e.g.
  `@robota-sdk/agent-provider-openai`) or the
  upper agent-runtime packages (`@robota-sdk/agent-framework`, `agent-session`, `agent-executor`,
  `agent-cli`, `agent-tools`, …). `src/__tests__/spec-dependency-rules.test.ts` holds the manifest to
  this list.
- `dag-nodes-default` owns the private async catalog: the collapsed `dag-node-llm-text` is a static
  dependency; `agent-builtin-providers` and `dag-node-gemini-image-edit` are optional dependencies;
  `dag-node-text-to-image`, `dag-node-seedance-video`, and `dag-node-skill` are regular dependencies
  loaded dynamically. This workspace catalog can reach 29 nodes when all optional loaders succeed;
  it is not used by the published CLI's `/workflows` path, which uses the synchronous 23-node base
  catalog.

---

## Peer Dependencies (optional)

| Package             | Required version | When needed                   |
| ------------------- | ---------------- | ----------------------------- |
| `openai`            | `^4.98.0`        | LLM text OpenAI node          |
| `@anthropic-ai/sdk` | `^0.80.0`        | LLM text Anthropic node       |
| `@google/genai`     | `^1.51.0`        | LLM text Gemini + image nodes |
