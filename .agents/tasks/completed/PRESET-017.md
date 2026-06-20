# PRESET-017: selfVerification 시스템 프롬프트 자기검증 섹션 — Task Breakdown

Spec: `.agents/spec-docs/done/PRESET-017-self-verification-section.md`

## Plan

- [x] TC-01: `buildSystemPrompt({selfVerification:true})` includes the section; false/omitted → absent
- [x] TC-02: `createSelfVerificationSection()` → source 'self-verification', priority 6, non-empty
- [x] TC-03: `rebuildSystemMessage(a,c,{selfVerification:true})` includes it; later override-less rebuild persists it
- [x] TC-04: `applyPresetToSession(..., {selfVerification:true})` → `applySelfVerification(true)` + applied
- [x] TC-05: omitted → not called + in skipped; context without method → no throw
- [x] TC-06: section content has no CRITICAL/MUST/show-your-reasoning + no Hangul
- [x] TC-07: framework build + test + typecheck + harness:scan pass
- [x] source enum + section provider (priority 6, English content)
- [x] builder composes section when true; runtime closure mutable currentSelfVerification (PRESET-014 mirror)
- [x] InteractiveSession.applySelfVerification + host seam + orchestrator group

## Test Plan

selfVerification becomes a system-prompt section composed by the SAME priority/source mechanism as
persona (priority 6, source 'self-verification' — sorted by `composeSystemPrompt`, not hardcoded),
included only when the flag is true. The create-session-runtime closure tracks a mutable
`currentSelfVerification` (mirroring PRESET-014 persona) so a live switch recomposes + persists; exposed
via `ICommandHostContext.applySelfVerification?` and re-applied by `applyPresetToSession`. The section
content is concise English (verify against tool results before reporting done), with no CRITICAL/MUST/
reasoning-echo and no Hangul. Verified by builder/section/runtime unit tests, orchestrator spy tests, a
content-constraint assertion, and build/test/typecheck/scan smoke. Default (unset/false) adds no section
→ no regression. The deterministic verification loop (running lint/tests) remains a separate feature.
