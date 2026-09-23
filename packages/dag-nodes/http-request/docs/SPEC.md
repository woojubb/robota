# HTTP Request Node Specification

## Purpose

The `http-request` DAG node executes an HTTP/HTTPS request and emits the status code, response
body, success flag, and response headers.

## Contract

- URL, headers, and body can each be set via config or overridden by the matching input port at
  runtime; headers are merged (config as base, input port on top) rather than replaced.
- A request that resolves to no URL fails validation rather than being sent.
- Timeouts and network failures are returned as structured task-execution failures — never thrown
  exceptions — and are distinguished from each other using the node's own abort signal, not by
  pattern-matching the error message (a prior bug misclassified network errors whose message
  happened to contain "abort").
- Cost estimate is always zero.

## Boundaries

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`; does not redefine core DAG
  contracts.
- Uses the platform `fetch` API with `AbortController` for timeout enforcement — no bundled HTTP
  client dependency.
