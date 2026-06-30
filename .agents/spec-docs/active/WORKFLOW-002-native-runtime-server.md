---
status: in-progress
type: API
tags: [typescript, rest]
---

# WORKFLOW-002: Native DAG runtime-server API (R1) + absorption

## Problem

WORKFLOW-001 absorbed the DAG backend but **excluded `apps/dag-runtime-server`** — the inbound HTTP
server that executes DAGs for remote clients — because its API shape mirrored the external runtime's
API surface, which is out of scope for this repo (the same blocker WORKFLOW-001 documented).

Consequence: the absorbed DAG subsystem currently has **only the local in-process provider**
(`LocalDagRuntimeProvider`). There is no remote/server execution path — `dag-mcp-server`'s HTTP mode and
`dag-cli`'s `dag runs` detached-run surface point at "a runtime server" that does not exist in robota.
The `IDetachableRunProvider` contract (submit/watch/status/cancel/list) has no HTTP implementation.

To restore remote execution **without** importing the external runtime's API shape, the runtime-server
must be **redesigned to a robota-native execution contract (R1)** before it enters the repo. This spec
defines that native contract and the absorption.

Reproduction: `dag-cli --provider <non-local>` and `dag-mcp-server --server-url <url>` have no server to
talk to; `IDetachableRunProvider` has no production HTTP implementation in robota.

## Architecture Review

### Affected Scope

