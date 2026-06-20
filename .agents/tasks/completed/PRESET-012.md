# PRESET-012: 전환 시 권한/신뢰 포스처 라이브 재적용 — Task Breakdown

Spec: `.agents/spec-docs/done/PRESET-012-live-permission-reapply.md`

## Plan

- [x] TC-01: `applyPresetToSession(ctx, id, { permissionMode })` → runtime `setPermissionMode` called with it
- [x] TC-02: same call → runtime `setActivePresetId` called with the preset id
- [x] TC-03: no permissionMode → `setPermissionMode` not called, result.skipped has 'permissionMode'
- [x] TC-04: permissionMode present → result.applied has 'permissionMode'
- [x] TC-05: runtime without `setActivePresetId` (optional unimpl) → no throw, permission still applied
- [x] TC-06: agent-preset `TResolvedPresetOptions` assignable to framework `IPresetApplicationOptions`
- [x] TC-07: framework build + test + `pnpm typecheck` exit 0
- [x] `preset-application.ts` orchestrator (applyPresetToSession + IPresetApplicationOptions/Result)
- [x] Export via command-api/index.ts + commands/index.ts + framework index.ts

## Test Plan

Live re-application orchestrator in agent-framework command-api: `applyPresetToSession(context,
presetId, options)` records the active preset id (PRESET-011 optional state, defensive optional
chaining) and re-applies the permission posture via the existing `writeCommandPermissionMode` seam,
reporting applied/skipped option groups. The option param `IPresetApplicationOptions` is a
framework-owned shape that agent-preset's `TResolvedPresetOptions` satisfies structurally (no
dependency cycle). Verified by framework vitest spies (permission applied, active id recorded,
skip-when-absent, applied/skipped report, optional-unimpl safety), an agent-preset type-compat
assertion (valid dep direction), and build/test/typecheck/scan smoke. PRESET-012 owns only the
permission group; PRESET-013/014 extend the same orchestrator.
