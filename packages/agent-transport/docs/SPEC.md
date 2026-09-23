# @robota-sdk/agent-transport — Package Specification

## Transport Admission (SEC-008)

transport-admission: none — this package defines and evaluates admission data but binds no listener.

## 1. Scope

The pure transport-family substrate. It owns carrier-neutral wire messages, runtime decoders,
session-message dispatch, resumable delivery, peer-message and handoff state, channel framing, and
Node-only admission/integrity helpers shared by transport implementations.

## 2. Boundaries

The root and `./client` graphs are browser-safe and depend only on interface packages. Node
cryptography is reachable only through `./node`, whose package export declares `"browser": null`.
The package owns no socket, HTTP, WebRTC, terminal, framework-host, registry, or settings lifecycle.
It does not forward another workspace package.

## 3. Architecture Overview

- `.` is the complete browser-safe substrate: `wire-messages`, message decoders, the
  `createSessionMessageHandler` bridge, session events, outbound delivery, resume support, channel
  frames, peer-message state, and handoff state/chunking.
- `./client` is the intentionally narrow browser decoder and wire-type surface used by renderers.
- `./node` owns token admission and handoff manifest hashing.
- Internal message dispatch is split by responsibility into `message-parser`,
  `session-query-messages`, `usage-messages`, `session-events`, and
  `background-messages`; none is WebSocket-specific.

## 4. Type Ownership

| Type/Symbol                                             | Location                         | Purpose                                              |
| ------------------------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| `TClientMessage`, `TServerMessage`, `TSeqServerMessage` | `src/wire-messages.ts`           | Carrier-neutral session wire union                   |
| `IProtocolSession`                                      | `src/protocol-session.ts`        | Capability aggregate consumed by the message handler |
| `ISessionMessageHandlerOptions`                         | `src/session-message-handler.ts` | Session-message bridge construction contract         |
| `TOutboundDeliver`                                      | `src/outbound-delivery.ts`       | Branded connection-scoped outbound boundary          |
| `TMessageDecodeResult`                                  | `src/message-decoders.ts`        | Total runtime decode result                          |
| `TProtocolSessionEventClassification`                   | `src/session-events.ts`          | Exhaustive event-delivery classification             |

## 5. Public API Surface

The table lists each identifier separately because the public-surface guard treats the first
identifier in each row as the documented export.

