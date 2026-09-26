---
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-cli': patch
---

A revoked or closed external-event grant checks the token before it answers, so only a caller holding a valid
token for that grant learns it was revoked; anyone else gets exactly the refusal a live grant gives. The TUI keeps
revoked grants open-and-revoked on each session it binds so their tokens are still checked. The per-grant counters
now also count the refusals the HTTP endpoint decides itself (a missing token, an oversize body).
