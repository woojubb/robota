---
'@robota-sdk/agent-framework': patch
---

A served runtime's "New session" no longer lands a client on an empty saved session whose writer claim another process, another store instance or a child it is lent to holds, so it starts a fresh session instead of refusing with `has_writer`.
