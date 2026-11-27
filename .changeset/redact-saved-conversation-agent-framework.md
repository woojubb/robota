---
'@robota-sdk/agent-framework': minor
---

A saved or live conversation can have matched text replaced while keeping every message, id and tool-call pairing: `redactSessionRecord` and `persistSessionRedaction` redact a stored record (refusing one another writer holds, one with a pending execution, or one that cannot be read), and an idle `InteractiveSession` redacts itself in memory and on disk and emits `history_rewritten`.
