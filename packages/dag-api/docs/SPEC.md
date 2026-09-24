# DAG API Specification

## Scope

API-layer contracts and thin controllers for DAG design, runtime, diagnostics, and observability
operations. This package exposes endpoint-facing request/response shapes, controller
implementations, and the narrow service ports those controllers consume.

## Boundaries

- Does not own core domain contracts (`IDagDefinition`, `IDagRun`, `ITaskRun`, state machines) —
  those belong to `dag-core`.
- Does not own runtime orchestration logic, worker execution, advancement lifecycle, DLQ behavior,
  or projection read-model logic — controllers delegate only through the ports they consume.
  Worker execution and advancement belong to `dag-worker`; assembly composition belongs to
  `dag-framework`.
- Does not own operational HTTP client behavior — that belongs to `@robota-sdk/dag-orchestration-client`.
- Depends on `dag-core` only for production domain contracts. Runtime, worker, scheduler, and
  projection packages must not be production dependencies of this package.

## Contract guarantees

- This package is the SSOT for the API error envelope (`IProblemDetails`, RFC 7807-style) and for
  the request/response/port types of the design, runtime, diagnostics, and observability
  controllers.
- All API errors are mapped to the `IProblemDetails` shape with a URN-based `type` field, so
  callers can branch on error category without parsing message text.
- Definition-list grouping follows the domain summary policy in `dag-core`; this API layer only
  adds the transport response envelope.
- The in-process run lifecycle port reports run preparation, start, reads, and cancellation as
  domain results, with implicit definition create/publish failures identifying their phase without
  carrying HTTP status or problem details — the server chooses the public error response.
- Composition factories accept port interfaces rather than concrete implementations, so callers can
  substitute custom `IStoragePort`, `IQueuePort`, `IClockPort`, `ILeasePort`, and
  `ITaskExecutorPort` implementations without touching controller code.

## Extension points

- A node catalog port can be implemented to provide runtime node-type listing and async node type
  validation; it returns a result type so catalog/runtime failures are mapped to API problem
  details instead of escaping the controller layer.
- A diagnostics policy port configures whether dead-letter reinject is enabled; when disabled,
  reinject requests fail with a dedicated policy error rather than attempting the operation.
