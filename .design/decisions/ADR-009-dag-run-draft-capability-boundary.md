# ADR-009: Give run-draft editing a domain capability

## Status

accepted

## Context

The five run-draft methods on `IDagOrchestrationPort` return HTTP envelopes even for the
in-process framework. The framework therefore manufactures status codes and route URIs while
editing `IRunDraft` through `IRunDraftStore`. The HTTP client also sends `PUT` to the reset route
that the server exposes as `POST`. This is a remaining part of issue #2163's historical issue #2156 boundary.

## Alternatives Considered

1. Keep the omnibus port and repair only the reset verb. This fixes one broken route but retains
   transport representation in the domain-facing adapter.
2. Give the five operations one `dag-core` capability returning `TResult<IRunDraft, IDagError>`.
   The framework performs draft editing; HTTP and CLI adapters translate at their edges.

## Decision

Use option 2. `dag-core` owns the operation port and its request types alongside `IRunDraft` and
`IRunDraftStore`. The framework exposes a separate `runDrafts` capability. The HTTP client decodes
responses into domain results; the server validates requests and maps results to its existing JSON
envelope. CLI output keeps the existing envelope. The reset route uses `POST` consistently.
Creating a caller-specified ID and replacing a missing draft retain their existing upsert behavior.

## Consequences

- Five methods leave `IDagOrchestrationPort`; the remaining definition, run, asset, catalog,
  build, and validation methods still require their own boundary correction.
- No storage or clock implementation moves into `dag-core`; they remain injected adapters.
- Invalid request and malformed response data are rejected at their respective trust boundaries.
- This is a partial delivery of issue #2163, not its closure.

## References

- Issue #2163 and historical issue #2156.
- `packages/dag-core/docs/SPEC.md`
- `packages/dag-framework/docs/SPEC.md`
- `packages/dag-orchestration-client/docs/SPEC.md`
- `apps/dag-runtime-server/docs/SPEC.md`
