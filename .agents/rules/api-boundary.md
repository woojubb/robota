# API Boundary Rules

Mandatory rules for API specifications and process lifecycle.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

### API Specification

- Applications with external API endpoints must maintain standardized API specifications (e.g., OpenAPI for HTTP). See `api-spec-management` skill for workflow details.

### Process Lifecycle

- Applications in `apps/` must handle SIGTERM and SIGINT for graceful shutdown.
- In-progress work must complete or be safely cancelled within a configurable timeout.
- All acquired resources (connections, file handles) must be released on shutdown.
