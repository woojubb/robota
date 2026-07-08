# DAG System Architecture

DAG workflow engine: node-graph definition, in-process runtime execution, run lifecycle/persistence, and the CLI / MCP / scheduler surfaces (absorbed via WORKFLOW-001, decoupled from the external workflow runtime).

Back to [System Architecture Map](../ARCHITECTURE-MAP.md).

## Layer Map

```mermaid
flowchart TD
  Core["dag-core\nruntime-provider + workflow-file contracts, engine types, lifecycle services"]
  Node["dag-node\nnode-definition assembly + manifests"]
  Cost["dag-cost\ncost-metadata domain types"]
  Builder["dag-builder\nIDagDefinition ↔ .dag.json conversion"]
  AdaptersLocal["dag-adapters-local\nin-memory storage/queue/clock/lease ports"]
  AdaptersSqlite["dag-adapters-sqlite\nSQLite persistence adapter"]
  Api["dag-api\nserver-side API response mapping/contracts"]
  Runtime["dag-runtime\nrun lifecycle services (create/start/query/cancel)"]
  Worker["dag-worker\nworker-loop driver + in-process execution"]
  Projection["dag-projection\nrun projection / read models"]
  OrchClient["dag-orchestration-client\nthin HTTP client + contracts"]
  Framework["dag-framework\nassembly: createDagFramework, LocalDagRuntimeProvider, default node registry"]
  Nodes["dag-nodes/*\nnode-family packages (@robota-sdk/dag-node-*)"]
  Cli["dag-cli\nrobota-dag command product"]
  Mcp["dag-mcp-server\nstandalone MCP server"]
  Scheduler["dag-scheduler\nscheduled-run triggering"]

  Node --> Core
  Cost --> Core
  Builder --> Core
  AdaptersLocal --> Core
  AdaptersSqlite --> Core
  Api --> Core
  Runtime --> Core
  Worker --> Core
  Projection --> Core
  OrchClient --> Builder
  Nodes --> Node
  Framework --> AdaptersLocal
  Framework --> Runtime
  Framework --> Worker
  Framework --> Projection
  Framework --> Nodes
  Framework --> OrchClient
  Cli --> Framework
  Cli --> Nodes
  Mcp --> Framework
  Scheduler --> Runtime
```

## Layers and boundary contracts

| Layer          | Packages                                                                             | Owns / boundary contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation     | `dag-core`                                                                           | Zero dag-deps. Runtime-provider (`IDagRuntimeProvider`, `IDagNodeManifest`, `INodePortSpec`), workflow-file format, engine types, lifecycle services. SSOT for DAG domain contracts.                                                                                                                                                                                                                                                                                                                                  |
| Domain / nodes | `dag-node`, `dag-cost`, `dag-builder`                                                | Node-definition assembly + manifests; cost-metadata types; `IDagDefinition` ↔ `.dag.json` conversion. Depend only on core.                                                                                                                                                                                                                                                                                                                                                                                            |
| Adapters       | `dag-adapters-local`, `dag-adapters-sqlite`                                          | Concrete storage/queue/clock/lease ports (in-memory; SQLite). Injected at the composition root; no domain logic.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Runtime / API  | `dag-runtime`, `dag-worker`, `dag-projection`, `dag-api`, `dag-orchestration-client` | Run lifecycle services; worker-loop execution; read-model projection; server-side API contracts; thin HTTP client.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Assembly       | `dag-framework`                                                                      | Composition layer: `createDagFramework`, the local in-process `IDagRuntimeProvider`, default node registry. The only place ports wire to adapters.                                                                                                                                                                                                                                                                                                                                                                    |
| Surfaces       | `dag-cli`, `dag-mcp-server`, `dag-scheduler`                                         | Product shells: `robota-dag` CLI; standalone MCP server; scheduled-run triggering. Assemble framework + selected nodes.                                                                                                                                                                                                                                                                                                                                                                                               |
| Nodes          | `dag-nodes/*` (`@robota-sdk/dag-node-*`)                                             | Node-family packages: llm-text providers, image edit, http, file r/w, mcp-tool, router, instant-node, utility-text. Depend on `dag-core`/`dag-node`; several also consume the `agent-*` subsystem one-way — `agent-core`/`agent-provider` (LLM-text, image, video, instant-node families), `agent-tools` (tool node), `agent-framework`/`agent-interface-transport` (skill node). This DAG→agent edge is one-directional (no `agent-*` package depends back on a DAG package). Consumed by `dag-framework`/`dag-cli`. |

## Provider model (native)

The runtime is provider-abstracted via `IDagRuntimeProvider` (catalog `listNodes()` + `execute()`),
with a detachable variant `IDetachableRunProvider` (submit/watch/status/cancel/list). Two providers
ship in `dag-framework`:

- `LocalDagRuntimeProvider` — the default in-process provider (`IDagRuntimeProvider`).
- `HttpDagRuntimeProvider` — the native runtime-server client and first `IDetachableRunProvider`
  implementation, talking to the `/v1/dag/*` surface served by `apps/dag-runtime-server`
  (**WORKFLOW-002**, delivered).

The external-runtime provider was excluded on absorption. The agent-cli `/workflows` command surface
is **WORKFLOW-003**.

## Owner SPECs

Relationship + boundary detail lives here; per-package contracts are owned by each package's SPEC:
[`dag-core`](../../../packages/dag-core/docs/SPEC.md) ·
[`dag-framework`](../../../packages/dag-framework/docs/SPEC.md) ·
[`dag-runtime`](../../../packages/dag-runtime/docs/SPEC.md) ·
[`dag-cli`](../../../packages/dag-cli/docs/SPEC.md) ·
[`dag-mcp-server`](../../../packages/dag-mcp-server/docs/SPEC.md) ·
[`dag-orchestration-client`](../../../packages/dag-orchestration-client/docs/SPEC.md).
