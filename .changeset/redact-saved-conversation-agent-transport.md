---
'@robota-sdk/agent-transport': minor
---

A rewritten conversation reaches attached clients as `history_changed` with `rewritten: true`, and the wire decoder accepts the field; ACP clients ignore it.
