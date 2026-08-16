---
'@robota-sdk/agent-framework': major
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-command-workflows': patch
'@robota-sdk/agent-transport-tui': patch
---

ARCH-029: decompose the command host into role ports

`ICommandHostContext`, `ICommandSessionRuntime` and `IAgentJobHostContext` are now empty `extends`
aggregates over 26 named role ports, so a command declares only the capability it uses. A role port
is a supertype of the aggregate, so narrowing a declared parameter still satisfies
`ISystemCommand.execute` by contravariance.

All 79 members are preserved (46 + 18 + 15) with the declaration kind unchanged, so implementors and
callers stay source-compatible.

**Breaking:** every role-port member is now required except the adapter bag, whose contents are
genuinely variational. 38 members went from optional to required. A host that previously omitted a
member must now provide one — including `validateCurrentSessionReplayLog`, which was an override
with a framework-computed default and no implementor. `createTestCommandHost`,
`createTestAgentJobHost` and `createTestSessionRuntime` are published from
`@robota-sdk/agent-framework/testing` as conformant, cast-free doubles for exactly this.

Also removed: the `clearConversationHistory` fallback that reached past the host into
`getSession().clearHistory()`. Those were never the same operation — the host path also broadcasts
`history_cleared` to every attached surface, so a fallback clear left other surfaces still showing
the transcript.
