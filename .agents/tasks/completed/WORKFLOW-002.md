# WORKFLOW-002 — Native DAG runtime-server

Spec: .agents/spec-docs/done/WORKFLOW-002-native-runtime-server.md
Status: **done**. Server surface + SSE events (Phase A, #896) + HttpDagRuntimeProvider (Phase B, #897) + provider resolution (Phase C). All TC-01..05 met.

## Decision (recorded)

- Native `/v1/dag/*` HTTP server over Hono. No external-runtime surface, no compat layer/wrapper.
- Mechanical mapping: each route → `framework.client.<method>()` (IDagOrchestrationPort) →
  `c.json(response.payload, response.status)` (uniform `IDagOrchestrationHttpResponse`).
- `createDagFramework()` provides the in-process `IDagOrchestrationPort` (`.client`).

## Phases

### Phase 1 — Server app

- [x] `apps/dag-runtime-server` (package.json/tsconfig/tsdown/docs) — AGPL; deps hono + dag-framework + dag-orchestration-client (types) + dag-core.
- [x] `createDagRuntimeServer(framework)` → Hono app mapping `/v1/dag/*` routes to the port methods
      (nodes, definitions, runs lifecycle; assets/cost-meta/run-drafts as the surface fills in).
- [x] Thin `serve` entry (@hono/node-server) — `startDagRuntimeServer()`.

### Phase 2 — Contract test

- [x] `app.request()` round-trip: `GET /v1/dag/nodes` returns the catalog; `/v1/dag/definitions` < 500.
- [x] `grep -i` for the external-runtime name over `apps/dag-runtime-server/src` → only de-branding
      negations ("No external-runtime surface", unknown-route 404 assertion); no live external-runtime plumbing.

### Phase 3 — Verify

- [x] typecheck + build + test (3 passing) green; `pnpm harness:scan` 38/38 green (new app documented in
      project-structure + capability-placement pattern).

### Phase A — SSE progress stream (#896)

- [x] `GET /v1/dag/runs/:id/events` streams a run's progress as Server-Sent Events from an injected
      `IRunProgressSource` (the framework's `runProgressEventBus`); 501 when no source is wired.
      Write-chain serialization flushes the terminal event before the stream closes.

### Phase B — HttpDagRuntimeProvider

- [x] `HttpDagRuntimeProvider implements IDetachableRunProvider` (`packages/dag-framework`) — drives a
      remote native server over `/v1/dag/*`: `submitRun` (createRun+startRun), `watchRun` (SSE +
      terminal-poll race, so attaching to an already-finished run can't hang), `getRunStatus`, `listNodes`.
      `cancelRun`/`listRuns` reject plainly (no server endpoint) rather than fake success.
- [x] Shared `run-result-mapping.ts` SSOT (`isTerminalStatus`/`collectOutputsFromTaskRuns`/`extractFinalText`/
      `extractRunError`/`mapRunToResult`); `LocalDagRuntimeProvider` refactored to consume it (duplicates removed).
- [x] Round-trip test (`apps/dag-runtime-server`): `HttpDagRuntimeProvider` against the in-process server via
      `app.request` fetch — listNodes, full execute (submit→watch→result), terminal status, unsupported-op rejects.
- [x] typecheck + build + lint (0 errors) + tests (13 server / 110 framework) green; `pnpm harness:scan` 39/39 green.

### Phase C — Provider resolution (TC-04)

- [x] dag-cli `resolve-provider` gained the `http` branch → `HttpDagRuntimeProvider({ baseUrl })`; URL from
      `--server-url` (wins) else `DAG_RUNTIME_SERVER_URL`; errors if `http` with no URL. `listAvailableProviders` + `runs` help updated. Unit-tested (`resolve-provider.test.ts`).
- [x] dag-mcp-server HTTP mode keyed on the canonical `DAG_RUNTIME_SERVER_URL` (was `ROBOTA_DAG_SERVER_URL`);
      `--server-url` flag still wins. Default aligned to the native server (:3939). Config tests updated.
- [x] typecheck + tests green (dag-cli 992, dag-mcp-server 14).

#### Follow-up (out of Phase C scope)

- dag-cli's **legacy generic server dispatch** (`runner.ts` `parseGlobalConfig` + `runs` server-dispatch +
  studio) still reads `ROBOTA_DAG_SERVER_URL` (default :3012) — a distinct orchestration-dispatch path.
  Consolidating it onto `DAG_RUNTIME_SERVER_URL` (+ default-port decision :3012 vs :3939) touches
  out-of-box behavior and is left as a separate naming-consolidation task, not folded into Phase C.

## TC Coverage Map

| TC                                    | Covered by                          |
| ------------------------------------- | ----------------------------------- |
| TC-01 (R1 routes, external-runtime 0) | Phase 1, Phase 2                    |
| TC-02 (provider/port impl typechecks) | Phase 1, Phase 3                    |
| TC-03 (client↔server round-trip)      | Phase 2, Phase B (provider e2e)     |
| TC-04 (provider resolution)           | Phase C (follow-on: CLI/MCP wiring) |
| TC-05 (harness + dag tests)           | Phase 3                             |

## Test Plan / 검증

Mechanical. Hono `app.request()` contract round-trips over `/v1/dag/*`; `rg` external-runtime-name absence; typecheck +
`pnpm harness:scan` exit 0. HttpDagRuntimeProvider + provider-resolution (TC-04) tracked as follow-on
once the server surface is complete. No manual rows.
