---
'@robota-sdk/agent-product': minor
'@robota-sdk/agent-framework': minor
---

`@robota-sdk/agent-product/personal` (Node-only) adds the personal capability pack's knowledge wiki. It keeps linked pages of claims with their source and trust, retires superseded claims with validity intervals, recalls claims read from elsewhere as data, refuses likely secrets, forgets everywhere, and lints for contradictions, stale claims, orphans and missing links. It comes with file and memory stores behind one store port and the tools an agent uses to maintain it. `agent-framework` exports `containsSensitiveMemoryContent`, the heuristic the wiki shares with project memory.
