---
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/dag-node-skill': minor
'@robota-sdk/dag-nodes-default': patch
---

Provider DIP Stage D (ARCH-PROVIDER-005): invert the skill node's dependency on the
agent-framework assembly. New `ISkillExecutionPort` contract in
`@robota-sdk/agent-interface-transport`; `@robota-sdk/agent-framework` exports
`createSkillExecutionPort()`; `@robota-sdk/dag-node-skill` now requires an injected
`skillPort` (via `ISkillNodeDefinitionOptions.skillPort`) and no longer depends on
`agent-framework`. The concrete port is injected at the `dag-nodes-default` composition
root. Closes ARL-11 (skill-half).

BREAKING (@robota-sdk/dag-node-skill): `SkillNodeDefinition`/`SkillResolverRuntime` now
require an injected `skillPort`; the no-arg `createSkillNodeDefinition()` factory is removed.
