# @robota-sdk/agent-product/command

The slash-command (`/cmd`) implementations for agents, as command modules you register with an
`agent-framework` runtime. The configured CLI builds its command set from this subpath; your own agent can
take the whole default set, a filtered subset, or individual modules.

## Installation

```bash
npm install @robota-sdk/agent-product
```

## Quick start

`createDefaultCommandModules` builds the default command set. It returns the selected `modules` and any
`enabledCommandModules`/`disabledCommandModules` names that matched no module, so a host can report a
typo instead of silently ignoring it.

```typescript
import { createDefaultCommandModules } from '@robota-sdk/agent-product/command';
import type { IProviderCommandSettingsAdapter } from '@robota-sdk/agent-product/command';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import type { IFrameworkHost } from '@robota-sdk/agent-framework';

declare const host: IFrameworkHost; // `createNodeFrameworkHost({ createDefaultTools })` on Node
declare const provider: IAIProvider;
declare const providerDefinitions: readonly IProviderDefinition[]; // e.g. agent-provider/builtin
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

const runtime = createAgentRuntime({ host, cwd, provider, commandModules: modules });
```

Each module also has its own factory, so you can compose a smaller set by hand:

```typescript
import {
  createExitCommandModule,
  createHelpCommandModule,
  createModeCommandModule,
} from '@robota-sdk/agent-product/command';

const modules = [createHelpCommandModule(), createModeCommandModule(), createExitCommandModule()];
```

## Commands

The default set covers these commands, except `/shell` and `/editor`, which are on
`@robota-sdk/agent-product/command/node` (see below). Modules, which `enabledCommandModules` and
`disabledCommandModules` select by name, are named `agent-command-<area>`: for example,
`agent-command-session` provides `/clear` through `/validate-session`, and `agent-command-schedule`
provides `/schedule`, `/monitor`, and `/loop`.

| Area               | Commands                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Help and exit      | `/help`, `/exit`                                                                                                           |
| Session            | `/clear`, `/rename`, `/cd`, `/resume`, `/cost`, `/validate-session`, `/fork`, `/rewind`, `/compact`, `/context`            |
| Model and behavior | `/provider`, `/model`, `/effort`, `/advisor`, `/preset`, `/output-style`, `/language`, `/mode`, `/permissions`, `/sandbox` |
| Agents and work    | `/agent`, `/background`, `/goal`, `/plan`, `/schedule`, `/monitor`, `/loop`                                                |
| Terminal           | `/shell`, `/editor`, `/keybindings`, `/theme`, `/statusline`                                                               |
| Project and tools  | `/git`, `/memory`, `/skills`, `/mcp`, `/plugin`, `/reload-plugins`                                                         |
| Settings and state | `/settings`, `/reset`, `/user-local`, `/doctor`                                                                            |
| Other sessions     | `/peers`, `/handoff`, `/events`, `/remote-control`, `/devices`, `/unlock`, `/lock`                                         |

`/memory correct <user|feedback|project|reference> <topic> <text>` replaces **every entry** in that topic. `/memory forget <topic>` removes the source topic file and its active index entries. Both operations are user-only and block subsequent automatic or model additions to that topic; use `correct` to deliberately restore it. Project memory retains only the current replacement or a topic tombstone in `lifecycle.json`, which remains authoritative if source cleanup is interrupted. Historical transcripts and backups remain. A configured semantic backend must support `removeTopic` for these commands; an index cleanup failure is reported, while active recall continues to read current durable source content. The next model turn refreshes its retained startup memory.

`/doctor`, `/devices` and `/unlock` with `/lock` are registered only when the host supplies their inputs
(`doctorInputs`, `devicesPort`, `keyCustodyPort`). `/doctor` also takes the probes and writers it runs through (`doctorDeps`); without
them it is listed and says it is unavailable on that host. `/shell`, `/editor`, `/keybindings` and
`/theme` belong to the terminal the user sits at: a terminal attached to a workspace daemon runs them
itself (see `createTerminalClientCommands`).

## `@robota-sdk/agent-product/command/node`

The main entry is platform-neutral: it runs in a browser, a Web Worker, Node, Deno and Bun and names no
Node module. What starts a process, reads the file system or the network for a command, or runs a
command on the user's terminal is on `/node`, and a Node host passes it in:

| Export                                                                  | What it does                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `createShellCommandModule`, `createEditorCommandModule` and their parts | `/shell` and `/editor`: hand the real terminal to a child process. Add them beside the default set      |
| `createNodeDoctorDeps`, `resolveCommandOnPath`                          | The doctor's TCP probe, file-system facts, `PATH` lookup and repair writers; pass as `doctorDeps`       |
| `openFileInEditor`                                                      | Opens a file in `$VISUAL`, `$EDITOR` or `vi`; pass as `keybindingsEditor` so `/keybindings` can open it |
| `createTerminalClientCommands`                                          | The commands an attached terminal runs in its own process                                               |

`/git` runs through the process a host passes as `gitProcess`, `createGitProcess()` from
`@robota-sdk/agent-framework/node`. `/user-local` and `executeUserLocalDirectCommand` read and write
their storage root through the file system a host passes as `userLocalFileSystem` (`fsAsync` for the
direct command), `new NodeFileSystemAsync()` from the same entry.

What a command does when the host supplies none of it:

| Absent                | Behaviour                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `doctorDeps`          | `/doctor` is listed and answers that it is unavailable on this host; nothing is probed or written   |
| `gitProcess`          | `/git` is listed and answers that it is unavailable on this host; no process starts                 |
| `userLocalFileSystem` | `/user-local` is listed and answers that it is unavailable on this host; nothing is read or written |
| `keybindingsEditor`   | `/keybindings` answers that the editor is unavailable here, and creates no file                     |
| `providerEnvironment` | `/provider` and `/model` read a `$ENV:` credential reference as unset                               |

For what each command does and its arguments, see the [CLI guide](../../../content/guide/cli.md#slash-commands).

## Project access

Project-aware commands are capability-based. Skills come only from the contribution sources and skill
roots the host passes in, and provider setup writes through the injected settings adapter. The package
never turns `cwd` into permission to read or write the project; a project-local write without an
authority-backed store is refused explicitly.

## Dependencies

- `@robota-sdk/agent-core` — provider and tool types
- `@robota-sdk/agent-framework` — `ICommandModule`, command host contracts, and the shared command APIs
- `@robota-sdk/agent-interface/command`, `@robota-sdk/agent-interface/execution`,
  `@robota-sdk/agent-interface/session` — command, execution, and session contracts
- the `preset` subpath of this package — presets listed and switched by `/preset`

## Documentation

- [SPEC.md](./SPEC.md) — package contract and per-command guarantees
- [CLI guide](../../../content/guide/cli.md) — using the commands in the configured CLI
