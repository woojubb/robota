---
'@robota-sdk/agent-product': patch
---

A connector declares how its service signs in: `auth` is `oauth` (the default), `token` or `none`, with an optional `tokenHeader` for a token that is not the standard `Authorization` bearer. `ISignInContext` carries the typed `token` (and its `origin` is needed only by an OAuth sign-in); the registry refuses a token for an OAuth connector, an origin-less OAuth sign-in, a client secret for a token connector, and any sign-in for a service that needs none.
