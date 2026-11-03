---
'@robota-sdk/agent-mcp': patch
'@robota-sdk/agent-tools': patch
'@robota-sdk/agent-roundtable-robota': patch
---

The peer dependencies on `@robota-sdk/agent-core` and `@robota-sdk/agent-session` accept the release line (`^`) instead of one exact version, so a minor release of the SDK stays a minor instead of becoming a major.
