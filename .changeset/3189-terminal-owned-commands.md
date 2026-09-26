---
'@robota-sdk/agent-interface-command': major
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-ui-web': minor
---

The command catalog says who runs a command, and which surfaces can run it.

- **`agent-interface-command` (major).**
  - Adds `TCommandRunner` (`'runtime' | 'client'`) and `TCommandSurface` (`'terminal' | 'gui'`).
  - `ICommand` gains optional `runner` and `surfaces`.
  - `ICommandListEntry` gains optional `surfaces` and a **required** `runner`. An implementation of `listCommands()`, or any code that constructs an `ICommandListEntry`, must now emit `runner`; a command that declares none gets `'runtime'`.
- **`agent-framework` (minor).**
  - `ISystemCommand` gains optional `runner` and `surfaces`, and the command listing carries both.
  - An undeclared runner resolves to `'runtime'`.
  - `SessionTerminalHandoffGate` is exported for a terminal client that hands its own terminal to a command.
- **`agent-command` (minor).**
  - `/shell`, `/editor`, `/theme` and `/keybindings` declare `runner: 'client'` and `surfaces: ['terminal']`.
  - `createTerminalClientCommands()` builds the same four commands, from the same execute functions, for a terminal client to run itself. The set follows the preset's module selection.
- **`agent-ui-web` (minor).** The `/` menu marks a command that runs in the terminal with a "terminal" badge.
