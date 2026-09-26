---
'@robota-sdk/agent-interface-session': major
'@robota-sdk/agent-transport': major
'@robota-sdk/agent-transport-ws': minor
'@robota-sdk/agent-framework': major
'@robota-sdk/agent-ui-web': major
'@robota-sdk/agent-ui-terminal': patch
'@robota-sdk/agent-cli': minor
---

A served runtime can list its workspace's sessions, start a new one and switch to another without the
process or any client connection restarting. The GUI shows them in a sessions sidebar.

- `agent-interface-session` is **`major`** for two reasons:
  - It adds `ISessionListing`, `ISessionDirectory` and `ISessionSwitchedEvent`.
  - `IInteractiveSessionEvents` gains a required `session_switched` event. An exhaustive map over the
    event names stops compiling until it classifies the new event.
- `agent-transport` is **`major`** for the same kind of reason:
  - It adds the wire messages `list-sessions` → `sessions`/`sessions_error`, `new-session`,
    `switch-session`, and the broadcast `session_switched`.
  - It adds a `sessionDirectory` handler option. A refusal to switch comes back as a
    `protocol_error` carrying the reason.
  - An exhaustive map over message types must add the new variants.
- `agent-transport-ws` passes a configured `sessionDirectory` to every connection.
- `agent-framework` is **`major` because `IRuntimeHostHandle.session` is now a `SessionSlot`**, not the
  `InteractiveSession`, and `bindTransports` receives the slot.
  - The slot is an `IInteractiveSession` that forwards to the current session. Members outside that
    interface are read through `host.session.current`, which changes on a switch.
  - Adds `InteractiveSession.whenInitialized()`.
  - Exports `listUnreadableSessions`.
- `agent-ui-web` is **`major`**:
  - `IWsSessionState` gains session listing state and actions.
  - It adds a `SessionSidebar`.
  - `/resume` opens the sidebar.
- `agent-cli`: `robota --serve` provides the session directory, and refuses a switch that would lose
  work in progress. External-event grants belong to the run: a switch reopens them on the new session,
  as the TUI already does.
- External-event grant history (spent tokens, rate windows, revocations) belongs to the run. The new
  option `externalEventGrantHistory` (from `createExternalEventGrantHistory()`) is shared by every
  session that a served runtime or the TUI builds. A session switch therefore replays no spent token
  and resets no rate limit. The TUI previously had this gap when it switched sessions.
