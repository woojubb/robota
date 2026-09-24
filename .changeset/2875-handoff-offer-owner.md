---
'@robota-sdk/agent-transport': major
'@robota-sdk/agent-interface-session-mobility': minor
---

Handoff offer refusal and inventory classification now live in session mobility. The Node transport
entry no longer exports `buildHandoffManifest`, `IBuildManifestInput`, `ISourceRuntimeState`, or
`TManifestResult`. Compose `assessHandoffReadiness` and `prepareHandoffOffer` from
`@robota-sdk/agent-interface-session-mobility` with `sealHandoffRecord` from
`@robota-sdk/agent-transport/node`; check readiness before sealing and send the returned serialized
payload unchanged. The transport README contains the migration example.
