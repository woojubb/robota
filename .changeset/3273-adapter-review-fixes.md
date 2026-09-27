---
'@robota-sdk/agent-tool-defaults': patch
---

`createDefaultTools` returned the same `WebFetch`/`WebSearch` tool instances on every call — the
two module-level singletons `@robota-sdk/agent-tools` exports — unlike every other tool in the set,
which was already built fresh per call. Two sessions built from separate `createDefaultTools({cwd})`
calls that were open at the same time shared those two tools without meaning to, which a resource
guard keyed by object identity (as `@robota-sdk/agent-roundtable-robota`'s does) rejected as reused
even though nothing about either tool needs to be shared across sessions. `WebFetch`/`WebSearch` are
now built per call, the same way `Glob`/`Grep` already were.
