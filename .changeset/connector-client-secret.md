---
'@robota-sdk/agent-product': patch
---

A connector's `oauth` block can carry `authorizationParams` (plain words, validated so they cannot replace a parameter the sign-in sets), and a sign-in takes the client secret of a registered client through `ISignInContext.clientSecret`, which the registry refuses for a connector that has no `clientId`.
