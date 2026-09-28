---
'@robota-sdk/agent-framework': minor
---

`createQuery()` takes `model`, `allowedTools` and `deniedTools`, and the query function has `shutdown()`.

- `model` picks the model, so a query works with any provider without a settings file; before, it always asked for Anthropic's default model.
- `allowedTools` lets named tools (your own `additionalTools`, say) run in the `default` mode without a `permissionHandler`; `deniedTools` are never offered to the model.
- Calls on one query function run one at a time and each resolves with its own reply. Before, concurrent calls all resolved with the first turn's reply.
- `await query.shutdown()` ends the query's session; a call still running or waiting rejects, and so does every later one.
