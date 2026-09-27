# @robota-sdk/dag-framework

Embeddable, in-process composition of the DAG engine. `createDagFramework()` wires storage, queues,
the task executor, the worker, the run advancement actor, API controllers, the prompt backend and an
asset store into one object; the package also provides `LocalDagRuntimeProvider` and
`HttpDagRuntimeProvider` for running a definition locally or on a remote DAG server.

Internal package: private to this monorepo (`"private": true`) and not published to npm. It is part of
the DAG workflow subsystem; see [the DAG packages](../dag-core/README.md#the-dag-packages).

## Where it sits

- Depends on: [`dag-core`](../dag-core/README.md), [`dag-node`](../dag-node/README.md),
  [`dag-builder`](../dag-builder/docs/README.md), [`dag-cost`](../dag-cost/README.md),
  [`dag-runtime`](../dag-runtime/README.md), [`dag-worker`](../dag-worker/README.md),
  [`dag-projection`](../dag-projection/README.md), [`dag-api`](../dag-api/README.md),
  [`dag-adapters-local`](../dag-adapters-local/README.md),
  [`dag-orchestration-client`](../dag-orchestration-client/README.md) and `@robota-sdk/agent-core`.
  [`dag-nodes-default`](../dag-nodes-default/docs/README.md) is an optional dependency, loaded lazily
  only when no `nodes` are passed; it is not re-exported.
- Used by: [`@robota-sdk/agent-command-workflows`](../agent-command-workflows/README.md), whose
  `/workflows` command runs definitions through `LocalDagRuntimeProvider`, and
  [`apps/dag-runtime-server`](../../apps/dag-runtime-server/docs/README.md), which serves a
  `createDagFramework()` instance over `/v1/dag/*`.

## Main exports

- `createDagFramework(options)` — async; returns an `IDagFramework` with domain capabilities
  (`runs`, `build`, `validation`, `catalog`, `definitionReads`, `definitionMutations`, `costMeta`,
  `runDrafts`, `assets`), `internals` for embedders, and `start()` / `stop()`. None of them returns
  HTTP envelopes. In this composition `costMeta` reports an explicit "unsupported" result.
- `LocalDagRuntimeProvider` — an `IDagRuntimeProvider` that runs one `IDagDefinition` in process
  with `execute(definition, inputs, options?)` and lists nodes with `listNodes()`.
- `HttpDagRuntimeProvider` — the same provider contract plus detached runs (`submitRun`,
  `watchRun`, `getRunStatus`, `cancelRun`) against a DAG server, using
  `DagOrchestrationHttpClient`.
- `createExecutionComposition`, `DagPromptBackend`, `LocalFsAssetStore` — the lower-level pieces
  `createDagFramework()` is built from.
- `scanWorkspaceCatalog(dir, layout?)` — returns the workflow definitions saved in a workspace
  directory, with the metadata from each file's `meta` block; malformed and non-workflow files are
  skipped.

Key options of `createDagFramework()`:

- `paths.storageRoot` and `paths.assetRoot` are required unless you pass `ports.storage` and
  `ports.assetStore`. The factory does not fall back to environment variables or the home directory.
- `executionRoot` is the trusted absolute directory passed to every node; it defaults to
  `process.cwd()` only at this factory.
- `nodes` replaces the default catalog; `providers` binds the default `llm-text` node and is ignored
  when `nodes` is set.
- `autoStart: true` starts the advancement actor during creation; otherwise call `start()`.

Each framework owns one queue-scoped run advancement actor. `framework.start()` begins persistent
advancement and `framework.stop()` closes prompt admission, lets the in-flight worker step finish
and settles the jobs the framework owns. `internals.execution` exposes `runAdvancement` for
observing a run until it is terminal, but never the raw worker loop, so SDK, CLI and prompt
consumers cannot compete to advance the same queue.

## Usage

```ts
import type { IDagDefinition } from '@robota-sdk/dag-core';
import { createDagFramework } from '@robota-sdk/dag-framework';
import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';

const framework = await createDagFramework({
  executionRoot: '/path/to/project',
  nodes: createDefaultNodeRegistrySync(),
  paths: { storageRoot: '/path/to/dag/storage', assetRoot: '/path/to/dag/assets' },
});
await framework.start();

const definition: IDagDefinition = {
  dagId: 'hello',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'src', nodeType: 'input', dependsOn: [], config: { text: 'hello world' } },
    { nodeId: 'out', nodeType: 'text-output', dependsOn: ['src'], config: {} },
  ],
  edges: [{ from: 'src', to: 'out', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
};

// createRun stores and publishes the definition if needed, then creates the run.
const created = await framework.runs.createRun({ definition });
if (created.ok) {
  const { dagRunId } = created.value;
  await framework.runs.startRun(dagRunId);
  const terminal = await framework.internals.execution.runAdvancement.waitForTerminal(dagRunId);
  if (terminal.ok) console.log(terminal.value.dagRun.status); // 'success'
}

await framework.stop();
```

To run a single definition in process with in-memory storage, use the local provider:

```ts
import { LocalDagRuntimeProvider } from '@robota-sdk/dag-framework';

const provider = new LocalDagRuntimeProvider({ executionRoot: '/path/to/project' });
const result = await provider.execute(definition, {});
console.log(result.ok, result.outputs); // outputs are keyed '<nodeId>.<port>', e.g. 'out.text'
```

## Documentation

- [docs/README.md](docs/README.md) — overview of this package's docs.
- [docs/SPEC.md](docs/SPEC.md) — the contract: composition and lifecycle, budgets and bounds, and
  local regex isolation.
