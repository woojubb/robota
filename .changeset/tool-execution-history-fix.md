---
'@robota-sdk/agent-sdk': patch
'@robota-sdk/agent-cli': patch
---

fix: record individual tool-start/tool-end in history + fix streaming tool display

- Individual tool-start/tool-end events recorded as IHistoryEntry for persistence
- TuiStateManager.onToolEnd uses findIndex (first match only, not all with same name)
- MessageList hides tool-start/tool-end entries (not rendered as System:)
