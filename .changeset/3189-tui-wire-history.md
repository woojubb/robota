---
'@robota-sdk/agent-interface-session': major
'@robota-sdk/agent-transport': major
'@robota-sdk/agent-transport-http': major
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-ui-web': patch
---

A wire client can now render the whole session the way the in-process terminal UI does: the full
history, the context window as it changes, when the history changes, and where each turn came from.

- `agent-interface-session` is **`major`**: `ISessionConversationRead` gains a required
  `getFullHistory()`. Any implementation of it, or of `IInteractiveSession`, must add it.
- `agent-transport` is **`major`**:
  - It adds `get-history` → `history`, whose entries are `IWireHistoryEntry`: a history entry with
    an ISO 8601 `timestamp`. An observer may send it.
  - The session's `context_update` is pushed as the `context` frame that `get-context` answers with.
  - `compact`, `skill_activation` and `memory_event` push the new `history_changed`; the client
    re-reads with `get-history`.
  - `turn_source` is pushed as the new `turn_source` frame.
  - An exhaustive map over `TClientMessage` or `TServerMessage` types must add the new variants, and
    `IProtocolSession` now requires `getFullHistory()`.
- `agent-transport-http` is **`major`** only because `IHttpTransportSession` includes the conversation
  read role, so a session handed to it must now provide `getFullHistory()`.
- `agent-framework`: `SessionSlot` forwards `getFullHistory()` to the current session.
- `agent-ui-web` receives the new frames and does not render them.
