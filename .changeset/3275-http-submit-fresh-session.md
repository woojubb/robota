---
'@robota-sdk/agent-transport-http': patch
---

`POST /submit` on a session that is still starting (a fresh `InteractiveSession`) now waits for it to start and runs the turn. It used to answer 500 ("concurrent-turn tracking is unavailable") until background initialization finished. A session that fails to start is answered 500 without the reason. `IHttpTransportSession` gains an optional `whenInitialized()` for this.
