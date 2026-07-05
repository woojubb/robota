# HTTP Request Node Specification

## Scope

- Owns the `http-request` DAG node definition.
- Executes an HTTP/HTTPS request and emits the status code, response body, success flag, and response headers.

## Boundaries

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`. Does not redefine core DAG contracts.
- Uses the global `fetch` API (Node.js 18+) with `AbortController` for timeout enforcement.
- Input validation uses `NodeIoAccessor` and error builders from `@robota-sdk/dag-core`.

## Architecture Overview

- `HttpRequestNodeDefinition` — node that accepts optional `url`, `body`, and `headers` input ports and produces `statusCode`, `body`, `ok`, and `headers` output ports.
- URL resolution: input port value overrides `config.url`.
- Headers: `config.headers` provides base headers; the `headers` input port merges on top.
- Body: input port value overrides `config.body`.
- Timeout: `config.timeoutMs` (default 10 000 ms) enforced via `AbortController`.
- Network errors and timeouts are converted to structured `TResult` failures — no unhandled exceptions.
- Zero cost estimate (`estimatedCredits: 0`).

## Type Ownership

| Type                        | Location       | Purpose                   |
| --------------------------- | -------------- | ------------------------- |
| `HttpRequestNodeDefinition` | `src/index.ts` | Node definition class     |
| `HttpRequestConfigSchema`   | `src/index.ts` | Zod config schema (local) |

## Public API Surface

- `HttpRequestNodeDefinition` — class (default export via package index)

## Extension Points

- Config `method`: `GET` | `POST` | `PUT` | `PATCH` | `DELETE` (default `GET`).
- Config `url`: static URL (overridable at runtime via the `url` input port).
- Config `headers`: base headers record (merged with the `headers` input port at runtime).
- Config `timeoutMs`: request timeout in milliseconds.
- Error codes: `DAG_VALIDATION_HTTP_REQUEST_URL_REQUIRED`, `DAG_TASK_EXECUTION_HTTP_REQUEST_FAILED`.
