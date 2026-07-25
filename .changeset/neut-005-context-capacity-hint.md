---
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-interface-transport': patch
---

NEUT-005 (wave 2): restore an actionable context-capacity hint at the surface tier, neutrally. The zero-dependency `agent-core` layer emits a product-neutral hard-capacity notice and exposes the `IAgentConfig.contextCapacityHint` seam (wave 1). This wave wires that seam end-to-end without baking product vocabulary into a neutral library:

- `agent-session`: `ISessionOptions.contextCapacityHint` is forwarded into the Robota agent config (`buildRobota`), making the core seam reachable from the consuming layer.
- `agent-framework`: new `deriveContextCapacityHint(commandModules)` derives the concrete remediation wording from the surface's OWN registered command set (names a registered `compact` command → `"Run /compact and retry."`; `undefined` when none, leaving the neutral core default). It is applied automatically in interactive session assembly across the TUI, print, and `--serve` surfaces.
- `agent-cli`: the default command set registers `/compact`, so end users regain the actionable hint.
- `agent-interface-transport`: reworded the `'allow-project'` permission comment so it no longer hardcodes a storage path (the location is owned by the consuming layer), matching the `agent-session` twin.
