---
'@robota-sdk/agent-product': minor
'@robota-sdk/agent-cli': patch
---

ARCH-008 — `robota` resolves presets through the composition kernel's per-call registry, so there is one
preset resolution path instead of two.

- **`@robota-sdk/agent-product`** — `IProductProfile` gains two optional fields. `presetRegistry` lets a
  consumer hand in an `IPresetRegistry` it already built (`createPresetRegistry`); when present the
  assembler ADOPTS that instance instead of building a second, equivalent one, so `product.presets` is
  that very object. This is the seam for a shell that must resolve a preset BEFORE it can build its
  profile — a preset can carry the `model` and `agentName` the profile is itself constructed from, so
  "resolve, then assemble" is a real ordering constraint. `presetContext` carries the override layers
  (`cliOverrides` / `explicit`) used when resolving `defaultPresetId`, so `product.defaultPreset` is the
  caller's full resolution rather than a variant missing its overrides. R8 is unaffected: the registry is
  still instance-scoped and no module-level state is read or mutated. Both fields are optional and the
  existing `presets` + `defaultPresetId` shape behaves exactly as before.
- **`@robota-sdk/agent-cli`** — `resolveCliPreset` is replaced by `resolveShellPreset(externalPresets,
args, settingsPreset)`, which builds the per-call registry, resolves over it, and returns
  `{ registry, presetId, context, options }` as one value. `createRobotaProfile` takes that whole value,
  so the shell cannot hand the kernel a registry, id, or override context other than the ones it actually
  resolved with. `robota`'s startup path no longer reads `agent-preset`'s module-global resolver; that
  registry remains only as the in-session `/preset` DISCOVERY surface, which is executed inside the
  session and has no handle on the assembled product. Both surfaces are fed by the one
  `loadExternalPresets()` call, so they cannot disagree.

End-user `robota` behavior is unchanged: the same preset resolves to the same options, external presets
in `~/.robota/presets/*.json` remain visible to both `--preset <id>` and `/preset`, and the assembled
command-module set, provider surface, tool set, subagent roster, and permission posture are untouched.
