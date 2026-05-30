---
'@robota-sdk/agent-framework': patch
---

Fix /context list showing empty despite non-zero context percentage. System context files (AGENTS.md, CLAUDE.md) loaded at session startup now appear in the list with [system, active] label. Prompt execution no longer re-adds them as manual duplicates.
