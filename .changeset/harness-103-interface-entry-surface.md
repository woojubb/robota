---
'@robota-sdk/agent-interface-transport': patch
---

Remove `createSessionCapabilityHost` and `readSessionCapability` from the package entry
(HARNESS-103). They are the runtime mechanism `.agents/project-structure.md` forbids an
`agent-interface-*` package from containing, and they have no production consumer — the only callers
were this package's own unit test and its `testing` subpath. They now live under `testing/`, per the
repository's placement rule (`contracts→agent-interface-*, doubles→owner /testing`), and are still
reachable as `createTestSessionCapabilityHost` from `@robota-sdk/agent-interface-transport/testing`.

The contracts they satisfy — `ISessionCapabilityHost`, `TSessionCapabilityHost`,
`TSessionCapabilityReadResult` — remain on the entry unchanged.
