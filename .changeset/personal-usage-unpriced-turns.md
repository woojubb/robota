---
'@robota-sdk/agent-interface-analytics': patch
'@robota-sdk/agent-session-analytics': patch
---

A personal usage aggregate's `costStatus` no longer reads as `'unknown'` just because one observation
in it couldn't be priced (a legacy row, an unknown model, an unpriced advisor call) — it now falls back
to `'unknown'` only when nothing in the aggregate could be priced at all, so `costUsd` and `costStatus`
agree with each other. The new `unpricedTurns` field counts the turns excluded from `costUsd` for this
reason, present only when that count is above zero.

The personal usage report also gained `sessionFirstSeen`, an ISO timestamp per session id of its
earliest observation or activity in the report — content-free, like the rest of the report — so a GUI
can label a session outside its own local listing by date instead of a raw id.
