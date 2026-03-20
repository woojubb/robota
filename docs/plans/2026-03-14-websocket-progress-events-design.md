# WebSocket Progress Events Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable real-time node-level execution status updates in dag-designer by implementing WebSocket-based progress event relay through the orchestrator.

**Architecture:** Orchestrator connects to ComfyUI backend via WebSocket (`/ws`), receives node-level execution events, translates them to Robota `TRunProgressEvent` format, and relays to the designer via a WS-to-WS proxy. Runtime-server implements ComfyUI-compatible `/ws` as a separate effort to eventually replace a real ComfyUI instance.

**Key Principle:** `dag-orchestrator-server` is developed assuming it connects to a **ComfyUI server**. `dag-runtime-server` is a ComfyUI-compatible replacement developed separately.

---

## Connection Flow

```
designer                    orchestrator                   ComfyUI
   |                            |                            |
   |--- WS connect ----------->|                            |
   |    /v1/dag/runs/:id/ws    |                            |
   |                            |--- WS connect ----------->|
   |                            |    /ws?clientId=orch-{id}  |
   |                            |                            |
   |--- POST /start ---------->|                            |
   |                            |--- POST /prompt --------->|
   |                            |                            |
   |                            |<-- executing {node} ------|
   |<-- task.started {nodeId} --|                            |
   |                            |                            |
   |                            |<-- executed {node,output} -|
   |<-- task.completed {nodeId}-|                            |
   |                            |                            |
   |                            |<-- execution_success ------|
   |<-- execution.completed ----|                            |
   |                            |                            |
   |--- WS close -------------->|--- WS close -------------->|
```

## Event Mapping (ComfyUI -> Robota)

| ComfyUI Event | Robota Event |
|---|---|
| `{type:"execution_start", data:{prompt_id}}` | `{event:{dagRunId, eventType:"execution.started", occurredAt}}` |
| `{type:"executing", data:{node:"id", prompt_id}}` | `{event:{dagRunId, eventType:"task.started", nodeId, taskRunId, occurredAt}}` |
| `{type:"executed", data:{node:"id", output, prompt_id}}` | `{event:{dagRunId, eventType:"task.completed", nodeId, taskRunId, output, occurredAt}}` |
| `{type:"execution_success", data:{prompt_id}}` | `{event:{dagRunId, eventType:"execution.completed", occurredAt}}` |
| `{type:"execution_error", data:{prompt_id, node_id, exception_message}}` | `task.failed` + `execution.failed` |
| `{type:"executing", data:{node:null}}` | Ignored (handled by `execution_success`) |
| `{type:"progress", ...}` | Ignored (future extension) |
| `{type:"status", ...}`, `{type:"execution_cached", ...}` | Ignored |

## Connection Lifecycle

1. Designer connects WS to orchestrator (`/v1/dag/runs/:dagRunId/ws`)
2. Orchestrator connects WS to ComfyUI (`/ws?clientId=orch-{dagRunId}`)
3. Designer calls `POST /v1/dag/runs/:dagRunId/start`
4. Orchestrator calls `POST /prompt` on ComfyUI (acquires `prompt_id`)
5. ComfyUI events received via WS -> orchestrator filters by `prompt_id`, translates, forwards to designer WS
6. On terminal event (`execution_success`/`execution_error`) -> orchestrator closes both WS connections

## Implementation Scope

### 1. orchestrator-server: WS server + ComfyUI WS client (core)

- Add `ws` library to orchestrator-server
- New WS endpoint: `/v1/dag/runs/:dagRunId/ws`
- ComfyUI WS client: connects to backend `/ws?clientId=orch-{dagRunId}`
- Event translator: ComfyUI format -> Robota `TRunProgressEvent` format
- `prompt_id` filtering: only forward events matching the run's prompt_id
- Remove existing SSE `/v1/dag/runs/:dagRunId/events` route

### 2. dag-designer: EventSource -> WebSocket (core)

- Replace `EventSource` with native `WebSocket` in `subscribeRunProgress`
- URL: `ws://host/v1/dag/runs/:dagRunId/ws`
- Message format unchanged: `{event: TRunProgressEvent}`
- Reconnection: reuse existing `maxReconnectAttempts` + exponential backoff logic
- `TRunProgressEvent` type unchanged

### 3. runtime-server: ComfyUI-compatible `/ws` (local testing, lower priority)

- `ws://localhost:3011/ws?clientId={sid}`
- Subscribe to internal event bus, broadcast as ComfyUI JSON format
- Can be deferred — orchestrator works against a real ComfyUI instance

### 4. Cleanup

- Remove SSE route (`/v1/dag/runs/:dagRunId/events`)
- Remove SSE-related code from orchestrator-server

## Test Strategy

### Unit Tests

**Orchestrator WS event translator:**
- ComfyUI `executing` -> Robota `task.started` conversion accuracy
- ComfyUI `executed` -> Robota `task.completed` + output pass-through
- ComfyUI `execution_error` -> `task.failed` + `execution.failed` dual emit
- `executing {node: null}` ignored
- `progress`, `status`, `execution_cached` ignored
- prompt_id filtering — other prompt events not forwarded

**Designer WS client (`subscribeRunProgress`):**
- Connection success triggers `onEvent` callback
- Disconnect triggers exponential backoff reconnection
- `maxReconnectAttempts` exceeded triggers `onError`
- Terminal event triggers `close()`
- Unsubscribe triggers immediate close

### Integration Tests

**Orchestrator WS proxy E2E:**
- Mock ComfyUI WS server -> orchestrator -> mock designer WS client
- Full flow: WS connect -> `POST /start` -> mock ComfyUI emits `executing` -> `executed` -> `execution_success` -> designer receives `task.started` -> `task.completed` -> `execution.completed`
- prompt_id filtering: mixed prompt events, only matching dagRunId forwarded
- Connection cleanup: both WS closed after terminal event

**Connection order enforcement:**
- `POST /start` before WS connect returns error
- WS connect -> ComfyUI WS ready -> then start allowed

**Error scenarios:**
- ComfyUI WS connection failure -> designer receives error
- ComfyUI WS mid-stream disconnect -> designer receives `execution.failed`
- Designer WS disconnect -> ComfyUI WS cleaned up

### Verification Commands

```bash
pnpm --filter @robota-sdk/dag-orchestrator test
pnpm --filter @robota-sdk/dag-orchestrator-server test
pnpm --filter @robota-sdk/dag-designer test
pnpm --filter @robota-sdk/dag-runtime-server test
pnpm test
```
