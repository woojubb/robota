# DAG Designer Specification

## Scope
- Composable React DAG designer components and hooks.
- Preview/validation UX for authoring DAG definitions.
- Preview client contract remains `preview(definition,input)` and expects `traces/totalCostUsd`.
- Preview execution is server-authoritative via API; local orchestration is not the source of truth.
- `text-template` node template syntax:
  - `%s`: replace with input text
  - `%%s`: render literal `%s`
  - default template is `%s` (pass-through behavior)

## Boundaries
- Does not own backend storage/execution infrastructure.
