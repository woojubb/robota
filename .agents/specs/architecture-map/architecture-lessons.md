# Architecture Lessons and Audit

Resolved architecture audit findings, durable lessons, and the architecture-map update policy.

Back to [System Architecture Map](../ARCHITECTURE-MAP.md).

## Architecture Audit

### SYS-AUDIT-001: No repository-wide architecture router existed

Status: resolved by this document.

Problem:

`packages/agent-cli/docs/ARCHITECTURE-MAP.md` was the only scan-friendly map, but recent work spans
CLI, SDK, DAG operational clients, orchestration HTTP APIs, MCP, and docs deployment. The repository
needed one architecture-map entrypoint and document tree instead of treating the CLI map as the
implicit architecture root.

Resolution:

The repository architecture router and `architecture-map/` subdocuments own repository-wide
architecture. The CLI package map remains a stable entrypoint for terminal product composition.

### SYS-AUDIT-002: `dag-api` owns both server-side composition and operational HTTP client

Status: resolved by `ORCH-BL-006`.

Current source:

- `packages/dag-orchestration-client/src/orchestration-http-client.ts`
- `packages/dag-cli/src/runner.ts`
- `packages/dag-mcp-server/src/runner.ts`

Problem:

`dag-cli` and `dag-mcp-server` need one shared endpoint caller, but must not depend on server-side
controller composition packages for that caller.

Resolution:

`@robota-sdk/dag-orchestration-client` owns `DagOrchestrationHttpClient`, operational payload
types, and the injectable fetch port. `dag-api` owns server-side controller contracts, response
mapping, and controller service ports.

Follow-up:

- `.agents/tasks/ORCH-BL-007-orchestrator-rest-contract-coverage.md` tracks full endpoint contract inventory.

### SYS-AUDIT-008: `dag-api` pulled runtime-level packages into the orchestration split target

Status: resolved by `ORCH-BL-005` boundary refactor.

Current source:

- `packages/dag-api/src/ports/controller-service-ports.ts`
- `packages/dag-api/src/composition/create-dag-controller-composition.ts`
- `apps/dag-runtime-server/src/composition/create-dag-execution-composition.ts`
- `scripts/harness/check-orchestration-split-baseline.mjs`

Problem:

`dag-api` previously instantiated runtime, projection, and worker services directly. That made the
API controller package a production dependency bridge from the orchestration split target back into
runtime-level packages.

Resolution:

`dag-api` now owns narrow controller service ports and composes controllers from injected
implementations. Runtime and worker concrete composition moved to `dag-runtime-server`; projection
services remain in `dag-projection` and are injected structurally where needed. The orchestration
split guard now fails if target packages regain runtime-level production dependencies.

### SYS-AUDIT-003: Orchestrator REST contract coverage is split across owners

Status: resolved by `ORCH-BL-007` inventory, with extraction follow-ups.

Current source:

- `apps/dag-orchestrator-server/src/routes/*`
- `packages/dag-api/src/contracts/*`
- `packages/dag-orchestration-client/src/orchestration-http-client.ts`
- `packages/dag-mcp-server/src/tool-definitions.ts`

Problem:

Definition, node catalog, run lifecycle, run draft, published workflow run, asset metadata, and
cost metadata endpoints are reusable through the shared client. Other server-owned endpoints such
as admin and ComfyUI proxy routes have explicit ownership classifications in the server SPEC.

Resolution:

`apps/dag-orchestrator-server/docs/SPEC.md` is the source-backed endpoint inventory. CLI/MCP
expansion is allowed only for endpoint groups marked package-owned/active. Blocked groups are split
into follow-up extraction tasks.

Resolved extraction guardrail:

- Run progress WebSocket events keep `TRunProgressEvent` ownership in `dag-core`; the
  server-owned route envelope is `{ event: TRunProgressEvent }` and is covered by
  `apps/dag-orchestrator-server/src/__tests__/ws-routes.test.ts`.
- Run draft CLI and MCP operations are exposed through `dag-orchestration-client` only; the product
  shells do not import server route modules or route-local types.
- Published workflow run starts are exposed through `dag-orchestration-client` only; CLI/MCP accept
  optional version and JSON request bodies without duplicating route validation.
- Asset upload and metadata operations are exposed through `dag-orchestration-client`; binary
  content uses `getAssetContentDownloadInfo()` and remains outside the JSON client abstraction.
- Cost metadata CRUD, validation, and preview operations are exposed through
  `dag-orchestration-client` only; CLI/MCP parse product-shell arguments without importing route
  modules or route-local cost metadata types.

### SYS-AUDIT-004: DAG operational tools are not part of `agent-cli`

Status: resolved by documentation boundary.

`dag-cli` and `dag-mcp-server` are separate product shells. They should not be documented as
`agent-cli` sublayers unless the CLI product explicitly composes them. Future agent-driven DAG
control should prefer MCP or SDK command-module integration over direct TUI ownership.

### SYS-AUDIT-005: Docs deploy still referenced GitHub Pages

Status: resolved by `INFRA-BL-006`.

The source tree now points docs production deployment to Cloudflare Pages. `docs:deploy` is a
manual Wrangler direct upload helper, and release workflow docs handling is build verification only.

### SYS-AUDIT-006: DAG deployment topology was not centrally documented

Status: resolved by `DAG-BL-012`.

Problem:

The local DAG stack spans `dag-studio`, `dag-orchestrator-server`, and a ComfyUI-compatible runtime,
but deployment ownership was described only in an active backlog note and stale app-local
deployment notes. That made it unclear whether the orchestrator should be deployed with the
frontend, rewritten as Next.js API routes, or hosted as its own process.

Resolution:

The apps/deployment architecture subdocument now records the three-unit deployment topology and the
app-local docs record only owned environment variables and runtime constraints. `dag-orchestrator-server` remains a
long-running Express/WebSocket service, while `dag-studio` remains a thin frontend host.

### SYS-AUDIT-007: External ComfyUI verification was only a backlog note

Status: resolved by `DAG-BL-004`.

Problem:

The orchestrator is intended to work with native ComfyUI through the Prompt API, but the repository
did not provide a reproducible local verification path for replacing `dag-runtime-server` with a
real ComfyUI process.

Resolution:

The repository now includes a local Docker Compose template that builds ComfyUI from the official
source repository and an opt-in integration test that validates runtime route availability,
orchestrator proxying, WebSocket upgrade capability, node catalog envelope behavior, and asset
upload forwarding.

## Governance and Update Policy

Update this document in the same PR whenever a change affects any of these:

- cross-package dependency direction among agent, DAG, app, or docs packages;
- a new product shell, transport, CLI, MCP server, HTTP client, or deployment boundary;
- movement of an owner contract between packages;
- an architecture decision that cannot be described accurately inside one package `SPEC.md`;
- package-local architecture maps that need a master-map parent pointer.

Before merging a system architecture change:

- Check package manifests for new dependency edges.
- Check source imports with `rg -n "from '@robota-sdk|from \"@robota-sdk" packages apps`.
- Check package `docs/SPEC.md` files for owner drift.
- Run `pnpm harness:scan:deps`, `pnpm harness:scan:specs`, and any affected package checks.
- Add follow-up backlog for any confirmed contradiction that is too large for the current PR.
