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

// Register commands with a CommandRegistry (owned by agent-framework)
const modules = [
  createAgentCommandModule(hostAdapters),
  createModeCommandModule(hostAdapters),
  createProviderCommandModule(hostAdapters),
];
```

## Available Commands

| Command        | Description                                    |
| -------------- | ---------------------------------------------- |
| `/agent`       | Agent creation and management                  |
| `/background`  | Background task execution                      |
| `/compact`     | Conversation compaction                        |
| `/context`     | Context window management                      |
| `/exit`        | Session exit / quit                            |
| `/help`        | Help display                                   |
| `/language`    | Language switching                             |
| `/memory`      | Memory read/write                              |
| `/mode`        | Interaction mode switching                     |
| `/permissions` | Permission management                          |
| `/plugin`      | Plugin enable/disable                          |
| `/provider`    | AI provider configuration                      |
| `/reset`       | Session reset                                  |
| `/rewind`      | Conversation history rewind                    |
| `/session`     | Session lifecycle (rename, resume, fork, list) |
| `/settings`    | Settings management                            |
| `/skills`      | Skills management                              |
| `/statusline`  | Status bar configuration                       |
| `/user-local`  | User-local command storage                     |

## API

Each command is exposed via a factory function that returns an `ICommandModule`:

```typescript
import { createExitCommandModule, createHelpCommandModule } from '@robota-sdk/agent-command';

const exitCmd = createExitCommandModule(hostAdapters);
const helpCmd = createHelpCommandModule(hostAdapters);
```

All 20 factory functions are re-exported from the root entry point.

## Dependencies

- `@robota-sdk/agent-core` — core types and interfaces
- `@robota-sdk/agent-framework` — `ICommandHostContext`, command registration

## Links

- [npm](https://www.npmjs.com/package/@robota-sdk/agent-command)
- [GitHub](https://github.com/woojubb/robota)
