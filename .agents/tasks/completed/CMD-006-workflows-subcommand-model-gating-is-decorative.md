---
title: 'CMD-006: /workflows per-subcommand modelInvocable:false is decorative — a model can auto-run an arbitrary on-disk workflow (LLM/http/file nodes) with no permission gate'
status: done
created: 2026-08-13
completed: 2026-08-19
priority: critical
urgency: now
area: packages/agent-command-workflows, packages/agent-framework
depends_on: []
---

# CMD-006: model can execute arbitrary workflows ungated

## Problem

`agent-command-workflows` declares `run`/`validate`/`list`/`catalog` as `modelInvocable: false`, but
nothing enforces it: the dispatcher checks neither the invocation source nor the per-subcommand flag,
the top-level command is `modelInvocable: true` + `requiresPermission: false`, and the framework
gates model invocation only per top-level command name. A model-issued `workflows run <file>` is
auto-approved and executes an arbitrary on-disk DAG.

## Evidence (adversarially verified 2026-08-13, CONFIRMED)

- `packages/agent-command-workflows/src/subcommands.ts:42,47,53,59` — `list/catalog/validate/run` set
  `modelInvocable: false`; `create/build` true.
- `packages/agent-command-workflows/src/workflows-command-module.ts:46-72` — `executeWorkflowsCommand`
  dispatches on the parsed subcommand via a plain switch with NO check of
  `context.getCommandInvocationSource()` (never called in the package), no per-subcommand
  `modelInvocable` check, and no permission gate; `:97` `requiresPermission: false`, `:99`
  `modelInvocable: true` on the top-level `ISystemCommand`.
- `packages/agent-framework/src/commands/system-command-executor.ts:77-88` — model gating reads the
  commands Map keyed by TOP-LEVEL name only; the model path projects one tool per top-level
  model-invocable command taking a free-form `args` string, and inherits the top-level
  `requiresPermission: false`, so `create-session.ts` adds `robota_command_workflows` to
  `commandAutoAllow` (auto-approved, no prompt).
- Result: `robota_command_workflows{args:'run <file>'}` is auto-approved and reaches
  `executeWorkflowsRun` → `run-command.ts`, which resolves the path against cwd and executes the DAG
  (LLM/http/file/in-process-tool nodes) with no gate. The only permission seam is an opt-in
  `remoteCommandPolicy` that applies to `source === 'remote'`, not the model path.

## Resolution

Fixed in [#1877](https://github.com/woojubb/robota/pull/1877), filed as
[issue #1872](https://github.com/woojubb/robota/issues/1872).

The gate lives in `executeWorkflowsCommand` and reads `WORKFLOWS_SUBCOMMANDS` — the same registry
that declares the flag. That is the part worth keeping: a subcommand added as
`modelInvocable: false` is gated BY EXISTING TO BE FOUND, not by someone remembering to add a case
to a second list. A gate with its own copy of the list would have been the same defect one layer up.

`create` stays open (it is what the model is meant to use), a user-typed `run` is untouched (the
gate is about who asked), and an unknown subcommand still gets the dispatcher's own answer.

Two harness ratchets caught the test fixture and both were right — a hand-rolled partial cast to the
host contract (contract-cast), and naming the aggregate in a return type (aggregate-naming). Both
replaced with the published conformant double and an inferred type.

## Direction

In `executeWorkflowsCommand`, reject (or permission-gate) any subcommand whose registry entry is
`modelInvocable: false` when `context.getCommandInvocationSource?.() === 'model'`; alternatively set
`requiresPermission`/a `safety` flag so non-authoring execution prompts. The authoring path
(`create`, which the model is meant to use) stays open. Add an anti-drift test asserting the declared
per-subcommand gate is actually enforced on the model path.

## Test Plan

- Red-first: a scripted-session harness test where the model emits `robota_command_workflows` with
  `run <file>` — assert it is refused/gated (not executed) while a user-typed `/workflows run` still
  runs. Fails today.
- Red-first: `create` remains model-invocable.
- `pnpm harness:verify -- --scope packages/agent-command-workflows` green.

## User Execution Test Scenarios

**Applies** (model-invoked command execution is user-observable behavior).

- Prerequisites: built CLI + provider key; a `.dag.json` on disk with an observable side effect (a
  file-write node) — authored by this work; a prompt that induces the model to call the workflows
  tool with `run`.
- Steps: in the TUI, ask the model to "run the workflow at <path>"; observe whether the side effect
  fires without any permission prompt.
- Expected (after fix): the model's `run` attempt is refused or prompts for permission; typing
  `/workflows run <path>` yourself still executes it.
- Expected (before fix, contrast): the model's `run` executes the DAG silently (the file is written)
  with no prompt.
- Cleanup: delete the dag file and its output.
- Evidence (fill in after implementation): the TUI transcript + presence/absence of the side-effect
  file.
