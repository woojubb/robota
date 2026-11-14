---
'@robota-sdk/agent-framework': minor
---

`IAgentRuntime.sessionRecipe(options)` returns the recipe `createSession` builds from, and the `SessionRecipe` type is exported. A composition root uses it to give a runtime host or a session pool the same sessions the runtime would create, such as one per chat a client opens.
