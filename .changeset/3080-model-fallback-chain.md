---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-remote-client': minor
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-interface-analytics': minor
'@robota-sdk/agent-session-analytics': minor
---

Model fallback chain. `--fallback-model a,b` (or the `fallbackModel` settings array; the flag wins) names up to three models a turn moves to when its model is overloaded, unavailable or failing on the server. An entry is a provider profile, `profile:model`, a bare model on the primary's provider, or `default`. The move happens only before any output has streamed, lasts for the current turn, and is shown as a system note; entries that cannot be built are passed over and entries outside the organization's `allowedProviders` are dropped with a notice. `FallbackProvider` in agent-framework implements it over the session's provider; `IChatOptions` gains `executionId`, `onModelFallback` and `preserveContextWindow`, `IAIProvider` gains optional `resolveModelRoute`, and the execution loop emits a `provider_fallback` event and attributes requests, call observations, committed replies, the response cache and usage to the model that answered. A turn that ran on more than one model records per-model `modelShares` on its usage observation, which personal usage reports split by model and provider. A `/provider` switch keeps the chain, read again for the new primary.
