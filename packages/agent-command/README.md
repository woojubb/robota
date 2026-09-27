# @robota-sdk/agent-command

The slash-command (`/cmd`) implementations for Robota agents, as command modules you register with an
`agent-framework` runtime. The `robota` CLI builds its command set from this package; your own agent can
take the whole default set, a filtered subset, or individual modules.

## Installation

```bash
npm install @robota-sdk/agent-command
```

## Quick start

`createDefaultCommandModules` builds the default command set. It returns the selected `modules` and any
`enabledCommandModules`/`disabledCommandModules` names that matched no module, so a host can report a
typo instead of silently ignoring it.

```typescript
import { createDefaultCommandModules } from '@robota-sdk/agent-command';
import type { IProviderCommandSettingsAdapter } from '@robota-sdk/agent-command';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';
import { createAgentRuntime } from '@robota-sdk/agent-framework';

declare const provider: IAIProvider;
declare const providerDefinitions: readonly IProviderDefinition[]; // e.g. agent-builtin-providers
declare const providerSettingsAdapter: IProviderCommandSettingsAdapter; // reads/writes provider profiles
declare const userLocalStorageRoot: string; // host-chosen directory for user-local state

const cwd = process.cwd();
const { modules, unknownModuleNames } = createDefaultCommandModules({
  cwd,
  userLocalStorageRoot,
  providerDefinitions,
  providerSettingsAdapter,
  disabledCommandModules: ['agent-command-remote-control'],
});
void unknownModuleNames;

const runtime = createAgentRuntime({ cwd, provider, commandModules: modules });
```

Each module also has its own factory, so you can compose a smaller set by hand:

```typescript
import {
  createExitCommandModule,
  createHelpCommandModule,
  createModeCommandModule,
} from '@robota-sdk/agent-command';

const modules = [createHelpCommandModule(), createModeCommandModule(), createExitCommandModule()];
```

## Commands

The default set covers these commands. Modules, which `enabledCommandModules` and
`disabledCommandModules` select by name, are named `agent-command-<area>`: for example,
`agent-command-session` provides `/clear` through `/validate-session`, and `agent-command-schedule`
provides `/schedule`, `/monitor`, and `/loop`.

| Area               | Commands                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Help and exit      | `/help`, `/exit`                                                                                                 |
| Session            | `/clear`, `/rename`, `/cd`, `/resume`, `/cost`, `/validate-session`, `/fork`, `/rewind`, `/compact`, `/context`  |
| Model and behavior | `/provider`, `/effort`, `/advisor`, `/preset`, `/output-style`, `/language`, `/mode`, `/permissions`, `/sandbox` |
| Agents and work    | `/agent`, `/background`, `/goal`, `/plan`, `/schedule`, `/monitor`, `/loop`                                      |
| Terminal           | `/shell`, `/editor`, `/keybindings`, `/theme`, `/statusline`                                                     |
| Project and tools  | `/git`, `/memory`, `/skills`, `/mcp`, `/plugin`, `/reload-plugins`                                               |
| Settings and state | `/settings`, `/reset`, `/user-local`, `/doctor`                                                                  |
| Other sessions     | `/peers`, `/handoff`, `/events`, `/remote-control`, `/devices`                                                   |

`/doctor` and `/devices` are registered only when the host supplies their inputs (`doctorInputs`,
`devicesPort`). `/shell`, `/editor`, `/keybindings` and `/theme` belong to the terminal the user sits at:
a terminal attached to a workspace daemon runs them itself (see `createTerminalClientCommands`).

For what each command does and its arguments, see the [CLI guide](../../content/guide/cli.md#slash-commands).

## Project access

Project-aware commands are capability-based. Skills come only from the contribution sources and skill
roots the host passes in, and provider setup writes through the injected settings adapter. The package
never turns `cwd` into permission to read or write the project; a project-local write without an
authority-backed store is refused explicitly.

## Dependencies

- `@robota-sdk/agent-core` — provider and tool types
- `@robota-sdk/agent-framework` — `ICommandModule`, command host contracts, and the shared command APIs
- `@robota-sdk/agent-interface-command`, `@robota-sdk/agent-interface-execution`,
  `@robota-sdk/agent-interface-session` — command, execution, and session contracts
- `@robota-sdk/agent-preset` — presets listed and switched by `/preset`

## Documentation

- [docs/SPEC.md](./docs/SPEC.md) — package contract and per-command guarantees
- [CLI guide](../../content/guide/cli.md) — using the commands in the `robota` CLI
