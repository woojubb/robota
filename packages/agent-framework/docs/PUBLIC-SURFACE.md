# Public Surface Ownership

`@robota-sdk/agent-framework` is the interactive assembly package. Its top-level entrypoint exposes
SDK-owned APIs and explicit SDK facades. It must not hide lower package ownership by passing
general-purpose symbols through any public source root or a local barrel reachable from one. Public
source roots are derived from the package's `exports` map (currently `.` and `./testing`); the policy is
therefore attached to the published graph rather than to one hard-coded entry file.

## Export Classes

| Class                 | Meaning                                                                    | Examples                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK-owned API         | Implemented or semantically owned by `agent-framework`                     | `InteractiveSession`, `createQuery`, command contracts, skill activation events/tools, model command catalog common APIs, prompt/context file references, project memory, checkpoints    |
| SDK facade            | SDK narrows or assembles lower-level behavior behind an SDK contract       | project session store helpers, command host/common APIs, subagent assembly helpers, execution workspace projection                                                                       |
| Unreachable elsewhere | A symbol a permitted consumer has no other legal import path to            | the background-task lifecycle types. ARCH-037 retired the older "runtime facade" wording: whether a re-export is type-only or runtime says nothing about whether a consumer can reach it |
| Owner-direct API      | General-purpose lower package surface that consumers import from the owner | history helpers from `agent-core`, tool exports from `agent-tools`, generic session APIs from `agent-session`                                                                            |

## Files Exempt Because the Symbol Is Unreachable Elsewhere

`agent-executor` re-exports are allowed in exactly one file:

- `packages/agent-framework/src/background-tasks/index.ts`

The criterion is **dependency reach**, not the older "runtime facade" idea: a re-export earns a place
here only when a package permitted to consume the symbol has no other legal import path to it.
`IBackgroundTaskRunner` qualifies — `agent-product`, `agent-transport-tui` and `agent-transport` all
name it and none of them may depend on `agent-executor`. The subagents barrel did NOT qualify and
ARCH-031 removed it; ARCH-037 removed the "two named facade barrels" wording this section still
carried afterwards, which described a set that had had one entry ever since.

A known LIMIT, stated because a reader will otherwise assume more than the check delivers: the
criterion is per-symbol and the exemption is per-file. Measured across the workspace, exactly one of
the block's ten names — `IBackgroundTaskRunner`, imported in 6 files across 4 packages — has an
external importer; the other nine are covered without individually earning it. ARCH-039 owns the
narrowing.

The top-level SDK entrypoint may re-export from this SDK-local barrel. It must not directly
re-export from `@robota-sdk/agent-core`, `@robota-sdk/agent-session`, or `@robota-sdk/agent-tools`;
type-only and runtime re-exports from those owner packages are rejected at every reachable file.

## Owner-Direct Imports

Use owner packages for general-purpose APIs:

```typescript
import { getMessagesForAPI, type IHistoryEntry } from '@robota-sdk/agent-core';
import { createReadTool, webSearchTool } from '@robota-sdk/agent-tools';
import { Session, assertSafeSessionId, isSafeSessionId } from '@robota-sdk/agent-session';
```

Use `@robota-sdk/agent-framework` for interactive assembly and SDK-owned facades:

```typescript
import { InteractiveSession, createQuery } from '@robota-sdk/agent-framework';
import {
  createExecutionWorkspaceSnapshot,
  createInProcessSubagentRunner,
} from '@robota-sdk/agent-framework';
import type { IBackgroundTaskManager } from '@robota-sdk/agent-framework';
// ARCH-031: the subagent SPI is agent-executor's — import it from the owner.
import type { ISubagentManager } from '@robota-sdk/agent-executor';

// Concrete runtime classes remain owner-direct values.
import { BackgroundTaskManager, SubagentManager } from '@robota-sdk/agent-executor';
```

Command packages may also consume framework-owned command common APIs from
`@robota-sdk/agent-framework`; those APIs do not make the command package depend on CLI internals.

Model command common APIs such as `resolveActiveProviderModelCatalogState()` and
`formatModelCommandUsageMessageAsync()` are SDK-owned facades. They orchestrate provider-owned model
catalog hooks through injected `IProviderDefinition` records; command modules and CLI/TUI code must
not hardcode provider model lists or call provider HTTP APIs directly.

Provider setup common APIs project provider-owned `IProviderDefinition.setupHelpLinks` into generic
prompt descriptions. Command modules and CLI/TUI code must not hardcode provider API key, console, or
official documentation URLs.

## Mechanical Guard

`pnpm harness:scan:sdk-public-surface` enforces the high-signal invariants:

- package `exports` source entries are the roots of one recursive, cycle-safe local re-export graph;
  `.js` source specifiers resolve to `.ts`, and extensionless file/directory-index edges are followed
- unresolved local re-export edges fail closed instead of silently shortening the graph
- no `export *` barrels or type/value pass-through exports from `agent-core`, `agent-session`, or
  `agent-tools` occur in any reachable file; unreachable internal files are outside the published graph
- `agent-executor` re-exports stay in the one documented unreachable-elsewhere file
