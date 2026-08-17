---
'@robota-sdk/agent-interface-transport': major
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-executor': patch
---

ARCH-037 — published-contract hygiene.

**Breaking for anyone importing these from `@robota-sdk/agent-interface-transport`** — hence `major`,
matching ARCH-031's precedent for a barrel that loses names (a `minor` would file the removal under
"Minor Changes" and a beta consumer scanning for breaking changes would meet it as a `TS2305` after
upgrading instead). The package is
pre-release and the repo keeps no compatibility shims, so the names are removed rather than deprecated;
both are re-exports of types `@robota-sdk/agent-core` owns and still exports under the same names.

- `IActionRequest` — import from `@robota-sdk/agent-core`.
- `TBackgroundPermissionPolicy` — import from `@robota-sdk/agent-core`.

`TActionResponse` deliberately STAYS. It is the one path by which `agent-transport-gui` and
`agent-transport-protocol` can name the type: neither may depend on `agent-core`, and `agent-core` is
the bottom layer, so the type cannot move down either. It is now a named exception carrying that
reasoning in the source.

**Added** to `@robota-sdk/agent-framework`: `ICreateDefaultToolsOptions`. `createDefaultTools` was
exported without it, so a consumer could call the function but could not name what it must pass —
they had to reverse-engineer the shape or cast into it. A new `barrel-parameter-types` harness floor
now fails on that shape rather than leaving it to review.

`@robota-sdk/agent-executor` is a patch only: it now sources `TBackgroundPermissionPolicy` from
`@robota-sdk/agent-core` (which it already depends on) instead of through the interface package. Its
own published surface is unchanged.