| Export                                  | Kind      | Entry            |
| --------------------------------------- | --------- | ---------------- |
| `createSessionMessageHandler`           | function  | `.`              |
| `ISessionMessageHandlerOptions`         | interface | `.`              |
| `createOutboundDelivery`                | function  | `.`              |
| `createPendingStallClock`               | function  | `.`              |
| `isOverPendingBudget`                   | function  | `.`              |
| `DEFAULT_MAX_PENDING_BYTES`             | constant  | `.`              |
| `DEFAULT_MAX_PENDING_MS`                | constant  | `.`              |
| `IPendingStallClock`                    | interface | `.`              |
| `TDeliveryErrorHandler`                 | type      | `.`              |
| `TOutboundDeliver`                      | type      | `.`              |
| `PROTOCOL_SESSION_EVENT_CLASSIFICATION` | constant  | `.`              |
| `TProtocolSessionEventClassification`   | type      | `.`              |
| `IProtocolSession`                      | interface | `.`              |
| `TClientMessage`                        | type      | `.` / `./client` |
| `TServerMessage`                        | type      | `.` / `./client` |
| `TSeqServerMessage`                     | type      | `.` / `./client` |
| `MAX_INBOUND_FRAME_BYTES`               | constant  | `.` / `./client` |
| `decodeClientMessage`                   | function  | `.` / `./client` |
| `decodeFrame`                           | function  | `.` / `./client` |
| `decodeServerMessage`                   | function  | `.` / `./client` |
| `TMessageDecodeResult`                  | type      | `.` / `./client` |
| `ResumeBuffer`                          | class     | `.`              |
| `IResumeBufferOptions`                  | interface | `.`              |
| `IBufferedFrame`                        | interface | `.`              |
| `TResumeTail`                           | type      | `.`              |
| `SessionResumeBridge`                   | class     | `.`              |
| `ISessionResumeBridgeOptions`           | interface | `.`              |
| `TResumeSink`                           | type      | `.`              |
| `IAttachOptions`                        | interface | `.`              |
| `CHANNEL_FRAME_MAGIC`                   | constant  | `.`              |
| `CHANNEL_FRAME_VERSION`                 | constant  | `.`              |
| `decodeChannelFrame`                    | function  | `.`              |
| `encodeBinaryFrame`                     | function  | `.`              |
| `encodeChannelEventFrame`               | function  | `.`              |
| `isChannelFrame`                        | function  | `.`              |
| `acknowledgePeerMessage`                | function  | `.`              |
| `admitPeerMessage`                      | function  | `.`              |
| `createPeerMessageLedger`               | function  | `.`              |
| `forgetPeerOrigin`                      | function  | `.`              |
| `IPeerMessageLedger`                    | interface | `.`              |
| `IPeerMessageRejection`                 | interface | `.`              |
| `IPeerMessageVerdict`                   | interface | `.`              |
| `advanceHandoff`                        | function  | `.`              |
| `beginHandoff`                          | function  | `.`              |
| `commitHandoff`                         | function  | `.`              |
| `handoffOutcome`                        | function  | `.`              |
| `sourceStillOwns`                       | function  | `.`              |
| `ICommitResult`                         | interface | `.`              |
| `IHandoffTransaction`                   | interface | `.`              |
| `ITransitionResult`                     | interface | `.`              |
| `chunkCountFor`                         | function  | `.`              |
| `chunkHandoffPayload`                   | function  | `.`              |
| `DEFAULT_MAX_CHUNK_BYTES`               | constant  | `.`              |
| `HandoffChunkAssembler`                 | class     | `.`              |
| `IChunkResult`                          | interface | `.`              |
| `IHandoffChunk`                         | interface | `.`              |
| `TChunkOutcome`                         | type      | `.`              |
| `TChunkRejection`                       | type      | `.`              |
| `bearerCredential`                      | function  | `./node`         |
| `credentialMatches`                     | function  | `./node`         |
| `mintTransportToken`                    | function  | `./node`         |
| `resolveAdmission`                      | function  | `./node`         |
| `buildHandoffManifest`                  | function  | `./node`         |
| `sealHandoffRecord`                     | function  | `./node`         |
| `verifyHandoffPayload`                  | function  | `./node`         |
| `IBuildManifestInput`                   | interface | `./node`         |
| `IIntegrityVerdict`                     | interface | `./node`         |
| `ISourceRuntimeState`                   | interface | `./node`         |
| `TIntegrityFailure`                     | type      | `./node`         |
| `TManifestResult`                       | type      | `./node`         |

## 6. Extension Points

Carriers supply `TOutboundDeliver` and an `IProtocolSession`; no carrier implementation is
registered inside this package.

## 7. Error Taxonomy

Runtime message and frame decoders return explicit result unions. Admission and handoff helpers
return their declared refusal/result contracts; outbound delivery isolates carrier failures through
the supplied error handler. No fallback transport is selected.

## 8. Test Strategy

The package owns the moved protocol unit tests, including session dispatch, runtime decoding,
session-event exhaustiveness, delivery backpressure, resume, channel frames, peer ledgers, handoff,
admission, and Node-only manifest integrity. Package build/typecheck/test plus browser-subpath,
transport-admission, dependency-direction, and public-surface scans verify the S3 boundary.

## 9. Class Contract Registry

| Class                   | Contract                                                        |
| ----------------------- | --------------------------------------------------------------- |
| `ResumeBuffer`          | Buffers sequence-stamped server frames under byte/count limits  |
| `SessionResumeBridge`   | Owns attach/detach/replay over a replaceable carrier sink       |
| `HandoffChunkAssembler` | Reassembles one bounded handoff payload with explicit rejection |
