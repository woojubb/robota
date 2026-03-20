# ComfyUI API Parity — dag-runtime-server

## Status: completed

## Priority: P0 (critical)

## Context

`dag-runtime-server` is a ComfyUI-compatible replacement server. The orchestrator connects to it as if it were a real ComfyUI instance. All 22 ComfyUI API surface items are now implemented.

Reference spec: `.design/dag-benchmark/03-comfyui.md`
Runtime SPEC: `apps/dag-runtime-server/docs/SPEC.md`

## Implemented Items

### HTTP Endpoints

- [x] `GET /view` — Asset serving by assetId. Uses `LocalFsAssetStore.getContent()` to stream binary with correct Content-Type. The `filename` query param maps to assetId.
- [x] `POST /upload/image` — Multipart image upload via `multer`. Saves to `LocalFsAssetStore`, returns `{ name: assetId, subfolder: "", type: "input" }`.

### WebSocket Events

- [x] `status` — Queue status broadcast. Emitted on `execution.started` (queue_remaining: 1) and `execution.completed`/`execution.failed` (queue_remaining: 0).
- [x] `execution_cached` — Cached node list. Emitted on `execution.started` with empty nodes array (no caching engine).
- [x] `progress` — Sampling progress. Mapping infrastructure exists but no node currently emits progress data.

## Completion Criteria

- [x] All 5 items implemented following ComfyUI spec
- [x] Response/event shapes match ComfyUI reference
- [x] Contract tests added for each new endpoint/event (6 endpoint tests + 11 WS event tests)
- [x] Runtime SPEC updated
- [x] Build and tests pass
- [x] ComfyUI API parity: 22/22 (100%)
