# DAG JSON Spec Design — ComfyUI API Format Adoption

Date: 2026-03-13
Status: Confirmed

## Direction

Adopt ComfyUI API prompt format as the DAG JSON schema. The API endpoints also match ComfyUI exactly. Extensions (cost, retry, auth) live in a separate orchestration layer above.

## Architecture

```
[Orchestration Layer] — budget, auth, billing, retry, timeout, extended features
    ↓ queries /object_info, computes cost, enforces policies
    ↓ calls /prompt when approved
[ComfyUI-compatible API] — /prompt, /queue, /history, /object_info
    ↓
[Backend: ComfyUI OR Robota DAG runtime] — interchangeable
```

Key constraint: ComfyUI may be used as the actual backend, OR Robota DAG may replace it. Both must be interchangeable behind the same API contract.

## DAG JSON Format (API Prompt Format)

Identical to ComfyUI API prompt format:

```json
{
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "seed": 8566257,
      "steps": 20,
      "cfg": 8.0,
      "sampler_name": "euler",
      "scheduler": "normal",
      "denoise": 1.0,
      "model": ["4", 0],
      "positive": ["6", 0],
      "negative": ["7", 0],
      "latent_image": ["5", 0]
    },
    "_meta": {
      "title": "KSampler"
    }
  },
  "4": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": {
      "ckpt_name": "v1-5-pruned-emaonly.safetensors"
    }
  }
}
```

### Conventions

- **Node ID**: object key (string)
- **Node type**: `class_type` field
- **Inputs**: config values and link references mixed in single `inputs` object
- **Link reference**: `["sourceNodeId", outputSlotIndex]` — distinguished by `Array.isArray(value)`
- **Config value**: direct scalar (string, number, boolean)
- **Dependencies**: inferred from input link references (no explicit `dependsOn`)
- **Metadata**: optional `_meta` object (e.g., `title`)
- **Output indexing**: index-based, not name-based. Server provides name mapping via `/object_info`

## API Endpoints (ComfyUI-compatible)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/prompt` | POST | Submit DAG JSON for execution, returns `prompt_id` |
| `/queue` | GET | Current queue status (running + pending) |
| `/queue` | POST | Queue management (clear, delete) |
| `/history` | GET | Execution history |
| `/history/{prompt_id}` | GET | Specific execution result |
| `/object_info` | GET | All registered node types with input/output definitions |
| `/object_info/{node_type}` | GET | Specific node type info |
| `/system_stats` | GET | System information |

### POST /prompt Request

```json
{
  "prompt": { /* DAG JSON */ },
  "client_id": "uuid-string",
  "extra_data": {
    "extra_pnginfo": {
      "workflow": { /* Workflow JSON with positions/sizes for UI */ }
    }
  }
}
```

### POST /prompt Response

```json
{
  "prompt_id": "uuid-string",
  "number": 1,
  "node_errors": {}
}
```

## What Is NOT in DAG JSON

These items were explicitly excluded from the DAG JSON and assigned to other layers:

| Item | Owner | Rationale |
|------|-------|-----------|
| Port definitions (input/output schemas) | Server node type registry (`/object_info`) | Node type knows its own ports |
| Node lifecycle (initialize, validate, execute, dispose) | Server runtime | Implementation concern |
| State machines (DagRun, TaskRun) | Server runtime | Execution state tracking |
| Error model (TResult, IDagError) | Server runtime | Error handling strategy |
| Execution history | Server storage (`/history` API) | Queried, not embedded |
| `dagId`, `version`, `status` | Removed — server assigns `prompt_id` on submit | No persistent definition lifecycle |
| `costPolicy` | Orchestration layer | Queries `/object_info`, computes cost before `/prompt` |
| `retryPolicy`, `triggerPolicy`, `timeoutMs` | Orchestration layer | Retry on failure, timeout monitoring |
| `position` (canvas coordinates) | Separate Workflow JSON | Attached via `extra_data.extra_pnginfo.workflow` |
| `inputSchema` / `outputSchema` | Server node definitions | Validation at server level |

## Workflow JSON (UI Format)

Separate from DAG JSON. Used by dag-designer for canvas layout. Attached to `/prompt` via `extra_data` for workflow embedding in outputs.

dag-designer needs a converter: **ComfyUI API format ↔ React Flow nodes/edges data structure**.

## Confirmed Decisions Log

| # | Item | Decision |
|---|------|----------|
| 1 | Node ID | Object key (ComfyUI) |
| 2 | Node type field | `class_type` (ComfyUI) |
| 3 | Config values | Mixed in `inputs` (ComfyUI) |
| 4 | Edge connections | Inline `["nodeId", slot]` in `inputs` (ComfyUI) |
| 5 | Dependency graph | Inferred from links (ComfyUI) |
| 6 | Server-side concerns | Not in JSON — server owns port defs, lifecycle, state, errors, history |
| 7 | dagId/version/status | Removed — prompt_id returned on submit (ComfyUI) |
| 8 | costPolicy | Orchestration layer |
| 9 | Architecture | ComfyUI or Robota DAG interchangeable behind same API |
| 10 | retry/trigger/timeout | Orchestration layer |
| 11 | position | Separate Workflow JSON (ComfyUI) |
| 12 | inputSchema/outputSchema | Server node definitions |
| 13 | Output slot indexing | Index-based `["nodeId", 0]` (ComfyUI) |

## Next Steps

1. Define OpenAPI spec for ComfyUI-compatible endpoints
2. Implement API layer
