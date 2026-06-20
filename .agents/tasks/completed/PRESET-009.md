# PRESET-009: careful-reviewer 프리셋 — Task Breakdown

Spec: `.agents/spec-docs/done/PRESET-009-careful-reviewer-preset.md`

## Plan

- [x] TC-01: `careful-reviewer.ts` defines `IPreset` with `autonomy: 'ask-first'`
- [x] TC-02: `selfVerification: true`
- [x] TC-03: `enableParallelSubagents: false`
- [x] TC-04: `effort` SET (`'high'`)
- [x] TC-05: persona with ask-before-write / plan-first + wait-before-change phrasing (English)
- [x] TC-06: no reasoning-echo / `CRITICAL` / `MUST` tokens in persona source
- [x] TC-07: `id:` line carries no vendor token
- [x] TC-08: registered in `PRESETS`, exposed via `listPresets()`
- [x] TC-09: `robota --preset careful-reviewer` resolves via PRESET-002 path
- [x] TC-10: `pnpm --filter @robota-sdk/agent-preset test` + `build` exit 0
- [x] Register `carefulReviewerPreset` in `resolve-preset.ts` `PRESETS`
- [x] Add catalog entry to `packages/agent-preset/docs/SPEC.md`

## Test Plan

New `careful-reviewer.ts` `IPreset` definition (ask-first reviewing posture: persona + mechanism
flags `autonomy`/`selfVerification`/`enableParallelSubagents`/`effort`), registered in `PRESETS`.
Verified by vitest unit assertions on the resolved options (autonomy/self-verification/no-parallel/
effort/persona phrasing/listPresets), command-form `rg` checks for absence of reasoning-echo,
`CRITICAL`/`MUST`, vendor tokens and Hangul in the shipped source, and `pnpm build`+`test` smoke.
