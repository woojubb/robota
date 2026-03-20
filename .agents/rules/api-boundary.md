# API Boundary Rules

Mandatory rules for API specifications, runtime/orchestrator boundary, and process lifecycle.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

### API Specification

- Applications with external API endpoints must maintain standardized API specifications (e.g., OpenAPI for HTTP). See `api-spec-management` skill for workflow details.

### Runtime and Orchestrator API Boundary

**This section is the single source of truth (SSOT) for all API boundary rules between runtime and orchestrator. Do not duplicate these rules in skills, specs, or other documents.**

**Architecture:**
- `dag-orchestrator-server` is developed assuming it connects to a **ComfyUI server** as its backend. All orchestrator code must work against a real ComfyUI instance.
- `dag-runtime-server` is a **ComfyUI-compatible replacement** being developed separately to eventually substitute a real ComfyUI server. It is NOT a prerequisite for orchestrator development.
- If the runtime is replaced by a real ComfyUI instance, the orchestrator must continue to function without modification.

**dag-runtime-server API rules:**
- The runtime API must be **identical to ComfyUI** in endpoints, request/response shapes, error formats, field names, and behavior.
- The reference ComfyUI API spec is: `.design/dag-benchmark/03-comfyui.md`.
- The reference ComfyUI API surface is: `POST /prompt`, `GET /prompt`, `GET /queue`, `POST /queue`, `GET /history`, `GET /history/{prompt_id}`, `GET /object_info`, `GET /object_info/{node_class}`, `GET /system_stats`, `GET /view`, `POST /upload/image`, `POST /interrupt`, `POST /free`, `WebSocket /ws`.
- **Allowed changes to runtime API:** implementing a ComfyUI endpoint that is not yet implemented in the runtime. The implementation must follow the ComfyUI spec exactly.
- **Prohibited changes to runtime API:** adding endpoints, fields, response shapes, or behaviors that do not exist in the ComfyUI spec. No custom or proprietary extensions.
- Stub implementations (no-op responses) are acceptable for ComfyUI endpoints that have no Robota equivalent, but the endpoint must still exist and return the correct response shape.

**dag-orchestrator-server API rules:**
- The orchestrator API is **Robota's own specification**. We define and evolve it freely to serve the dag-designer frontend.
- Features that cannot be implemented within the ComfyUI API surface (e.g., richer error details, custom diagnostics) must be implemented at the **orchestrator API level**, not the runtime.
- The orchestrator translates ComfyUI's native responses into Robota-specific formats for the frontend.
- New orchestrator API proposals are allowed and encouraged, as long as the orchestrator continues to work against a real ComfyUI backend.

### Process Lifecycle

- Applications in `apps/` must handle SIGTERM and SIGINT for graceful shutdown.
- In-progress work must complete or be safely cancelled within a configurable timeout.
- All acquired resources (connections, file handles) must be released on shutdown.
