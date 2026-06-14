# PRESET-002 — --preset 선택 배선 (cli=껍데기)

Spec: `.agents/spec-docs/active/PRESET-002-preset-selection-wiring.md`

## Plan (one task per Completion Criterion)

- [x] TC-01: `robota --preset default -p "ping"` 종료/경로가 플래그 없음과 동일 (무회귀) — built CLI 실행 evidence
- [x] TC-02: `robota --preset __nope__ -p "ping"` → 비-0 + stderr에 available id 목록(default 포함)
- [x] TC-03: settings.preset 읽어 resolvePreset에 사용 (selectPresetId 단위 테스트)
- [x] TC-04: --preset 플래그가 settings.preset를 덮음 (selectPresetId 단위 테스트)
- [x] TC-05: resolvePreset 결과 model이 cli→assembly(modelId)로 전달 (단위/통합 테스트)
- [x] TC-06: `pnpm --filter @robota-sdk/agent-cli build` + `pnpm typecheck` exit 0

## Test Plan

cli=껍데기 원칙: 선택(id 결정 flag>settings>default)은 cli glue, 우선순위 MERGE는 agent-preset.resolvePreset가
소유. 선택 로직을 `packages/agent-cli/src/startup/preset-selection.ts`의 순수 함수(`selectPresetId`,
`buildPresetCliOverrides`, `resolveCliPreset`)로 추출해 vitest 단위 테스트(TC-02/03/04/05). 무회귀/오류는
빌드한 CLI 실행으로 evidence 캡처(TC-01/02). 빌드+타입체크 스모크(TC-06). SettingsSchema에 `preset?: string`.
