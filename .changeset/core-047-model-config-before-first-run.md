---
'@robota-sdk/agent-core': patch
---

CORE-047: the model-configuration API is reachable before the first turn

`getModel()`, `setModel()` and `swapDefaultProvider()` refused on a freshly constructed agent with
`Agent must be fully initialized before ...`. So you had to ask the model a question before you could
ask which model you were using.

The state they guarded — the provider registry and the current `(provider, model)` pair — turned out
to be synchronous and derived entirely from config the constructor had already validated. It merely
lived inside the async initializer, next to work that genuinely is async (modules, plugins, the
execution service). Both steps now run in the constructor, so an agent knows which model it is
configured for from the moment it exists, and the readiness guard on those three methods protected
nothing and is gone.

A destroyed agent still refuses — and now says so accurately (`AIProviders was disposed`) instead of
misreporting teardown as missing initialization.

`Robota.ensureReady()` is unchanged and remains the way to complete the asynchronous half without
running a turn. It is no longer a precondition for reading or changing the model.
