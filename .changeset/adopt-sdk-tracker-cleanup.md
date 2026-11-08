---
"@robota-sdk/agent-cli": patch
"@robota-sdk/agent-app": patch
---

Use the SDK patch release whose shipped types and messages no longer point at internal tracker IDs, so an agent reading the installed types or an error message is not sent looking for tickets it cannot open.
