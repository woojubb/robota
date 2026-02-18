# DAG Designer Specification

## Scope
- Composable React DAG designer components and hooks.
- Run/validation UX for authoring DAG definitions.
- Run client contract is `createRun -> startRun -> getRunResult` and expects `traces/totalCostUsd`.
- Run execution is server-authoritative via API; local orchestration is not the source of truth.
- `text-template` node template syntax:
  - `%s`: replace with input text
  - `%%s`: render literal `%s`
  - default template is `%s` (pass-through behavior)

## Boundaries
- Does not own backend storage/execution infrastructure.
