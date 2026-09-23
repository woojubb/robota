# ADR-010: Keep asset storage separate from orchestration HTTP transport

## Status

accepted

## Context

Issue #2163 retains historical issue #2156's domain/transport boundary. Three asset methods on
`IDagOrchestrationPort` force the in-process framework to decode base64, produce HTTP envelopes,
and invent an `inproc://` download URL. The runtime server forwards that URL as JSON from its
content endpoint, although CLI clients expect binary bytes there.

## Alternatives Considered

1. Keep asset methods on the omnibus port and repair only the content route. This restores downloads
   but leaves HTTP representation in the framework's in-process API.
2. Reuse `dag-core`'s existing `IAssetStore` as the framework's asset capability, keep a separate
   transport-only asset client interface, and map JSON/base64 and binary responses in the server.
   This changes the framework surface but avoids a duplicate domain abstraction.

## Decision

Use option 2. `framework.assets` exposes `IAssetStore`; the orchestration adapter no longer owns
asset methods. The HTTP client keeps compatible upload, metadata, and download-location methods
under `IDagAssetHttpPort`. The server decodes uploads and streams content through the store, with
explicit 400/404/500/501 mapping.

## Consequences

- In-process callers use bytes and metadata directly, without HTTP status or URLs.
- The content endpoint now returns bytes rather than a JSON descriptor, matching its client.
- Other HTTP-shaped orchestration methods remain for later issue #2163 slices; this does not close issue #2163.

## References

- Issue #2163, historical issue #2156, and ADR-009.
- `packages/dag-core/docs/SPEC.md`
- `packages/dag-framework/docs/SPEC.md`
- `packages/dag-orchestration-client/docs/SPEC.md`
- `apps/dag-runtime-server/docs/SPEC.md`
