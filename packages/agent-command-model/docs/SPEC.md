# SPEC.md - @robota-sdk/agent-command-model

## Purpose

`@robota-sdk/agent-command-model` owns the composable `/model` command module.

The package provides command metadata, model subcommands, and execution for requesting a model change. It does not mutate provider settings directly and does not restart processes directly.

## Public API

```ts
import {
  ModelCommandSource,
  createModelCommandEntry,
  createModelCommandModule,
  executeModelCommand,
} from '@robota-sdk/agent-command-model';
```

## Ownership

- Owns `/model` command metadata and execution.
- Consumes `@robota-sdk/agent-sdk` command contracts and model command common APIs.
- Emits typed `model-change-requested` effects.
- Leaves host-specific settings persistence and restart/exit behavior to the host.

## Non-Goals

- Does not validate provider-specific model IDs.
- Does not update CLI settings files directly.
- Does not import `agent-cli` or TUI code.
- Does not own provider construction.

## Command Contract

`createModelCommandModule()` returns one `ICommandModule` with:

- a command source containing `/model` and model subcommands;
- one executable `ISystemCommand`;
- inline lifecycle behavior;
- typed effect output for successful model-change requests.

## Verification

```bash
pnpm --filter @robota-sdk/agent-command-model test
pnpm --filter @robota-sdk/agent-command-model typecheck
pnpm --filter @robota-sdk/agent-command-model build
```
