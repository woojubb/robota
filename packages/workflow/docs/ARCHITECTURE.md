# Workflow Architecture

## Scope
- Event-driven workflow graph construction from runtime events.
- Deterministic node/edge creation with explicit linkage data only.

## Core Components
- `workflow-event-subscriber`: event routing and orchestration.
- `node-edge-manager`: node/edge creation and integrity control.
- domain handlers for `agent.*`, `execution.*`, `tool.*`, and `user.*` events.

## Architectural Constraints
- No fallback linkage behavior.
- No relationship inference from ID parsing or naming conventions.
- Event constants must be imported from owning modules.
