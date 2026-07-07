# Agent Command

Consolidated command module for the Robota CLI. Provides all slash-command (`/cmd`) implementations as a single importable package.

## Installation

```bash
npm install @robota-sdk/agent-command
```

## Quick Start

```typescript
import {
  createAgentCommandModule,
  createModeCommandModule,
  createProviderCommandModule,
} from '@robota-sdk/agent-command';
import type { IProviderCommandModuleOptions } from '@robota-sdk/agent-command';

declare const providerOptions: IProviderCommandModuleOptions;

// Register commands with a CommandRegistry (owned by agent-framework)
const modules = [
  createAgentCommandModule(),
  createModeCommandModule(),
  createProviderCommandModule(providerOptions),
];
```

## Available Commands

| Command        | Description                                    |
| -------------- | ---------------------------------------------- |
| `/agent`       | Agent creation and management                  |
| `/background`  | Background task execution                      |
| `/compact`     | Conversation compaction                        |
| `/context`     | Context window management                      |
| `/editor`      | Compose a message in `$EDITOR`, then return it |
| `/exit`        | Session exit / quit                            |
| `/goal`        | Assign an autonomous goal pursued across turns |
| `/help`        | Help display                                   |
| `/language`    | Language switching                             |
| `/memory`      | Memory read/write                              |
| `/mode`        | Interaction mode switching                     |
| `/permissions` | Permission management                          |
| `/plugin`      | Plugin enable/disable                          |
| `/preset`      | Agent preset selection / switching             |
| `/provider`    | AI provider configuration                      |
| `/reset`       | Session reset                                  |
| `/rewind`      | Conversation history rewind                    |
| `/schedule`    | Scheduled / deferred task management           |
| `/session`     | Session lifecycle (rename, resume, fork, list) |
| `/settings`    | Settings management                            |
| `/shell`       | Drop to an interactive shell, then return      |
| `/skills`      | Skills management                              |
| `/statusline`  | Status bar configuration                       |
| `/user-local`  | User-local command storage                     |

## API

Each command is exposed via a factory function that returns an `ICommandModule`:

```typescript
import { createExitCommandModule, createHelpCommandModule } from '@robota-sdk/agent-command';

const exitCmd = createExitCommandModule();
const helpCmd = createHelpCommandModule();
```

All command factory functions are re-exported from the root entry point. `createDefaultCommandModules`
registers 24 default command modules.

## Dependencies

- `@robota-sdk/agent-core` — core types and interfaces
- `@robota-sdk/agent-framework` — `ICommandHostContext`, command registration

## Links

- [npm](https://www.npmjs.com/package/@robota-sdk/agent-command)
- [GitHub](https://github.com/woojubb/robota)
