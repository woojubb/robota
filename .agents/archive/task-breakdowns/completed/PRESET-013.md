# PRESET-013: 전환 시 모델/effort 라이브 재적용 — Task Breakdown

Spec: `.agents/spec-docs/done/PRESET-013-live-model-effort-reapply.md`

## Plan

- [x] TC-01: agent-core `setModel({...effort})` → `getConfig().defaultModel.effort` set
- [x] TC-02: `SessionBase.applyModelOptions({ effort })` → `robota.setModel` called with effort (spy)
- [x] TC-03: `applyModelOptions({ model })` → `getModelId()` updated (this.model mutable)
- [x] TC-04: `applyPresetToSession(..., { effort, temperature })` → runtime `applyModelOptions` called + applied
- [x] TC-05: no model fields → `applyModelOptions` not called + model groups skipped
- [x] TC-06: runtime without `applyModelOptions` (optional) → no throw
- [x] TC-07: `IResolvedPresetOptions` (effort/temperature/maxOutputTokens/model) assignable to `IPresetApplicationOptions`
- [x] TC-08: agent-core/session/framework build + test + `pnpm typecheck` exit 0
- [x] agent-core: `effort` channel on `IModelConfig` + `setModel`
- [x] agent-session: `applyModelOptions` seam + mutable `model` + getModelId accuracy
- [x] agent-framework: `IModelReapplyOptions` + `ICommandSessionRuntime.applyModelOptions?` + orchestrator model group

## Test Plan

Live model/effort/temperature/maxOutputTokens re-application. agent-core gains the `effort` channel
on `IModelConfig`/`setModel` (effort SSOT already existed; the setter channel was missing). agent-session
`applyModelOptions` re-applies via `robota.setModel` (maxOutputTokens→maxTokens) and updates `this.model`
so `getModelId()` stays accurate. agent-framework exposes the optional `applyModelOptions?` runtime seam
and `applyPresetToSession` re-applies the model group, reporting applied/skipped. Verified by agent-core
config assertion (TC-01), agent-session spies + getModelId (TC-02/03 + maxTokens mapping), framework
orchestrator spies (TC-04/05/06), agent-preset type-compat (TC-07), and build/test/typecheck/scan smoke.
The corrected seam is `robota.setModel` — the §7.1 `provider-hot-swap-requested` assumption was wrong
(that effect carries only `profileName`); design SSOT §7.1 updated.
