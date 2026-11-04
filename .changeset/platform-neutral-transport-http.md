---
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-transport-http': minor
'@robota-sdk/agent-transport-mcp': minor
'@robota-sdk/agent-transport-webrtc': minor
'@robota-sdk/agent-transport-ws': minor
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-cli': minor
---

Make the HTTP transport platform-neutral.

- `@robota-sdk/agent-transport`: `resolveAdmission`, `bearerCredential`, `credentialMatches` and `mintTransportToken` moved from `@robota-sdk/agent-transport/node` to the main entry, and `./node` no longer exports them. Minting uses `randomHex` and comparing uses `constantTimeEqual` from `@robota-sdk/agent-core` instead of `node:crypto`, so every refusal and the idempotence of `resolveAdmission` are unchanged; a credential is now compared as the string it is, where it used to be compared as UTF-8 bytes (a lone surrogate no longer matches another).
- `@robota-sdk/agent-transport-http`: the main entry reaches no Node built-in or Node global, so its `exports` no longer map `"browser": null`.
- `@robota-sdk/agent-transport-mcp`, `@robota-sdk/agent-transport-webrtc`, `@robota-sdk/agent-transport-ws`, `@robota-sdk/agent-cli` import the four admission helpers from `@robota-sdk/agent-transport`. `@robota-sdk/agent-interface-transport` only corrects where its comments and README say the admission machinery lives.
