---
'@robota-sdk/agent-product': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-transport-tui': minor
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-cli': minor
---

ARCH-005 Stage S2 — `robota` is now expressed as an `IProductProfile` and assembled by `assembleProduct`;
the hand-wired composition root in `agent-cli` is gone.

- **`@robota-sdk/agent-product`** — provider construction returns IN-KERNEL. `assembleProduct` builds the
  provider from `providerDefinitions` + the shell's already-resolved `providerSettings` via agent-core's
  pure `createProviderFromConfig`; `provider` is now an OPTIONAL injected override. Both are optional, so a
  Mode A profile can carry only `providerDefinitions`. The fold stays pure and IO-free — every
  settings/env/file read still happens in the shell. Adds `IAssembledProduct.buildRuntimeOptions`, the pure
  overlay `buildRuntime` delegates through, and `IAssembledProduct.providerDefinitions`.
  **Breaking for pre-release consumers:** `IProductProfile.providerDefinitions` is now required and
  `IProductProfile.provider` / `IAssembledProduct.provider` are now optional.
- **`@robota-sdk/agent-framework`** — a scoped, additive session seam: `agentDefinitions` on
  `TInteractiveSessionOptions` / `ICreateSessionOptions`, composed into the built-in agent tier ahead of
  `BUILT_IN_AGENTS`, so capability-pack subagents actually reach the runtime. Precedence: discovered
  project/user definitions > injected > built-in. `AgentDefinitionLoader` now dedupes within that tier
  (first wins). Absent ⇒ unchanged behavior.
- **`@robota-sdk/agent-transport` / `@robota-sdk/agent-transport-tui`** — forward the optional
  `agentDefinitions` through the headless and TUI channels so every robota surface carries the seam.
- **`@robota-sdk/agent-cli`** — `robota`'s identity (branding, provider surface, presets,
  `packs: [codingPack]`, base command modules, injected transports/runners/subagent factory) is declared as
  data in a product profile and folded by `assembleProduct`. The coding command modules (`/shell`,
  `/editor`) now come from `pack-coding` rather than the base set, so the pack is load-bearing. What remains
  in the CLI is product-shell only: arg parsing, settings/file IO, terminal notices, first-run/init/
  `--configure`, memory + session-resume UX, and print/serve/TUI mode dispatch.

End-user `robota` behavior is unchanged: the assembled command-module set, provider surface, tool set,
subagent roster, and preset resolution all match the pre-change assembly.
