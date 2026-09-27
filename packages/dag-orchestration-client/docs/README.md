# DAG Orchestration Client

A thin HTTP client, `DagOrchestrationHttpClient`, and the request/response types for a DAG
orchestration server's `/v1/dag/*` routes, such as `apps/dag-runtime-server`.

The client forwards server payloads without reshaping them for a CLI or tool; only its cost-metadata
and run-draft calls decode responses into typed domain results. The fetch implementation is
injected. Domain contracts stay in `dag-core` and `dag-cost`, controller composition in `dag-api`, and
routes in the server application. `dag-framework`'s `HttpDagRuntimeProvider` is built on this client.

## Documents

- [SPEC.md](SPEC.md) — scope, boundaries, design decisions and the error taxonomy.
- [Package README](../README.md) — main exports and a usage example.
