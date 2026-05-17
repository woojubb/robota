# ARCH-002 — Slim agent-cli: Proper Layer Separation and TUI as Self-Contained Plugin

## Status

`done`

## Problem

`agent-cli` is supposed to be a thin composition root — it selects providers, picks transports, and wires them together. Instead it carries three categories of misplaced code:

1. **TUI behavior knowledge** — which command shows a picker, which shows a confirm dialog. This is TUI transport internals leaking into the CLI.
2. **Application infrastructure** — settings I/O, git utilities, provider factory, update check logic. These are general capabilities that any Robota application (web server, headless runner, etc.) should be able to use without a terminal.
3. **Terminal interaction code** — raw stdin provider setup wizard, CLI argument parsing. These require a terminal but are not part of the binary entry point.

**Core principle violated**: A capability should be placed at the lowest layer that makes it reusable, not at the layer that first happened to need it. Reading a git branch is not "something the status bar does" — it is a general framework utility that the status bar happens to consume.

## Separation Criteria

| Category                                       | Destination                           | Reason                                                     |
| ---------------------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| Works without any UI                           | `agent-framework` or `agent-executor` | Any app (web, headless, CLI) should be able to import this |
| Requires terminal interaction (raw stdin, PTY) | `agent-terminal`                      | Terminal-only, no Ink/React                                |
| Ink/React rendering                            | `agent-transport/tui`                 | TUI rendering concern                                      |
| Pure type contracts for TUI extension          | `agent-interface-tui`                 | Zero-dep contract package                                  |
| Binary entry point + composition only          | `agent-cli`                           | Selects providers, modules, transport                      |

## Current Misplacements in agent-cli

| File                                        | Lines | Destination           | Reason                                                     |
| ------------------------------------------- | ----- | --------------------- | ---------------------------------------------------------- |
| `src/tui-interactions/registry.ts`          | 97    | `agent-transport/tui` | TUI behavior — maps command name to picker/confirm/text    |
| `src/utils/settings-io.ts`                  | 70    | `agent-framework`     | General config I/O; web apps need this too                 |
| `src/utils/git-branch.ts`                   | 52    | `agent-framework`     | General git utility; status bar is one consumer            |
| `src/utils/provider-settings.ts`            | 17    | `agent-framework`     | General provider settings reader                           |
| `src/utils/provider-factory.ts`             | 88    | `agent-framework`     | General provider instance creation                         |
| `src/utils/statusline-settings.ts`          | 48    | `agent-framework`     | General statusline config; TUI reads it, framework owns it |
| `src/utils/update-check.ts` (logic)         | ~200  | `agent-framework`     | Version comparison logic is framework-level                |
| `src/utils/update-check.ts` (display)       | ~80   | `agent-transport/tui` | Update notice rendering is TUI concern                     |
| `src/subagents/child-process-*`             | —     | `agent-executor`      | General subagent execution; any Node.js app may need this  |
| `src/utils/provider-setup.ts`               | 186   | `agent-terminal`      | Requires raw stdin / PTY — terminal-only                   |
| `src/utils/cli-args.ts`                     | 197   | `agent-terminal`      | Binary argument parsing — terminal-only                    |
| `src/plugins/plugin-command-adapter.ts`     | —     | `agent-terminal`      | Terminal plugin loading                                    |
| `src/utils/provider-default-definitions.ts` | 16    | `agent-cli`           | Product-level provider selection — stays                   |

## Target Package Structure

### `agent-framework` (expanded)

Receives all application infrastructure that works without a terminal:

- `gitBranch(cwd)` — reads current git branch from process
- `readSettings(path)` / `writeSettings(path, data)` — config file I/O
- `readProviderSettings(cwd)` / `readMergedProviderSettings(cwd)` — provider config
- `createProviderFromSettings(settings, definitions)` — provider factory
- `readStatusLineSettings()` / `applyStatusLineSettings()` — statusline config
- `checkForUpdate(currentVersion)` — version check against npm registry

### `agent-executor` (expanded)

Receives concrete subagent execution adapters:

- `ChildProcessSubagentRunner` — spawns subagents as Node.js child processes
- `ChildProcessSubagentWorker` — worker side of the IPC channel
- IPC protocol types

### `agent-interface-tui` (new — zero deps, pure types)

Contract package for TUI feature extension:

```typescript
export interface IPickerItem {
  label: string;
  value: string;
  description?: string;
}

export interface ICommandInteractionProvider {
  readonly commandName: string;
  readonly interaction: IPickerInteraction | IConfirmInteraction | ITextInteraction;
}

export type IPickerInteraction = { onMissingArgs: 'picker'; getItems(): IPickerItem[] };
export type IConfirmInteraction = { onMissingArgs: 'confirm'; message: string };
export type ITextInteraction = { onMissingArgs: 'text' };
export type TAnyTuiInteraction = IPickerInteraction | IConfirmInteraction | ITextInteraction;
```

