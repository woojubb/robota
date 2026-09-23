# ADR-008: Separate DAG cost capability from orchestration HTTP envelopes

## Status

accepted

## Context

The DAG orchestration port currently includes seven cost-metadata operations returning HTTP
responses. Its in-process implementation fabricates HTTP 501 responses for all seven. The
operational HTTP client also targets `/v1/cost-meta`, while the runtime server exposes
`/v1/dag/cost-meta`. This makes cost capability unavailable and obscures whether the failure is
unsupported domain behavior or a transport problem. #2163 retains the broader #2156 boundary.

## Alternatives Considered

1. **Keep the omnibus port and correct only the URLs** — small and compatible, but the framework
   still manufactures transport envelopes and all seven cost operations remain unavailable.
2. **Split cost metadata into a domain-result capability** — changes the TypeScript contract and
   requires explicit edge mapping, but separates availability and domain outcomes from HTTP.
3. **Implement persistence and formula evaluation in the framework immediately** — adds usable
   behavior, but exposes untrusted formulas and writes before the resource and validation policy in
   #2163 is ready. It also leaves the wrong ownership boundary unless paired with option 2.

## Decision

`dag-cost` owns a seven-operation cost capability returning typed domain results. The HTTP client
implements it by decoding endpoint responses. The framework exposes the capability separately
from its orchestration client and reports a typed unsupported result until execution, validation,
and storage policy are ready. The runtime server maps that result to the existing HTTP routes; the
CLI maps it to its existing command output. The seven methods leave `IDagOrchestrationPort`.
The HTTP client uses the server's `/v1/dag/cost-meta` paths.

## Consequences

- The embedded implementation no longer invents HTTP status codes or URIs for cost operations.
- HTTP and CLI edges must validate responses and map domain errors explicitly.
- Cost CRUD and formula execution remain unsupported in the embedded framework; this is an
  architectural partial delivery for #2156, not completion of all #2163 work.
- The remaining definition, run, asset, draft, and validation operations still return HTTP-shaped
  results and require later boundary migration.

## References

- #2163 and historical #2156.
- `packages/dag-cost/docs/SPEC.md`
- `packages/dag-orchestration-client/docs/SPEC.md`
- `packages/dag-framework/docs/SPEC.md`
- `apps/dag-runtime-server/docs/SPEC.md`
