# @robota-sdk/agent-transport — Package Specification

## Transport Admission (SEC-008)

transport-admission: none — the S2 parent has no peer-admitting implementation.

## 1. Scope

The transport-family substrate package. During STRUCT-012 S2 its root is deliberately empty:
runtime-host behavior has moved to `@robota-sdk/agent-framework`, and terminal I/O belongs
to `agent-cli`. Protocol absorption is the subsequent S3 unit, not an implemented feature here.

## 2. Boundaries

No framework/core dependency in any manifest section and no Node builtin in the root graph.
No compatibility forwarding exports. Host execution, programmatic driving, registry lifecycle and
settings repositories are governed by the framework SPEC; CLI owns terminal input/output.
Family placement is governed by the architecture map, not a duplicate layer table here.

## 3. Architecture Overview

`src/index.ts` is a valid empty module. No headless/programmatic build entries or subpath remain.

## 4. Type Ownership

None during the S2 transition. Shared adapter contracts remain in their interface owners.

## 5. Public API Surface

No runtime or type exports during S2. Import the moved host symbols from the framework root.

## 6. Extension Points

None during S2; host transport registration is owned by the framework.

## 7. Error Taxonomy

No implementation errors originate here during S2. Existing host errors retain their contracts
at the new framework owner.

## 8. Test Strategy

Host tests moved with their implementation to framework `src/transport-host/`; real-command
composition and terminal I/O tests moved to CLI. The session-event-delivery example is CLI-owned;
its former Linux recording is preserved byte-identically in
`.agents/archive/struct012-s2/agent-transport-session-event-delivery.record.json`.
Package build/typecheck and the dependency/public-surface scans protect this interim empty entry.

## 9. Class Contract Registry

None during S2. The framework SPEC owns the moved runtime-host class relationships.
