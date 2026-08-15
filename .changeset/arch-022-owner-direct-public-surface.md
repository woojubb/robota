---
'@robota-sdk/agent-framework': major
---

Remove pass-through exports for agent-core environment-reference helpers and agent-session session-id
guards. Import `formatEnvReference`, `hasUsableSecretReference`, `isEnvReference`, and
`resolveEnvReference` from `@robota-sdk/agent-core`, and import `assertSafeSessionId` and
`isSafeSessionId` from `@robota-sdk/agent-session`.
