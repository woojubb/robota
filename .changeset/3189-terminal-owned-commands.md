---
'@robota-sdk/agent-interface-command': major
'@robota-sdk/agent-framework': minor
---

The command catalog says who runs a command, so a terminal attached to a workspace daemon runs
terminal-owned commands itself instead of sending them.

- `agent-interface-command` (major): adds `TCommandRunner` (`'runtime' | 'client'`) and
  `TCommandSurface` (`'terminal' | 'gui'`). `ICommand` gains optional `runner` and `surfaces`.
  `ICommandListEntry` gains optional `surfaces` and a **required** `runner`, so an implementation
  of `listCommands()`, or any code that constructs an `ICommandListEntry`, must now emit `runner`
  (`'runtime'` for a command that declares none).
- `agent-framework` (minor): `ISystemCommand` gains optional `runner` and `surfaces`; the command
  listing carries both and resolves an undeclared runner to `'runtime'`. `SessionTerminalHandoffGate`
  is exported so an attached terminal can hand its own terminal to client-run commands.
