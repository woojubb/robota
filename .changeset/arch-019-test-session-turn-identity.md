---
'@robota-sdk/agent-interface-transport': patch
---

Fix the published test session factory so each default submission receives a deterministic identity
derived from its session id and per-session submission sequence. The testing fixture now models
multiple correlated turns without changing production contracts or public TypeScript signatures.
