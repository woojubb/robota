---
'@robota-sdk/agent-roundtable-robota': minor
---

A runtime that reaches a provider outside the turn journal is now refused before its first call with `RuntimeParticipantError('unmetered-caller')`: a `Session` permission classifier, a provider that can move a request to another model, a managed-run provider, and a model-backed hook executor. Previously these made provider calls no admission or limit ever saw.
