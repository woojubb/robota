# Agent CLI Execution Modes

Part of the [agent-cli composition map](../agent-cli-composition.md).

Source-verified against `develop` on 2026-07-12.

Interactive TUI, non-interactive print-mode, and headless runtime-host (`--serve`) execution paths.

## Interactive TUI

```mermaid
sequenceDiagram
  participant User
  participant TUI as agent-cli React/Ink
  participant Bridge as useTuiChannel / TuiInteractionChannel
  participant SDK as InteractiveSession
  participant Session as agent-session Session
  participant Provider as IAIProvider

  User->>TUI: type prompt or slash command
  TUI->>Bridge: handleSubmit(input)
  alt slash command
    Bridge->>SDK: executeCommand(name, args)
    SDK-->>Bridge: ICommandResult
    Bridge-->>TUI: message, interaction, or typed effects
  else model prompt
    Bridge->>SDK: submit(input)
    SDK->>SDK: resolve @file references under cwd
    SDK->>Session: run enriched prompt
    Session->>Provider: chat/stream request
    Provider-->>Session: text, tool calls, usage
    Session-->>SDK: history, context, tool events
    SDK-->>Bridge: events
    Bridge-->>TUI: TuiStateManager render state
  end
```

See [packages/agent-cli/docs/SPEC.md](../../../../packages/agent-cli/docs/SPEC.md) for supported interactive flags.

## Non-Interactive Print Mode

```mermaid
sequenceDiagram
  participant CLI as cli.ts -p path
  participant Preset as agent-preset.resolvePreset
  participant Channel as HeadlessInteractionChannel (agent-transport/headless)
  participant Session as agent-session Session

  CLI->>Preset: resolveCliPreset(args, settings.preset)
  Preset-->>CLI: resolved options (model, persona, agentName, permissionMode, ...)
  CLI->>CLI: collect positional prompt or piped stdin
  CLI->>CLI: build appendSystemPrompt from flags + task-file
  CLI->>Channel: new HeadlessInteractionChannel({ provider, outputFormat, permissionMode, maxTurns, sessionStore, bare, allowedTools, deniedTools, appendSystemPrompt, persona, agentName, activePresetId, commandModules, commandHostAdapters, ... })
  CLI->>Channel: channel.run(prompt)
  Channel->>Session: submit prompt
  Session->>Session: run loop
  Session-->>Channel: text/json/stream-json output events
  CLI->>Channel: process.exit(channel.getExitCode())
```

Flags: `-p`, piped stdin, `--output-format`, `--permission-mode`, `--max-turns`, `--bare`,
`--allowed-tools`, `--denied-tools`, `--no-session-persistence`, `--system-prompt`,
`--append-system-prompt`, `--task-file`, `--model`, `--preset`, `--json-schema`.

Print-mode permission mode resolves as `args.permissionMode ?? presetOptions.permissionMode ??
'bypassPermissions'`; the model resolves as `resolvedPreset.model ?? providerSettings.model`. The
CLI forwards the preset's `persona`, `agentName`, `activePresetId`, `enableParallelSubagents`, and
`selfVerification` into the channel without re-applying any preset logic.

## Runtime Host Mode (`robota --serve`)

> **[Landed — RUNTIME-001 / GUI-005]** `robota --serve` (`packages/agent-cli/src/modes/serve-mode.ts`)
> is a headless runtime host: it builds the session via `startRuntimeHost` (`agent-framework`) — sharing
> the `buildRuntimeSession` construction seam with TUI and print modes — and serves the loopback WS
> sidecar. It renders NO ink; it is the backend the desktop Electron shell `apps/agent-app` spawns, and
> it stays alive until `SIGTERM`/`SIGINT`, then shuts the runtime down cleanly.

```mermaid
sequenceDiagram
  participant App as apps/agent-app (Electron)
  participant CLI as robota --serve (serve-mode.ts)
  participant Host as startRuntimeHost (agent-framework)
  participant WS as agent-transport-ws WsTransport
  participant GUI as agent-transport-gui renderer (useWsSession)

  App->>CLI: spawn `robota --serve`
  CLI->>Host: startRuntimeHost({ session, transportRegistry })
  Host->>Host: buildRuntimeSession(options) — shared construction seam
  Host->>WS: transportRegistry.startAll(session)
  Host-->>CLI: IRuntimeHostHandle { session, shutdown }
  App->>GUI: render SessionMonitor over the loopback WS
  loop session events
    WS-->>GUI: TServerMessage stream
  end
  App->>CLI: SIGTERM on window close
  CLI->>Host: handle.shutdown() (bounded)
```

> **Superseded design.** The earlier `--web` / `--web-port` flags and
> `startWebSidecarServer(interactiveSession, port)` were never built — neither the flags nor that
> function (nor `agent-cli/src/web-sidecar/`) exist in the codebase. The landed path is
> `robota --serve` → `startRuntimeHost`, supervised by the desktop GUI (`apps/agent-app`) rather than a
> browser opened from a TUI session.

See [packages/agent-cli/docs/SPEC.md](../../../../packages/agent-cli/docs/SPEC.md) for supported flags.
