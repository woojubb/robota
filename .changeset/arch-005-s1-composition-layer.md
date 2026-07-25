---
'@robota-sdk/agent-capability-pack': minor
'@robota-sdk/agent-product': minor
'@robota-sdk/pack-coding': minor
'@robota-sdk/agent-preset': minor
---

ARCH-005 Stage S1 — the external product-composition layer. Three new published packages plus a minimal
`agent-preset` addition:

- **`@robota-sdk/agent-capability-pack`** (new) — the additive capability-bundle contract
  (`ICapabilityPack`) and the pure `mergeCapabilityPacks` merger (base ⊕ packs in profile order, with a
  `{ merged, rejected }` conflict channel — never a silent override). The additive analog of
  `agent-preset`; contract + pure fold, no IO.
- **`@robota-sdk/agent-product`** (new) — the product-assembly kernel. `assembleProduct(profile)` is a pure,
  deterministic, IO-free fold over `IProductProfile` with zero product-specific branching: it resolves
  presets via a per-call instance-scoped registry, merges additive packs, and DELEGATES runtime
  construction to `agent-framework`'s `buildRuntimeSession` seam (never re-implemented). Its neutrality is
  enforced by three mechanical guards (dependency-graph neutrality, purity/no-IO, no product-name
  conditionals), coupling the amended project-structure L129 carve-out to the guards.
- **`@robota-sdk/pack-coding`** (new) — robota's coding capability as one `ICapabilityPack` (the built-in
  coding tools, the `/shell` + `/editor` command modules, and the coding subagents) — the additive-axis
  proof and robota's first pack.
- **`@robota-sdk/agent-preset`** — adds `createPresetRegistry`, a per-call instance-scoped resolver that
  never mutates the module-level external-preset global (consumed by `assembleProduct`).

`agent-framework` and `agent-core` are unchanged. The CLI is not yet wired to `assembleProduct` (that is
Stage S2).
