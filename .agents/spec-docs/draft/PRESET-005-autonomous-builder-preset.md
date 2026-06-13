---
status: draft
type: BEHAVIOR
tags: [cli]
---

# PRESET-005: 첫 프리셋 autonomous-builder (reference profile 작업 스타일 모방)

## Problem

프리셋 인프라(PRESET-001~004)가 갖춰져도 **출하되는 의견 있는(opinionated) 프리셋이 하나도 없으면**
기능이 무의미하다. 사용자가 요청한 첫 프리셋은 "reference profile 스타일"이다. 그러나 리서치 결과 Anthropic은
reference profile의 시스템 프롬프트나 성격 명세를 공개한 적이 없으므로(설계 제안서 §2.1) "프롬프트 복제"는
불가능하다. 대신 **문서화된 작업 스타일**(능동·철저·자기검증·고자율·요청 범위 확장 경향)과 Anthropic
"Claude's Character" 원칙을 재현한 generic 프리셋을 만든다. 식별자에는 벤더명을 쓸 수 없다
(`feedback_no_product_names`, `naming-style.md`).

**재현 조건:** `listPresets()`에 `default` 외 의견 프리셋이 없다. `robota --preset autonomous-builder`
→ PRESET-002의 "알 수 없는 preset" 오류.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §2.1, §2.2, §6.

## Architecture Review

### Affected Scope

- `packages/agent-preset/src/presets/autonomous-builder.ts` (NEW — 프리셋 정의)
- `packages/agent-preset/src/resolve-preset.ts` — 레지스트리에 등록
- `packages/agent-preset/docs/SPEC.md` — 프리셋 카탈로그 항목 추가
- 소비: PRESET-001 `IPreset`, PRESET-003 페르소나 합성, PRESET-004 모듈/권한 번들

### Alternatives Considered

1. **공개되지 않은 "reference profile 시스템 프롬프트"를 추측해 재현.**
   - Pro: 사용자의 "reference profile 모방" 요청에 표면적으로 충실.
   - Con: 1차 출처가 없어 날조가 됨 — 정직성 위반, 검증 불가. Rejected.
2. **문서화된 reference profile 작업 스타일 + Claude's Character 원칙으로 페르소나를 구성, generic 식별자 사용.**
   - Pro: 검증 가능한 출처 기반; 규칙(벤더명 금지) 준수; 실제 행동 차이(고자율·자기검증) 구현 가능.
   - Con: "reference profile와 똑같은 프롬프트"는 아님(애초에 공개 안 됨) — 사용자에게 이 한계를 명시해야 함.

### Decision

**Alternative 2.** `autonomous-builder` 프리셋을 문서화된 작업 스타일(능동·철저·자기검증·고자율, 병렬
서브에이전트 적극, 작업 후 자기 검증) + Claude's Character 원칙(비아첨적 정직·원칙 기반)으로 구성한다.
식별자는 generic(`autonomous-builder`), description에 "reference profile 작업 스타일에서 영감" 출처 각주 허용
(사용자 확인). 모델/effort는 고capability·`effort: high`·`autonomy: act-first`로 핀. 트레이드오프: "동일
프롬프트 복제"를 포기(불가능)하고 검증 가능·규칙 준수·실제 행동 차이를 얻는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-preset(정의/등록/SPEC)
- [x] Sibling scan 완료 — `default` 프리셋 형태(PRESET-001) 확인 후 동일 `IPreset` 형태로 작성
- [x] 대안 최소 2개 검토 완료 — 2개 검토
- [x] 결정 근거 문서화 완료 — 정직성 경계 + generic 식별자 근거 기록

## Solution

1. `autonomous-builder.ts`에 `IPreset` 정의:
   - `id: 'autonomous-builder'`, `title`, `description`(출처 각주 포함)
   - `appendSystemPrompt`: 능동성·철저함·작업 후 자기검증·요청 인접 이슈 처리·병렬 작업 지향을 기술한
     페르소나 텍스트(원칙 기반, 비아첨적 정직 포함)
   - `model` + `effort: 'high'` + `autonomy: 'act-first'`
   - 권한/모듈 번들(PRESET-004): 빌더 작업에 맞는 기본 권한 프로파일
2. 레지스트리에 등록 → `listPresets()`에 노출.
3. SPEC.md 카탈로그에 항목 추가.

## Affected Files

- `packages/agent-preset/src/presets/autonomous-builder.ts` (NEW)
- `packages/agent-preset/src/resolve-preset.ts`
- `packages/agent-preset/docs/SPEC.md`

## Completion Criteria

- [ ] TC-01: `resolvePreset('autonomous-builder', base)` 결과의 `appendSystemPrompt`가 작업 스타일 핵심 어구(예: 자기검증/능동성 관련 키워드)를 포함함을 단언하는 단위 테스트 통과
- [ ] TC-02: `resolvePreset('autonomous-builder', base)` 결과가 `effort: 'high'`, `autonomy: 'act-first'`로 핀됨을 단언하는 단위 테스트 통과
- [ ] TC-03: `listPresets()`에 `id === 'autonomous-builder'`(title/description 비어있지 않음) 항목 존재 단언 테스트 통과
- [ ] TC-04: `rg -i "reference|hermes|claude" packages/agent-preset/src/presets/autonomous-builder.ts` 결과에서 `id`/식별자 라인에는 벤더 토큰이 없음(있다면 description 각주 한정) — 식별자 generic 단언
- [ ] TC-05: `robota --preset autonomous-builder -p "ping"` → exit 0 (PRESET-002 경로로 정상 해석, 무회귀 아님: 의견 프리셋 적용)
- [ ] TC-06: `pnpm --filter @robota-sdk/agent-preset test` + `build` → exit 0

## Test Plan

Type BEHAVIOR + tags cli → 프리셋 resolve 단위 단언 + 프로세스 스모크 + grep 식별자 검사.

| TC-ID | Test Type              | Tool / Approach                         | Notes    |
| ----- | ---------------------- | --------------------------------------- | -------- |
| TC-01 | RULE (unit)            | vitest — appendSystemPrompt 키워드 단언 |          |
| TC-02 | RULE (unit)            | vitest — effort/autonomy 핀 단언        |          |
| TC-03 | RULE (unit)            | vitest — listPresets 항목 단언          |          |
| TC-04 | CI pipeline smoke test | `rg` 식별자 라인 벤더 토큰 부재 단언    | 커맨드폼 |
| TC-05 | FLOW (cli)             | 프로세스 spawn 종료코드                 | 커맨드폼 |
| TC-06 | CI pipeline smoke test | `pnpm test` + `build` exit code         | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — autonomous-builder 체감:** 전제: PRESET-001~003(가능하면 004) 완료 + 프로바이더 설정.
  실행: 동일 작업 프롬프트(예: "이 함수의 버그를 고쳐줘")를 `robota -p "..."`(default)와
  `robota --preset autonomous-builder -p "..."`로 각각 실행. 기대: autonomous-builder 쪽이 더 능동적
  (자기검증·인접 이슈 처리·범위 확장)으로 동작하는 관찰 가능한 차이. 정리: 변경 파일 되돌리기.
  Evidence: 두 실행의 출력/행동 비교 캡처(구현 후 기록).

환경: PRESET-002 선행, 실제 프로바이더 키 필요(로컬 설정 사용).

## Tasks

- [ ] `.agents/tasks/PRESET-005.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
