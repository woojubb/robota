# Public Surface Ownership

`@robota-sdk/agent-sdk` is the interactive assembly package. Its top-level entrypoint exposes
SDK-owned APIs and explicit SDK facades. It must not hide lower package ownership by passing
general-purpose symbols through `packages/agent-sdk/src/index.ts`.

## Export Classes

| Class                   | Meaning                                                                    | Examples                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK-owned API           | Implemented or semantically owned by `agent-sdk`                           | `InteractiveSession`, `createQuery`, command contracts, skill activation events/tools, model command catalog common APIs, prompt/context file references, project memory, checkpoints |
| SDK facade              | SDK narrows or assembles lower-level behavior behind an SDK contract       | project session store helpers, command host/common APIs, subagent assembly helpers, execution workspace projection                                                                    |
| Explicit runtime facade | Runtime lifecycle contracts intentionally re-exported for SDK hosts        | `BackgroundTaskManager`, `SubagentManager`, log pagination helpers                                                                                                                    |
| Owner-direct API        | General-purpose lower package surface that consumers import from the owner | history helpers from `agent-core`, tool exports from `agent-tools`, generic session APIs from `agent-sessions`                                                                        |

## Allowed SDK Facade Barrels

Runtime re-exports are allowed only in these SDK facade barrels:

- `packages/agent-sdk/src/background-tasks/index.ts`
- `packages/agent-sdk/src/subagents/index.ts`

The top-level SDK entrypoint may re-export from these SDK-local barrels. It must not directly
re-export from `@robota-sdk/agent-core`, `@robota-sdk/agent-sessions`, or
`@robota-sdk/agent-tools`.

## Owner-Direct Imports

Use owner packages for general-purpose APIs:

```typescript
import { getMessagesForAPI, type IHistoryEntry } from '@robota-sdk/agent-core';
import { readTool, webSearchTool } from '@robota-sdk/agent-tools';
import { Session } from '@robota-sdk/agent-sessions';
```

Use `@robota-sdk/agent-sdk` for interactive assembly and SDK-owned facades:

```typescript
import { InteractiveSession, createQuery } from '@robota-sdk/agent-sdk';
import {
  BackgroundTaskManager,
  SubagentManager,
  createExecutionWorkspaceSnapshot,
} from '@robota-sdk/agent-sdk';
```

Command packages may also consume SDK command common APIs from `@robota-sdk/agent-sdk`; those APIs are
owned by `agent-sdk` and do not make the command package depend on CLI internals.

Model command common APIs such as `resolveActiveProviderModelCatalogState()` and
`formatModelCommandUsageMessageAsync()` are SDK-owned facades. They orchestrate provider-owned model
catalog hooks through injected `IProviderDefinition` records; command modules and CLI/TUI code must
not hardcode provider model lists or call provider HTTP APIs directly.

Provider setup common APIs project provider-owned `IProviderDefinition.setupHelpLinks` into generic
prompt descriptions. Command modules and CLI/TUI code must not hardcode provider API key, console, or
official documentation URLs.

## Mechanical Guard

`pnpm harness:scan:sdk-public-surface` enforces the high-signal invariants:

- no `export *` barrels in `packages/agent-sdk/src`
- no top-level pass-through exports from `agent-core`, `agent-sessions`, or `agent-tools`
- `agent-runtime` re-exports stay in the documented SDK runtime facade barrels
