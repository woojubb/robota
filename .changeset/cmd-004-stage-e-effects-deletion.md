---
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-transport-protocol': minor
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-transport-gui': minor
'@robota-sdk/agent-transport-tui': minor
'@robota-sdk/agent-cli': minor
---

CMD-004 Phase 2 Stage E (breaking, beta line): the legacy `TCommandEffect` union and
`ICommandResult.effects` are DELETED. Commands emit the split contract directly —
`hostActions` (session-executed via `ICommandHostAdapters`; works headless and remote) and
`uiIntents` (requester-routed `ui_intent` session events with UI-neutral `show-*` names).
Final carriers for the former notification effects: `session_renamed` and the new
`history_cleared` are BROADCAST session events (forwarded to every WS surface, folded by the
TUI transcript/title and the GUI reducer's new `sessionName`/transcript-reset state);
`session-execution-started` rides `result.data.sessionExecution`; the plugin-registry refresh
rides `result.data.pluginRegistryReloaded`. A mechanical grep floor
(`command-effect-grep-floor.test.ts`) keeps `tui-requested`/`TCommandEffect`/`effects:` out of
every `packages/*/src` production tree.
