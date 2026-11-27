---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
---

A session built on a managed provider isolates the host's helper requests from it. `createSession` accepts a managed execution provider together with an explicit model-step `helperProvider` (a managed one is refused with `ManagedHelperProviderError`; none is ever inferred from environment variables or defaults) and omits the provider timeout the managed run refuses. A managed provider may declare `isolatesHelperRequests`; only then, and only with a classifier built from the helper, does `auto` mode run, and otherwise it is refused with a message naming what to configure. Session naming uses the helper or leaves the session unnamed with one visible notice instead of failing silently. Compaction under a managed provider is refused with a reason and does not end continuation.
