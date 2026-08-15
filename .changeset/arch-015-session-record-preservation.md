---
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-session': minor
---

Preserve complete resumable session records when the raw Session writer re-saves them.

`IInteractiveSessionStore` is now the canonical persistence port, including its optional file-backed
record-path capability. `agent-session` consumes the canonical record and store contracts directly and
keeps its former type names only as compatibility re-exports.
