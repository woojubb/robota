---
'@robota-sdk/agent-framework': patch
---

Keep a session's record claim through normal underlying session shutdown so another writer cannot take the record while shutdown is still writing the session log.
