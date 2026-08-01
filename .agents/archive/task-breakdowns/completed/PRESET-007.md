# PRESET-007: 사용자 작성/외부 프리셋 로딩 — Task Breakdown

Spec: `.agents/spec-docs/done/PRESET-007-user-authored-external-presets.md`

## Plan

- [x] TC-01: valid preset JSON in a dir → `loadExternalPresetsFromDir` → `listPresets()` includes its id
- [x] TC-02: schema-violating file skipped (in `errors`, not registered); valid sibling still loads
- [x] TC-03: external id colliding with a built-in → rejected (built-in wins; reported in errors)
- [x] TC-04: no/empty external dir → `listPresets()` returns built-ins only (no regression)
- [x] TC-05: agent-preset build + test exit 0
- [x] resolve-preset registry refactor (BUILT_IN_PRESETS + externalPresets + allPresets + register/clear)
- [x] preset-validation.ts manual type-guard validator (no Zod)
- [x] load-external-presets.ts (fs loader, default `~/.robota/presets`)
- [x] agent-cli thin startup call to `loadExternalPresets()`

## Test Plan

File-based external preset loading merged with the built-in registry. agent-preset gains a sync
registration seam (`registerExternalPresets`/`clearExternalPresets`) over `[...BUILT_IN_PRESETS,
...externalPresets]`, a manual type-guard `validateExternalPreset` (no new dep), and `loadExternalPresets`
(scans `~/.robota/presets/*.json`, validates, registers; per-file errors collected, run continues). id
conflict policy: external cannot override a built-in id (rejected). agent-cli invokes the loader once at
startup before resolution (thin shell). Verified by agent-preset integration tests (temp-dir fixtures:
load/skip-invalid/collision/no-regression) + validator units, with registry isolation (clearExternalPresets)
keeping the existing resolve-preset suite green, plus build/test/typecheck/scan smoke.
