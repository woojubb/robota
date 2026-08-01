# ComfyUI Docker Integration Verification

- **Status**: completed
- **Created**: 2026-03-15
- **Branch**: test/comfyui-docker-integration
- **Scope**: apps/dag-orchestrator-server, docker, package scripts, architecture docs

## Objective

Add a reproducible local verification path for replacing `dag-runtime-server` with a real
ComfyUI backend. The workflow must prove orchestrator-to-ComfyUI object catalog, proxy, WebSocket
capability, and asset upload boundaries without making CI depend on GPU hardware or downloaded
models.

## Plan

- [x] Review current orchestrator/runtime route contracts and existing tests.
- [x] Research current ComfyUI API and Docker support from official sources.
- [x] Add a local Docker Compose path that builds ComfyUI from official source rather than pinning an unofficial image as SSOT.
- [x] Add an opt-in integration test for a running ComfyUI endpoint plus a running orchestrator.
- [x] Document the local verification workflow in existing app docs and the central architecture map.
- [x] Run targeted verification and archive this task.
- [x] Prepare the change for commit, PR, and merge back to `develop`.

## Progress

### 2026-05-05

- Confirmed ComfyUI official docs define `/object_info`, `/prompt`, `/queue`, `/ws`, and `/upload/image` routes.
- Confirmed the official ComfyUI project does not provide one canonical Docker image suitable as this repository's SSOT.
- Confirmed `dag-orchestrator-server` already proxies `/object_info`, `/queue`, `/upload/image`, and exposes `/v1/dag/nodes` plus `/v1/dag/assets`.
- Added `docker-compose.dag-comfyui.yml`, a source-built ComfyUI Dockerfile, and an opt-in Vitest integration suite.
- Added root scripts for `dag:comfyui:up`, `dag:comfyui:down`, and `dag:comfyui:verify`.
- Documented the local verification workflow in `dag-orchestrator-server` docs and the central architecture map.
- Verification passed: default skipped integration test, package test/typecheck/lint/build, Docker Compose config validation, docs build, docs structure validation, harness specs/deps/test-plan scans, and `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`.
- `pnpm harness:scan:file-size` reports existing repository-wide file-size violations unrelated to this change; the new test and Docker files are below the 300-line production file limit.

## Decisions

- Build the local Docker image from the official ComfyUI Git repository in this repo's compose template, instead of depending on an unofficial prebuilt image by default.
- Keep the external ComfyUI test opt-in with `COMFYUI_INTEGRATION=1`; default CI must not pull models or require GPU access.
- Validate deterministic boundaries by default: runtime route availability, orchestrator proxying, node catalog envelope, WebSocket upgrade capability, and asset upload forwarding. Full prompt execution remains optional because it depends on model files and workflow-specific nodes.

## Test Plan

Verification must include the new skipped-by-default integration test in normal package tests,
the opt-in test command behavior when no endpoint is available, package typecheck/lint/build,
harness scans, docs build, and diff whitespace checks. A real Docker run can be executed locally
when Docker and model/runtime resources are available.

## Blockers

- None.

## Result

The repository now has an opt-in local ComfyUI replacement verification path. Developers can run
`pnpm dag:comfyui:up`, start `dag-orchestrator-server` with `BACKEND_URL=http://127.0.0.1:8188`,
and then run `pnpm dag:comfyui:verify` to check runtime route availability, orchestrator proxying,
WebSocket upgrade capability, node catalog envelope behavior, and asset upload forwarding.