### `agent-transport/tui` (enhanced)

Becomes a self-contained TUI plugin:

- Imports `agent-interface-tui` for type contracts
- Owns built-in command interaction registry (moved from `agent-cli/tui-interactions/registry.ts`)
- `TuiTransport` no longer accepts `resolveInteraction` from CLI — resolved internally
- Renders update notice (moved from `agent-cli`)
- Accepts optional `ICommandInteractionProvider[]` for third-party command extensions

### `agent-terminal` (new)

Strictly terminal-interactive code — things that require a terminal session:

- `runInteractiveProviderSetup(cwd)` — raw stdin provider wizard
- `parseCliArgs(argv)` — binary argument parsing
- `loadPluginCommandSource(cwd)` — terminal plugin loader

### `agent-cli` (extremely thin — composition root only)

After extraction, agent-cli contains:

- `bin.ts` — OS binary entry point
- `cli.ts` (~100 lines) — selects providers from `DEFAULT_PROVIDER_DEFINITIONS`, selects transport (TUI or headless), wires together
- `DEFAULT_PROVIDER_DEFINITIONS` — product-level choice of which providers to ship

## Dependency Graph After Refactor

```
agent-core (0-dep foundation)
    ↑
agent-framework (expanded — app infrastructure, no UI)
    ↑
agent-executor (subagent execution, no UI)
    ↑
agent-interface-tui (pure types, no UI)
    ↑
agent-transport/tui (Ink/React rendering, imports agent-interface-tui)
    ↑
agent-terminal (raw terminal, no Ink)
    ↑
agent-cli (composition root — selects and wires)
```

## What agent-cli Will NOT Know After Refactor

- Which commands use a picker vs confirm vs free text (→ agent-transport/tui)
- How settings files are read or written (→ agent-framework)
- How git branch is resolved (→ agent-framework)
- How child processes are spawned for subagents (→ agent-executor)
- How update checks work (→ agent-framework)

## Invariants After Refactor

1. `agent-framework` must have zero Ink/React dependencies
2. `agent-interface-tui` must have zero runtime dependencies (pure types only)
3. `agent-transport/tui` is the only package that owns TUI command interaction behavior
4. `agent-cli` has no opinion on which commands show pickers — it is determined by the TUI transport
5. Any Robota-based app (web server, headless CLI, test harness) can import `agent-framework` to get git utilities, settings I/O, and provider factory without any TUI or terminal dependency

## Phased Execution

### Phase 1 — Move TUI interaction registry (smallest blast radius)

- Move `agent-cli/tui-interactions/registry.ts` → `agent-transport/src/tui/command-interaction-registry.ts`
- Remove `resolveInteraction` from `IRenderOptions` / `TuiTransport` constructor
- Remove `agent-cli/tui-interactions/` directory
- Verify: agent-cli no longer imports anything from tui-interactions

### Phase 2 — Move application infrastructure to agent-framework

- Move settings I/O, git utilities, provider settings, provider factory, statusline settings, update check logic
- Update all consumers (agent-cli imports from agent-framework instead)
- Verify: agent-cli no longer implements any of these

### Phase 3 — Move subagent execution to agent-executor

- Move `agent-cli/src/subagents/child-process-*` → `agent-executor`
- Update imports in agent-cli
- Verify: no child process logic remains in agent-cli

### Phase 4 — Create agent-interface-tui

- Define pure type contracts for command interaction extension
- Update `agent-transport/tui` to import from `agent-interface-tui`
- (Optional) Update `agent-command-*` packages to optionally export `ICommandInteractionProvider`

### Phase 5 — Create agent-terminal

- Extract provider setup wizard, CLI arg parser, plugin loader
- agent-cli imports from agent-terminal for these concerns

## Test Plan

- [ ] `pnpm typecheck` passes for all affected packages
- [ ] `pnpm test` passes for agent-framework, agent-executor, agent-transport, agent-cli
- [ ] `grep -r "tui-interactions" packages/agent-cli/` returns zero results
- [ ] `grep -r "settings-io\|git-branch\|provider-factory" packages/agent-cli/src/` returns zero results
- [ ] `grep -r "child-process" packages/agent-cli/src/` returns zero results
- [ ] `agent-framework` has zero Ink/React imports (`grep -r "ink\|react" packages/agent-framework/src/`)

## User Execution Test Scenarios

1. Run `robota` → TUI starts, `/mode` shows picker, `/exit` shows confirm — without any interaction config in agent-cli
2. Run `robota -p "hello"` → headless mode works (no TUI)
3. A test importing only `agent-framework` can call `gitBranch(cwd)`, `readSettings(path)`, `createProviderFromSettings()` without any TUI or terminal imports
4. A test importing only `agent-executor` can run a child process subagent without agent-cli
