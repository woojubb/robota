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
  - It adds `get-history { fromIndex? }` → `history { startIndex, total, entries }`. The history
    crosses one bounded page at a time (at most 256 KiB of entries; a single larger entry is sent
    alone), from `fromIndex` (default 0), so no reply grows with the session. The client asks for
    the next page after the previous one arrived. Entries are `IWireHistoryEntry`: a history entry
    with an ISO 8601 `timestamp`. An observer may send it.
  - `complete` and `interrupted` carry the turn's result without the session's history
    (`TWireExecutionResult`); a client reads the history with `get-history`.
  - It adds `get-prompts`: the host sends the permission and ask prompts still open as the
    `permission_request` / `ask_request` frames that asked them, for a client that attached later.
    An observer may not send it.
  - `pending` gains a required `pendingCount`, and the host sends `pending` in reply to a `submit`
    once it has taken the prompt, so a prompt queued behind a running turn shows as queued.
  - `command` takes an optional `requestId`, which the host echoes on the command's
    `command_result` or `protocol_error`.
  - The session's `context_update` is pushed as the `context` frame that `get-context` answers with.
  - `compact`, `skill_activation` and `memory_event` push the new `history_changed`; the client
    reads the history again.
  - `turn_source` is pushed as the new `turn_source` frame.
  - An exhaustive map over `TClientMessage` or `TServerMessage` types must add the new variants, a
    `pending` frame built by hand must add `pendingCount`, and `IProtocolSession` now requires
    `getFullHistory()`.
- `agent-transport-http` is **`major`** only because `IHttpTransportSession` includes the conversation
  read role, so a session handed to it must now provide `getFullHistory()`.
- `agent-framework`: `SessionSlot` forwards `getFullHistory()` to the current session.
- `agent-ui-web` receives the new frames and does not render them.
