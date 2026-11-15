---
'@robota-sdk/agent-product': patch
---

A connector's `oauth` block can carry `authorizationParams` (up to four plain words, validated when the connector is created), and a sign-in takes the client secret of a registered client through `ISignInContext.clientSecret`, which the registry refuses for a connector that has no `clientId`.
