---
'@robota-sdk/agent-product': patch
---

A catalog entry from the owner's file may carry `oauth` (`clientId`, `scopes`, `authorizationParams`): a client the owner registered with the service for this agent, checked by the same rules as a typed connector. A client secret in the file is dropped, and an entry from a registry never carries a client.
