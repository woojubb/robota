---
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-mcp': patch
---

Add explicit MCP Skills selection, bounded supervisor access and persistent host content consent.
Users can inspect verified instructions, approve the exact content fingerprint and withdraw consent;
models can discover metadata only. Consent stays separate from server admission and model-turn activation.
