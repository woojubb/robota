---
'@robota-sdk/agent-transport': major
'@robota-sdk/agent-transport-ws': minor
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-ui-web': minor
'@robota-sdk/agent-ui-terminal': minor
---

A daemon keeps several sessions live, and each client is bound to its own: one client's switch moves
only that client.

- `agent-interface-session`: `ISessionBinder`/`ISessionBinding`, the session-change refusal codes with
  `isSessionChangeRefusal`, and listing rows that may say `live` and `clients`.
- `agent-framework`: `SessionPool` and `SessionChangeRefusal`.
- `agent-transport` (**major**): a new server frame, `session_change_failed`, which an exhaustive
  consumer must handle. A refused `new-session` or `switch-session` now answers with it, carrying a
  `code`, instead of `protocol_error`; both requests take an optional `requestId` that it echoes.
- `agent-transport-ws`: the `sessionBinder` option binds each connection to its own session and
  releases the binding when the connection closes.
- `agent-cli`: `robota --serve` and the daemon keep up to four sessions live. Each WebSocket client and
  attached terminal is bound to its own session; leaving a busy session is no longer refused, and only
  the last driver of a session with a pending prompt is kept from leaving it. Grants and the supervised
  name stay on the runtime's first session, and its reported activity covers every live session.
- `agent-ui-web`: a refused new or switch shows the host's reason as a notice (an older host's
  `protocol_error` still does); the session sidebar marks live sessions and counts the other clients
  on each; after a reconnect to a host that keeps sessions live, the GUI returns to the session it was on.
- `agent-ui-terminal`: an attached terminal shows why a switch was refused, and the picker's switch
  stays pending until the host answers; the session picker marks live sessions and their clients.
