# DAG API

The API layer of the DAG engine: design, runtime, observability and diagnostics controllers, their
request/response types and service ports, and the `IProblemDetails` error envelope.

`@robota-sdk/dag-api` is the single source for the API error envelope (RFC 7807-style, with a
URN-based `type`) and for the controllers' request, response and port types. Controllers delegate
through narrow ports, so the package depends only on `@robota-sdk/dag-core`; runtime logic, worker
execution and framework assembly live in `dag-runtime`, `dag-worker` and `dag-framework`, and the HTTP
client in `dag-orchestration-client`. It also provides `PromptApiController` for the prompt-format API
and `RunProgressEventBus` for run progress events.

## Documents

- [SPEC.md](SPEC.md) — scope, boundaries, contract guarantees and extension points.
- [Package README](../README.md) — main exports and a composition example.
