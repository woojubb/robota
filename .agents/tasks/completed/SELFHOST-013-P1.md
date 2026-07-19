# SELFHOST-013 P1 — multi-surface deployment matrix + gateway pattern (task breakdown)

Spec: [`.agents/spec-docs/done/SELFHOST-013-multi-surface-deployment-gateway.md`](../spec-docs/done/SELFHOST-013-multi-surface-deployment-gateway.md)
(INFRA; P1 = the whole slice; design-gated GATE-APPROVAL ENDORSE). This is a **packaging + documentation + proof**
gap over the ALREADY-CORRECT transport DIP — **NO new transport, NO new package, NO new dependency edge**. The
capability (one `buildRuntimeSession` session fanned to many `IConfigurableTransport`s via
`TransportRegistry.startAll(session)`) already ships; P1 makes the pattern first-class + drift-guarded.

## Design (approved, P1)

Verified against code: the transport `name` set is exactly **`{tui, ws, webrtc, http, mcp}`** —
`readonly name = '…'` on classes (`agent-transport-tui` `tui`, `agent-transport-webrtc` `webrtc`,
`agent-transport-ws/ws-transport-configurable.ts` `ws`) + factory `name: '…'` object-literals
(`agent-transport-http` `http`, `agent-transport-mcp` `mcp`, `agent-transport-ws/ws-transport.ts` `ws`). The
presentation packages `-gui`/`-webrtc-web` and the shared `-protocol` lib export NO transport `name` (excluded).

1. **Deployment matrix** — `.agents/specs/deployment-matrix.md` (new): surface × runtime × transport-`name` ×
   client/presentation, mirroring `orchestration-map.md`. Cross-link from the transport section of
   `.agents/specs/architecture-map/agent-system.md`.
2. **Matrix drift scan (mechanical FAIL floor)** — `scripts/harness/scan-deployment-matrix.mjs` (new) +
   registered in `run-all-scans.mjs`: **enumerate transport `name`s FROM CODE** (transport packages, both
   declaration forms; exclude `-protocol`/`-gui`/`-webrtc-web`) → `codeSet`; parse the matrix's Transport-`name`
   column → `matrixSet`; **FAIL** if a code name is undocumented or a matrix name is phantom. Pure
   `findTransportNames()` + `findMatrixNames()` + a unit test with red fixtures (mirror scan conventions).
3. **Deploy guide** — `docs/` (new): the one-definition→many-channels pattern (`buildRuntimeSession(...)` →
   `register(t1); register(t2)` → `startAll(session)`; each surface keeps its own composition root + auth posture).
4. **Reference-identity proof test (TC-01)** — `packages/agent-transport/src/__tests__/` (new): build ONE
   session, `register` two **recording** transports (test-support, `defaultEnabled:true`, each captures its
   `attach()` arg), `startAll(session)`, assert `t1.attached === session && t2.attached === session` (strict
   reference identity — one session instance fanned to every enabled transport).
5. **Runnable example (TC-04)** — `examples/` (new): serve one resolved definition over ≥2 transports
   simultaneously (e.g. WS + HTTP) against one session; typechecks + smoke-runs.

## Status

**DONE (2026-07-19).** S1 (matrix+drift scan, TC-02) + S2 (proof test, TC-01) + S3 (guide+example, TC-04) done; TC-03 deps green. AGENT-RUN VERIFIED (example ran, one session over ws+http). agent-transport 47 tests, 58/58 scans. Epic ready for GATE-VERIFY→GATE-COMPLETE.

## Slices (each green + committed)

1. **S1 — matrix + drift scan** (`deployment-matrix.md` + `scan-deployment-matrix.mjs` code-enumeration ↔ matrix
   - run-all-scans registration + scan unit test) (TC-02).
2. **S2 — proof test** (`agent-transport` reference-identity, two recording transports) (TC-01).
3. **S3 — deploy guide + example** (`docs/` guide + `examples/` multi-surface program, exercised) (TC-04) + the
   `deps` scan stays green (TC-03, no new edge) + architecture-map cross-link.

## Test Plan

- **TC-01** reference-identity: one session, ≥2 recording transports, `t1.attached === t2.attached === session`
  (vitest, agent-transport).
- **TC-02** matrix drift scan: code-enumerated transport-`name` set ↔ matrix rows; undocumented / phantom → FAIL
  (scan + unit test with red fixtures).
- **TC-03** `deps` scan green — no new bidirectional prod dep / pass-through re-export / new package.
- **TC-04** the `examples/` multi-surface program serves one definition over ≥2 transports and is built/smoke-run.
- Regression: `pnpm --filter @robota-sdk/agent-transport test`, typecheck, lint, `pnpm harness:scan`.

## Capability-reachability / AGENT-RUN (per `.agents/rules/backlog-execution.md`)

TC-04 IS the agent-run capability verification: the agent itself builds + runs the `examples/` multi-surface
program (one definition → ≥2 live transports over one session) and observes both transports serving the same
session. Named as a required deliverable (not deferred) — a deployment pattern is not done until an agent can run
the documented example end-to-end.
