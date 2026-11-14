---
'@robota-sdk/agent-local-host': minor
---

`startLoopbackGuiServer` accepts an optional `api` handler. A product composition root uses it to serve its own JSON API under the session path's `api/`. The handler is reached only by the browser holding the access cookie, and a request that changes something must also carry the `x-robota-api` header, which a cross-site form cannot set.
