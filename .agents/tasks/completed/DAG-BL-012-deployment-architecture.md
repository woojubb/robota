# DAG Service Deployment Architecture

- **Status**: completed
- **Created**: 2026-03-15
- **Branch**: docs/dag-deployment-architecture
- **Scope**: .agents/specs/ARCHITECTURE-MAP.md, apps/dag-studio, apps/dag-orchestrator-server, apps/dag-runtime-server

## Objective

Document the deployment architecture for the DAG service stack without adding another architecture
document. The central architecture map owns the cross-app deployment topology, while each app SPEC
or deployment guide records only the contract it owns.

## Plan

- [x] Verify the current local development topology and app configuration.
- [x] Check current platform constraints from official deployment documentation.
- [x] Update the central architecture map with the DAG deployment topology and ownership rules.
- [x] Update existing app docs so deployment variables and hosting boundaries match source.
- [x] Run documentation and spec verification.
- [x] Prepare the change for commit, PR, and merge back to `develop`.

## Progress

### 2026-05-05

- Confirmed local topology: `dag-studio` on port `3002`, `dag-orchestrator-server` on port `3012`, and `dag-runtime-server`/ComfyUI-compatible runtime on port `8188`.
- Confirmed `dag-studio` currently uses `NEXT_PUBLIC_DAG_API_BASE_URL` for DAG Designer calls, while the older deployment guide listed unrelated environment variables.
- Confirmed the orchestrator app is an Express HTTP server with a WebSocket bridge and filesystem-backed storage adapters.
- Confirmed current platform constraints from official Vercel, Cloudflare, Railway, Fly.io, and Runpod docs.
- Updated the central architecture map and existing app docs without adding another architecture document.
- Verification passed: `pnpm harness:scan:specs`, `pnpm harness:scan:test-plans`, `git diff --check`, `pnpm docs:build`, and `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`.

## Decisions

- Keep deployment architecture centralized in `.agents/specs/ARCHITECTURE-MAP.md`; do not add a new DAG deployment architecture document.
- Keep `dag-orchestrator-server` as a long-running process/container deployment unit. Do not recommend rewriting it into Next.js API routes because the current server owns WebSocket upgrade handling, ComfyUI proxying, and persistent storage adapter wiring.
- Treat runtime execution as a separate backend deployment unit. `dag-runtime-server` can serve the local/dev ComfyUI-compatible runtime, while production image/video workloads can point `BACKEND_URL` at a managed or self-hosted GPU ComfyUI-compatible backend.
- Use official platform docs only for deployment constraints: Vercel WebSocket/function limits, Cloudflare Next.js/Worker WebSocket docs, Railway/Fly Node hosting docs, and Runpod ComfyUI/serverless docs.

## Test Plan

This is a documentation and environment-example update. Verification must cover spec coverage,
task test-plan scanning, whitespace checks, docs site build, and harness verification against
`origin/develop`; no package runtime tests are required unless source code changes are added.

## Blockers

- None.

## Result

The DAG deployment topology is now documented as three deploy units: `dag-studio` frontend,
long-running `dag-orchestrator-server`, and a separate ComfyUI-compatible runtime. Existing app
docs now match the source-owned environment variables and runtime responsibilities, and the stale
runtime/orchestrator default port examples were corrected.
