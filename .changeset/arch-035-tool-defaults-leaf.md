---
'@robota-sdk/agent-tool-defaults': minor
'@robota-sdk/agent-framework': major
'@robota-sdk/pack-coding': patch
---

ARCH-035 — the default tool set becomes a composition leaf.

**New package: `@robota-sdk/agent-tool-defaults`.** It owns `createDefaultTools` and
`ICreateDefaultToolsOptions`, including the adapter gating that adds `CodebaseRetrieval` when a
`retrievalAdapter` is supplied and the Computer tools when a `computerDriver` is.

**Breaking for `@robota-sdk/agent-framework`:** `createDefaultTools` and `ICreateDefaultToolsOptions`
are no longer exported from it. Import them from `@robota-sdk/agent-tool-defaults`. The packages are
pre-release and this repo keeps no compatibility shims, so they are moved rather than deprecated.

**Also breaking:** the internal `createSession` assembly factory is now `async`. This does NOT affect
`IAgentRuntime.createSession`, which stays synchronous — it does not call that factory, and a
verification scenario now asserts that explicitly, because propagating async through it would break
every consumer that builds a session without supplying `defaultTools`.

**Zero-config behaviour is unchanged**, deliberately. `createQuery` and the headless runtime have no
`defaultTools` seam, so a session built without one still receives the built-in tool tier —
`agent-framework` reaches the new leaf through a dynamic `import()`. An earlier revision of this work
proposed deleting the tier outright and was rejected on measurement: two published surfaces cannot
express the alternative, and the failure mode was a silently toolless agent behind a green typecheck.

**Why the move matters.** `agent-subagent-runner` legitimately depends on `agent-framework`, so while
the aggregator sat on that barrel a neutral runner could compose the product's tool surface with only
a scan in the way. It has no manifest edge to the new leaf, so that import does not resolve there at
all — the guarantee is carried by the type system now, mirroring what `@robota-sdk/agent-provider-defaults`
already does on the provider axis.

`@robota-sdk/pack-coding` is a patch: it consumes the leaf instead of rebuilding the same list by
hand. Its contributed tool surface is unchanged — verified from the published tarballs.
