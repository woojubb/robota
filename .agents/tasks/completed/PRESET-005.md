# PRESET-005 — autonomous-builder 프리셋 (Fable 5 작동원리 모방, 영어 persona)

Spec: `.agents/spec-docs/active/PRESET-005-autonomous-builder-preset.md`

## Plan (one task per Completion Criterion)

- [x] TC-01: persona non-empty + portable behavior keywords (non-sycophantic/own-mistakes/grounding + scope-constraint + tool-result grounding)
- [x] TC-02: effort === 'high'
- [x] TC-03: autonomy === 'act-first'
- [x] TC-04: enableParallelSubagents === true
- [x] TC-05: selfVerification === true
- [x] TC-06: no RUNTIME tokens in preset source (rg)
- [x] TC-07: no show-reasoning / CRITICAL / MUST (rg)
- [x] TC-08: id line has no vendor token (rg)
- [x] TC-09: listPresets includes autonomous-builder (title/description non-empty)
- [x] TC-10: `robota --preset autonomous-builder -p "ping"` exit 0
- [x] TC-11: agent-preset test + build exit 0
- [x] TC-12: no Hangul in preset source (rg -P \p{Hangul} → 0)

## Test Plan

New `packages/agent-preset/src/presets/autonomous-builder.ts` exporting an IPreset (English persona via
`persona` field, sourced from PORTABLE Fable-5 behavior only; effort 'high', autonomy 'act-first',
enableParallelSubagents true, selfVerification true; generic id, no vendor/runtime tokens, no Hangul,
no CRITICAL/MUST/show-reasoning). Register in `resolve-preset.ts` PRESETS array. Unit tests assert
resolved fields (TC-01..05/09) + rg command-form checks (TC-06/07/08/12) + CLI smoke (TC-10) + build (TC-11).
