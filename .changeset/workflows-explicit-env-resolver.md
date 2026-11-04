---
'@robota-sdk/agent-cli': patch
---

The CLI bundles `@robota-sdk/workflows` 0.0.3, which no longer relies on `agent-core`'s process-environment default for `$ENV:` credentials: every provider-backed node passes an explicit resolver. The CLI's behaviour is unchanged: saved and authored instant nodes keep using the CLI's environment snapshot, and `/workflows` does not load the other provider-backed catalog nodes.
