# DAG Orchestration Client Specification

## Scope

Thin operational HTTP client and response contracts for Robota DAG orchestration endpoints.
This package is consumed by command-line and MCP clients that call a DAG orchestration HTTP server (e.g. `@robota-sdk/dag-runtime-server`).

## Boundaries

- Does not own DAG domain contracts. Those belong to `@robota-sdk/dag-core` and endpoint-specific domain packages such as `@robota-sdk/dag-cost`.
- Does not own API controller composition. That belongs to `@robota-sdk/dag-api`.
- Does not own server route implementations. Those belong to the server application (e.g. `@robota-sdk/dag-runtime-server`).
- Does not render UI or own CLI/MCP command behavior.

## Design Decisions

- The client is intentionally thin: it forwards server response payloads without converting them into CLI or MCP-specific output. Consumers own their own command, tool, and output formatting layers.
- Cost metadata and run drafts are implemented as separate domain capability ports: the client validates HTTP payloads and maps successes/problems to typed domain results, but neither group's methods belong to the general orchestration port.
- Pipeline building has an independent domain capability owned by `dag-builder`; the concrete HTTP client retains its transport-facing build request, but the general orchestration port does not require an HTTP-shaped build result.
- Catalog-aware definition validation is a domain capability owned by `dag-core`; the concrete HTTP client retains its transport-facing validation request, but the general orchestration port does not require an HTTP-shaped validation result.
- Registered-node catalog access is a domain capability owned by `dag-core`; the concrete HTTP client retains its transport-facing node-list request, but the general orchestration port does not require an HTTP-shaped catalog result.
- Definition listing and lookup are domain capabilities owned by `dag-core`; the concrete HTTP client retains transport-facing read requests, but the general orchestration port does not require HTTP-shaped definition reads.
- Definition lifecycle changes are domain capabilities owned by `dag-core`; the concrete HTTP client retains transport-facing create, update, validation, and publish requests, but the general orchestration port does not require HTTP-shaped mutation results.
- Run lifecycle is a domain capability for in-process callers; this package's orchestration port
  remains a transport-only contract for the concrete remote HTTP client. In-process frameworks
  do not implement it or construct HTTP response envelopes.
- Asset upload, metadata, and content-download URL methods belong to a transport-specific asset port, not the general orchestration port. In-process consumers use `IAssetStore` from `dag-core` instead.
- Binary asset content is intentionally not fetched or buffered by this client. Consumers locate the streaming endpoint via the client and own their transport-specific byte handling and output formatting.
- The fetch implementation is injectable, so tests, CLIs, MCP servers, and alternate runtimes can supply their own fetch-compatible implementation.
- Endpoint coverage is intentionally limited to routes whose operational request/response contracts are already package-owned. CLI and MCP packages may add a command or tool only after an endpoint group's contracts are owned this way. A run-progress WebSocket endpoint is deliberately not wrapped yet — it needs bridge contract tests first. Admin bootstrap and the runtime asset proxy are intentionally out of scope for operational clients.

## Error Taxonomy

Server-originated errors are represented structurally; the canonical server-side problem-details mapping remains owned by `@robota-sdk/dag-api`, and this package keeps only the structural client-facing payload shape needed by operational clients.

Cost metadata responses are decoded at the HTTP boundary. Malformed success data returns
`DAG_COST_META_INVALID_RESPONSE`; recognized `DAG_COST_META_*` and `CEL_*` problem codes are
preserved, and missing/invalid/unsupported HTTP statuses map to domain codes when the problem
has no recognized code. An unsupported capability is non-retryable.

Run-draft responses are decoded at the HTTP boundary. Malformed successful drafts return
`DAG_RUN_DRAFT_INVALID_RESPONSE`; known run-draft problem codes are preserved, missing drafts
return `DAG_RUN_DRAFT_NOT_FOUND`, and transport failures return a typed retryable error.
