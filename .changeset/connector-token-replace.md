---
'@robota-sdk/agent-product': minor
---

A connected `token` connector can have its token replaced without disconnecting. `IConnectorProtocol` gains an optional `replaceToken(connector, token, hooks)` returning an `IReplaceTokenOutcome` (`replaced: true`, or `replaced: false` with `rejected` or `unreachable`), and `ConnectorRegistry.replaceToken` is the one door to it: it refuses a connector that does not sign in with a token and a protocol that cannot try a token apart from the one in use. The caller's `beforeSwap` hook runs once the service accepted the new token and before it takes the old one's place.
