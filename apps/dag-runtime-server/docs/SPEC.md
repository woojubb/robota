# DAG Runtime Server Specification

## Purpose

Native DAG runtime HTTP server. Exposes an in-process DAG framework's run, definition, build,
validation, node-catalog, cost, and asset capabilities over HTTP, owning the route-to-port mapping and
the server entrypoint.

## Contract

- Does not own DAG domain logic, or the orchestration/cost/run-draft contracts — those belong to
  `@robota-sdk/dag-framework`, `dag-orchestration-client`, `dag-cost`, and `dag-core`; this app only
  exposes them over HTTP.
- Carries no external-runtime API surface or compatibility layer; any such adapter lives outside this
  repository.
- Run cancellation defers to the in-process lifecycle's committed-state decision: a winning cancel
  answers 200, a missing run answers 404, and an invalid terminal transition is rejected without
  rewriting the already-decided winner.
- An unwired or unsupported cost capability answers `501` rather than a fabricated success.
- Asset uploads are validated at the HTTP boundary (malformed JSON/base64, invalid IDs, non-printable
  media types all reject with 400); the content route does not dereference external reference URIs
  until the store enforces connect-time address safety, and streaming errors after headers are sent
  abort the response rather than completing with silently truncated content.
- Storage failures on cost, asset, and run-draft routes are redacted as a generic 500, never exposing internal
  paths or storage errors.
- `startDagRuntimeServer()` captures the server process's own working directory as the trusted DAG
  execution root and passes it explicitly to the framework, rather than trusting a caller-supplied path.
- Asset HTTP request, envelope, error, and binary response schemas are specified in
  [`openapi-assets.yaml`](./openapi-assets.yaml).

## Non-goals

- No standalone DAG CLI or external-runtime compatibility surface.
