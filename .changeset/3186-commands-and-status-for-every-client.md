---
'@robota-sdk/agent-interface-session': major
'@robota-sdk/agent-interface-command': minor
'@robota-sdk/agent-transport': major
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-ui-web': major
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

Every client can offer the session's commands and skills and show its status. The GUI uses them as a
desktop-style composer.

- `agent-interface-session` is **`major` because `IInteractiveSession` gains required members**:
  `ISessionCommands.listSkills()` and a `statusRead` capability, `getStatusSnapshot()`. The snapshot
  holds session, model, permission mode, effort, context and goal. An external implementation stops
  compiling until it adds both.
- `agent-transport` is **`major` for the same reason on `IProtocolSession`**. It also gains the wire
  messages `get-commands` → `commands` and `get-status` → `session_status`. Both are reads that the
  observe role may send.
- `agent-interface-command` gains `ICommandSkillListEntry`, moved from `agent-framework`, which
  re-exports it unchanged.
- `agent-ui-web` is **`major` because its state changes shape**:
  - A command's outcome and a finished turn's tool calls are now conversation entries: `messages` is
    `TConversationEntry[]`.
  - The `uiIntentNotices` list, `dismissUiIntentNotice`, `applyUiIntentEvent`,
    `removeUiIntentNotice` and `IUiIntentNotice` are removed. An intent now answers with an info
    line in the conversation.
  - Session notices keep only `session-error` and `protocol-error`.
  - The state gains `commandCatalog` and `sessionStatus`.
- `agent-command` registers `/theme` and `/keybindings` even without a terminal. They then answer
  that they belong to the robota terminal, instead of being unknown.
- `agent-framework`:
  - `InteractiveSession.getStatusSnapshot()`.
  - The main-thread row previews the last chat message instead of the last record's type.
- `agent-cli` serves the full GUI web app, renamed from `agent-cli-web` to `agent-gui-web`, on
  `robota --serve --open`.
