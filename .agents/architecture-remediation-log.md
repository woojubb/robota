# Architecture Remediation Log

Living list of **code-side** architecture findings surfaced by the `architecture-refresh` loop
(the `architecture-auditor` / `architecture-conformance-auditor` agents) that require a **gated code
change** and cannot be resolved by a documentation fix. Doc-side drift is fixed in-loop by
`architecture-fixer` and does not appear here; this log tracks the code changes that keep the
implementation in sync with the intended architecture.

Each item is a candidate backlog entry: verify it still holds, then route it through the repo's
spec/gate process (or assign it to `architecture-implementer` under that process). Mark items resolved
(and delete) once landed.

## Open — from pass 1 (agent-\* product layers, 2026-07-07)

| ID     | Severity | Area                 | Finding                                                                                                                                                                                              | Proposed remediation                                                                                                                                                                                                                                                                             |
| ------ | -------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ARL-01 | medium   | foundation           | `ToolRegistry` and `FunctionTool` are **duplicated** across `agent-core/src/tool-registry/` and `agent-tools/src/`, and already drifting (the `FunctionTool` validation paths diverge). SSOT breach. | Make `agent-core` the single owner (it already implements + uses them and owns `zodToJsonSchema`); delete the `agent-tools` copies; consumers import from core; keep only the `createFunctionTool`/`createZodFunctionTool` factories + built-ins in `agent-tools`. No pass-through re-export.    |
| ARL-02 | medium   | session/execution    | `GitWorktreeIsolationAdapter` (concrete `git` CLI + fs I/O) lives in `agent-executor`, whose SPEC boundary says it creates no worktrees (self-flagged as ARCH-FIX-024).                              | Execute ARCH-FIX-024: move the adapter + `createGitWorktreeIsolationAdapter` to the CLI/composition tier (`agent-cli/src/subagents/`); leave only the `ISubagentWorktreeAdapter` port + the pure `WorktreeSubagentRunner` decorator in `agent-executor`.                                         |
| ARL-03 | medium   | provider/command/CLI | Preset `enabledCommandModules`/`disabledCommandModules` filter on the `agent-command-*` module-name form; a plausible short name (`editor`) is **silently ignored** (no validation, no error).       | Add validation at the CLI composition root (where both `agent-preset` and `agent-command` are visible) that surfaces unknown enabled/disabled module names as a terminal notice, mirroring `loadExternalPresets` per-file error reporting. (Vocabulary now documented in the agent-preset SPEC.) |
| ARL-04 | low      | transport            | HTTP `/submit` completion resolves only inside the `thinking(false)` handler (temporal coupling); works only because the session emits `thinking(false)` in a `finally` after the terminal event.    | Resolve `done` directly from the `complete`/`interrupted`/`error` handlers (as the MCP transport's `waitForCompletion` already does); drop the dependence on a trailing `thinking(false)`.                                                                                                       |
| ARL-05 | low      | foundation           | `agent-tool-mcp` declares an unused `@robota-sdk/agent-tools` devDependency (never imported); false coupling signal.                                                                                 | Remove the unused devDependency, or record the build-ordering reason in the manifest.                                                                                                                                                                                                            |
| ARL-06 | low      | transport            | `agent-web-ui` locally re-exports `TServerMessage`/`TClientMessage` from `agent-transport-ws` (module-local, not a root pass-through — borderline).                                                  | Keep module-local; do not surface from `index.ts`. Watch so it does not become a public pass-through re-export.                                                                                                                                                                                  |
| ARL-07 | low      | transport            | `agent-transport-http` `routes.ts` header comment claims "each endpoint maps 1:1 to an IInteractiveSession API method", but the HTTP surface is a strict subset (no background/job-group/workspace). | Reword the code comment to "exposes the core session methods"; note background/workspace methods are WS-only if intentional.                                                                                                                                                                     |

### Design alternatives (not defects — decision items)

- **agent-interface-transport pure accessors.** The package ships four pure derivation accessors
  (`readAssistantReplies`, `readLastAssistantText`, `readToolCalls`, `readErrors`). The doc side was
  reconciled to allow "contracts + pure accessors". The alternative is to **relocate** them to a runtime
  package (`agent-transport`) to keep the interface package strictly type-only + add a mechanical "no
  runtime code in interface packages" guard. Decide which model the repo wants.

## Resolved

_(none yet)_
