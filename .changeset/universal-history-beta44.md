---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-sessions': patch
'@robota-sdk/agent-sdk': patch
'@robota-sdk/agent-cli': patch
---

feat: IHistoryEntry universal history architecture + test quality cleanup

- IHistoryEntry as universal history type across all 4 packages (core → sessions → sdk → cli)
- Tool summary stored as event entry in history (category: 'event', type: 'tool-summary')
- TuiStateManager pure TypeScript class for CLI rendering state
- MessageList renders IHistoryEntry[] with Tool:/System:/You:/Robota: labels
- Display order fixed: Tool → Robota (both streaming and abort)
- Remove 25 tautological, duplicate, and hardcoded tests
