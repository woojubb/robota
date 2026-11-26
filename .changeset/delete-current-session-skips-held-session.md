---
'@robota-sdk/agent-framework': patch
---

Deleting the session a client is on no longer tries to move that client to a saved session whose writer claim another process, another store instance or a child it is lent to holds, so the delete moves to the next free session or starts a fresh one instead of failing with `has_writer`.
