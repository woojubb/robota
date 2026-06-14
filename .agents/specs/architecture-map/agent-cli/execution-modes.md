# Agent CLI Execution Modes

Source-verified against `develop` on 2026-06-14.

Interactive TUI and non-interactive print-mode execution paths.

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

## WebSocket Sidecar Mode

> **[Planned — not yet implemented]** The `--web` / `--web-port` flags and `startWebSidecarServer()` described below do not exist in the codebase. This section documents the planned design intent referenced in `agent-web-ui/docs/SPEC.md`. Do not rely on it as a current implementation reference.

```mermaid
sequenceDiagram
  participant User as robota --web [--web-port N]
  participant TUI as agent-cli React/Ink TUI
  participant Sidecar as startWebSidecarServer
  participant WsTransport as agent-transport/ws createWsHandler
  participant Browser as agent-web (browser)

  User->>TUI: launch with --web flag
  TUI->>Sidecar: startWebSidecarServer(interactiveSession, port)
  Sidecar->>Sidecar: bind HTTP+WebSocket server on 127.0.0.1:PORT
  Sidecar-->>TUI: IWebSidecarServer { port, stop }
  TUI->>Browser: open ROBOTA_MONITOR_URL

  Browser->>Sidecar: WebSocket connect
  Sidecar->>WsTransport: createWsHandler({ session, send })
  Sidecar-->>Browser: send { type: "messages", messages } (full history replay)

  loop session events
    TUI->>TUI: normal interactive TUI operation
    WsTransport-->>Browser: real-time session events
  end
```

Sidecar bind failure is intended to be non-fatal. Planned source path:
`agent-cli/src/web-sidecar/web-sidecar-server.ts` — this file does not exist in the codebase yet
(verified 2026-06-14; `src/web-sidecar/` is absent). Treat this section as design intent only.
See [packages/agent-cli/docs/SPEC.md](../../../../packages/agent-cli/docs/SPEC.md) for supported flags.
