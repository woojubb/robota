# PRESET-010: neutral-executor 프리셋 — Task Breakdown

Spec: `.agents/spec-docs/done/PRESET-010-neutral-executor-preset.md`

## Plan

- [x] TC-01: `neutral-executor.ts` defines `IPreset` with `autonomy: 'balanced'`
- [x] TC-02: `enableParallelSubagents: false`
- [x] TC-03: `selfVerification: false`
- [x] TC-04: `effort: 'medium'`
- [x] TC-05: persona with literal-instruction-following + minimal-scope phrasing (English)
- [x] TC-06: no reasoning-echo / `CRITICAL` / `MUST` tokens in persona source
- [x] TC-07: `id:` line carries no vendor token (`hermes`/`nous`/`claude`/`anthropic`)
- [x] TC-08: registered in `PRESETS`, exposed via `listPresets()`
- [x] TC-09: `pnpm --filter @robota-sdk/agent-preset test` + `build` exit 0
- [x] Register `neutralExecutorPreset` in `resolve-preset.ts` `PRESETS`
- [x] Add catalog entry to `packages/agent-preset/docs/SPEC.md`

## Test Plan

New `neutral-executor.ts` `IPreset` definition (thin, steerable, literal-execution posture: persona

- mechanism flags `autonomy: 'balanced'`, `enableParallelSubagents: false`, `selfVerification: false`,
  `effort: 'medium'`), registered in `PRESETS`. Verified by vitest unit assertions on the resolved
  options (autonomy/no-parallel/no-self-verify/effort/persona phrasing/listPresets/permission posture),
  command-form `rg` checks for absence of reasoning-echo, `CRITICAL`/`MUST`, vendor tokens and Hangul in
  the shipped source, and `pnpm build`+`test` smoke.
