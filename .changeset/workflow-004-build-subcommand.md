---
'@robota-sdk/agent-command-workflows': minor
---

Add the `/workflows build` subcommand (WORKFLOW-004): LLM-assisted authoring WITHOUT execution.
`build "<description>" [--input k=v] [--name <name>]` authors a workflow from natural language via
the active provider (the same FLOW-007 authoring pipeline, deps seam, and arg grammar as `create`),
validates + assembles it, saves the artifact (plus any prompt-backed nodes) — and never runs it. The
explicit next steps are the existing `validate` / `run` subcommands. `build` is model-invocable and
strictly less privileged than `create`.