- **New (app):** `apps/dag-runtime-server` — a robota-native HTTP server implementing the DAG runtime
  contract over a native route surface (NOT the external runtime's API surface).
- **New/extended (provider):** a native `HttpDagRuntimeProvider` implementing `IDagRuntimeProvider` +
  `IDetachableRunProvider` against the R1 routes — restoring the remote provider for `dag-cli` and
  `dag-mcp-server` HTTP mode (which already speak `IDagOrchestrationPort`/`DagOrchestrationHttpClient`).
- **Reuses:** `dag-core` contracts (catalog/manifest/run lifecycle), `dag-orchestration-client`
  (`DagOrchestrationHttpClient`, the existing native HTTP client), `dag-runtime`/`dag-worker`
  (execution services). The server is a thin shell wiring these to HTTP routes.
- **Out of scope:** external-runtime compatibility is out of scope here and is not pursued in any form.
  Any such adapter lives in a separate source repository and would branch from there if ever needed;
  this repo carries no compatibility layer, adapter, or wrapper.

### R1 — the native execution contract (proposed, for approval)

A robota-native route surface keyed on the existing `dag-core` lifecycle, not the external runtime's:

| Concern        | Native route (R1)                      | Maps to                                                  |
| -------------- | -------------------------------------- | -------------------------------------------------------- |
| Node catalog   | `GET /v1/dag/nodes`                    | `IDagRuntimeProvider.listNodes()` → `IDagNodeManifest[]` |
| Submit run     | `POST /v1/dag/runs`                    | `IDetachableRunProvider.submitRun()` → `runId`           |
| Run status     | `GET /v1/dag/runs/:runId`              | `getRunStatus()` → `IDagRunStatus`                       |
| Watch progress | `GET /v1/dag/runs/:runId/events` (SSE) | `watchRun()` → `IDagRuntimeProgressEvent` stream         |
| Cancel         | `POST /v1/dag/runs/:runId/cancel`      | `cancelRun()`                                            |
| List runs      | `GET /v1/dag/runs`                     | `listRuns()`                                             |

This aligns with the `/v1/dag/*` paths `dag-orchestration-client` already constructs — so the existing
native HTTP client is the server's client with no external-runtime shape anywhere.

### Alternatives Considered

1. **Re-import the external-runtime API server from the origin repository as-is.** Pro: least work.
   Con: lands the external-runtime API shape into history — the exact blocker WORKFLOW-001 was built to
   avoid. Rejected.
2. **Native R1 runtime-server over the existing `/v1/dag/*` contract + native HTTP provider (chosen).**
   Pro: restores remote execution with zero external-runtime surface; reuses `dag-orchestration-client`
   and the run-lifecycle services. Con: a route layer + provider must be authored fresh. Accepted.
3. **No server — local provider only, forever.** Pro: nothing to build. Con: permanently drops remote
   execution, the MCP HTTP mode, and detached runs — a capability regression vs. robota-dag. Rejected.

### Decision (proposed — requires GATE-APPROVAL)

Alternative 2: build `apps/dag-runtime-server` as a native HTTP server over the R1 `/v1/dag/*` contract
and a `HttpDagRuntimeProvider` implementing the detachable-run provider against it, reusing
`dag-orchestration-client` + the run-lifecycle services. No external-runtime API surface enters the repo
and no compatibility layer/wrapper is built — external-runtime compatibility is out of scope here.
**This changes the product's remote-execution surface, so it is held at review-ready for
product-direction approval before implementation.**

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — new app + native provider; reuses dag-core/orchestration-client/runtime/worker.
- [x] Sibling scan 완료 — confirmed `dag-orchestration-client` already speaks native `/v1/dag/*`; `IDetachableRunProvider` lacks an HTTP impl; `dag-mcp-server` HTTP mode + `dag-cli` `dag runs` await a server.
- [x] 대안 최소 2개 검토 완료 — 3개 (reimport-external-runtime / native-R1 / no-server).
- [x] 결정 근거 문서화 완료 — native contract reuses existing client/paths; external-runtime compatibility out of scope (no layer/wrapper here; any such adapter stays in a separate source repository); held for product approval.

## Solution

Phased (post-approval): (A) finalize the R1 OpenAPI/route contract over `/v1/dag/*` mapped to
`IDagRuntimeProvider`/`IDetachableRunProvider`. (B) implement `apps/dag-runtime-server` (route layer +
composition over `dag-runtime`/`dag-worker`/adapters). (C) implement `HttpDagRuntimeProvider`; re-enable
the non-local provider path in `dag-cli`/`dag-mcp-server`. (D) contract tests client↔server; green
build/test/harness.

## Affected Files

- New: `apps/dag-runtime-server/**`, a native `HttpDagRuntimeProvider` (in `dag-framework` or a new
  `dag-provider-http` package — decided at GATE-APPROVAL), R1 route/contract docs.
- Edited: `dag-cli`/`dag-mcp-server` provider resolution (restore non-local path against R1).

## Completion Criteria

- [ ] TC-01: `apps/dag-runtime-server` exposes the R1 `/v1/dag/*` routes (nodes, runs submit/status/events/cancel/list) and `rg -i` for the external-runtime name over `apps/dag-runtime-server` → 0 (no external-runtime API surface).
- [ ] TC-02: a `HttpDagRuntimeProvider` implements `IDagRuntimeProvider` + `IDetachableRunProvider`; `pnpm typecheck` exit 0.
- [ ] TC-03: client↔server contract tests pass — `dag-orchestration-client` (or the new provider) round-trips submit→watch(SSE)→status→cancel against the server.
- [ ] TC-04: `dag-cli --provider <native-http>` and `dag-mcp-server --server-url` resolve against the server (no "unknown provider" error for the native HTTP provider).
- [ ] TC-05: `pnpm harness:scan` + `pnpm --filter "@robota-sdk/dag-*" test` exit 0.

## Test Plan

Strategy (API + typescript/rest): contract + behavior tests over the native route surface; `rg`
external-runtime-name absence; typecheck/harness gates. No manual rows.

| TC-ID | Test Type | Tool / Approach                                        | Notes                                  |
| ----- | --------- | ------------------------------------------------------ | -------------------------------------- |
| TC-01 | API       | route presence + `rg -i` external-runtime-name absence | native R1 surface, no external runtime |
| TC-02 | DATA      | `tsc` implements the provider interfaces               | contract conformance                   |
| TC-03 | BEHAVIOR  | client↔server round-trip (submit/watch/status/cancel)  | detachable-run contract                |
| TC-04 | BEHAVIOR  | provider resolution against the server                 | remote path restored                   |
| TC-05 | INFRA     | `harness:scan` + dag tests exit 0                      | repo green                             |

## Tasks

- [x] `.agents/tasks/WORKFLOW-002.md` — 작성 완료.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-30

draft → review-ready. Frontmatter present; Problem with symptom + reproduction; Architecture Review (Affected Scope, 3 Alternatives Pro/Con, Decision, 4/4 checklist); 5 TC = 5 Test Plan rows; Tasks placeholder; empty Evidence Log; no forbidden sections. Mechanical: rg confirmed 8/8 headings, 4/4 checklist, 3 alternatives, TC 5=5. Decision held at review-ready for product-direction GATE-APPROVAL (native R1 runtime-server + provider; reuses dag-core/orchestration-client/runtime; external-runtime compatibility out of scope).
