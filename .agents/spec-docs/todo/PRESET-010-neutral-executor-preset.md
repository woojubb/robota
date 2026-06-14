---
status: approved
type: BEHAVIOR
tags: [cli]
---

# PRESET-010: neutral-executor 프리셋 (Hermes식 얇은 페르소나·지시 충실·최소 편집)

## Problem

튜닝 프리셋 공간에는 **조종 가능(steerable)·최소 의견(minimal-opinion) 아키타입**이 없다. 사용자가
시스템/사용자 지시를 **문자 그대로** 따르고, 편집·코멘트를 최소화하며, 요청하지 않은 범위 확장을 하지
않는 "얇은 페르소나" 프로파일(Hermes식 neutral alignment, 설계 §2.3)이 필요하다. 이 아키타입은
스크립트/자동화 파이프라인에서 예측 가능한 출력을 요구할 때 핵심이다.

이 프리셋은 `default`(순정·비튜닝)와 **구별된다.** `default`는 어떤 방향으로도 동작을 핀하지 않는
대조군(설계 §6)인 반면, `neutral-executor`는 **terse·literal 동작을 능동적으로 핀**해 스크립트
가능(scriptable)·자동화용 행동을 보장한다. 일반 시스템(PRESET-001, done)은 이 아키타입을 그대로
수용한다 — 본 백로그는 콘텐츠(프리셋 정의)만 추가하며 시스템을 변경하지 않는다.

이 프리셋은 **페르소나 텍스트뿐 아니라 실제 framework 메커니즘을 구성(CONFIGURE)**한다(설계 §6.1). 즉
`neutral-executor`는 agent-preset의 빌트인 콘텐츠로서 framework/executor 메커니즘을 설정한다 —
agent-cli에 로직을 추가하지 않는다. 페르소나만으로 "얇음"을 흉내 내는 것은 본 백로그의 완료 조건이
아니다.

**선행 의존성:** PRESET-001(`IPreset` 계약 · resolvePreset · 레지스트리, **done**) · PRESET-002(`--preset`
선택 배선) · PRESET-003(페르소나/시스템 프롬프트 합성) · PRESET-004(모듈/권한 번들 + 실행 능력
활성). 이들이 없으면 `autonomy`/`enableParallelSubagents`/`selfVerification`/`effort` 필드가 실제 조립·호출까지
전달되지 못한다.

**재현 조건:** `listPresets()`에 neutral/steerable 프리셋이 없다(`default`만 비튜닝 대조군). `rg -l
"neutral-executor" packages/`는 0건이며 `packages/agent-preset/src/presets/`에는 `default.ts`만 존재한다 —
`robota --preset neutral-executor`는 PRESET-002의 "알 수 없는 preset" 경로로 빠진다.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §2.3(Hermes neutral alignment), §5.1(IPreset), §6(neutral-executor 행), §6.1(추적 매트릭스).

## Architecture Review

### Affected Scope

- `packages/agent-preset/src/presets/neutral-executor.ts` (NEW — 프리셋 정의)
- `packages/agent-preset/src/resolve-preset.ts` — 레지스트리에 등록
- `packages/agent-preset/docs/SPEC.md` — 프리셋 카탈로그 항목 추가
- 소비(선행 백로그가 제공): PRESET-001 `IPreset` 계약/resolvePreset/레지스트리, PRESET-002 `--preset`
  선택 배선, PRESET-003 페르소나 합성, PRESET-004 모듈/권한 번들 + 실행 능력 플래그

### Alternatives Considered

1. **페르소나 텍스트만으로 "얇음/충실"을 흉내 내고 framework 메커니즘은 손대지 않음.**
   - Pro: agent-preset 한 파일만 추가하면 됨; 선행 의존성 최소.
   - Con: autonomy/병렬 서브에이전트/자기검증이 실제 조립·집행에 전달되지 않아 "얇음"이 관찰 가능한
     동작 차이(예측 가능·최소 기계 장치)로 이어지지 않음 — 설계 §6.1(작동원리→메커니즘) 위반. Rejected.
2. **얇은 페르소나(literal-instruction-following + minimal-scope) + framework 메커니즘 SET(autonomy→권한
   포스처 / 병렬 서브에이전트 비활성 / 자기검증 비활성 / effort 핀)을 함께 하는 generic 프리셋.**
   - Pro: 검증 가능한 동작 차이(terse·literal·최소 기계 장치)를 메커니즘으로 구현; 설계 §2.3 Hermes
     neutral alignment 근거 충족; generic 식별자로 naming 규칙 준수; §6.1 추적 매트릭스 정렬.
   - Con: `autonomous-builder`와 달리 능력을 **끄는** 방향이라 "더 많은 일을 한다"는 직관과 반대 —
     description에 "최소 의견·스크립트 가능" 의도를 명시해야 함.

### Decision

**Alternative 2.** `neutral-executor`는 얇은 페르소나 + framework 메커니즘 SET을 함께 한다. 페르소나는
Hermes식 neutral alignment(설계 §2.3) — 시스템 프롬프트 + 사용자 지시를 문자 그대로 따르고, editorializing을
최소화하며, 요청 범위를 넘는 확장을 하지 않고, terse하게 출력 — 로 구성하고, **동시에** framework seam을
설정한다(아래 매핑 표). 식별자는 generic(`neutral-executor`)이며 벤더 토큰(`hermes` 포함)을 식별자에 쓰지
않는다(`feedback_no_product_names`, `naming-style.md`; 'hermes'는 식별자가 될 수 없음 — description의
출처 각주 한정만 허용). 트레이드오프: 능력을 **끄는**(예측 가능·최소 기계 장치) 방향을 택해 자동화/스크립트
용도에 부합하는 조종 가능한 대조군을 얻는다.

#### Hermes식 작동원리 → 본 프리셋의 구체 설정 매핑 (설계 §2.3·§5.1·§6.1 참조)

| Hermes식 작동원리                           | 본 프리셋의 구체 설정                                                                   | 재현 수단 / 소유 레이어                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------- |
| 페르소나를 시스템 프롬프트에 전적 위임      | `appendSystemPrompt`: 시스템 프롬프트 + 사용자 지시를 문자 그대로 따름(literal)         | (b) 페르소나, framework 합성             |
| 최소 거부·최소 설교(minimal editorializing) | `appendSystemPrompt`: editorializing/코멘트 최소, 요청 범위 밖 확장 금지(minimal-scope) | (b) 페르소나                             |
| 묻지도 과행동도 않음(neutral alignment)     | `autonomy: 'balanced'` → 권한 포스처(defaultPermissionMode/trust)로 매핑                | (c) PRESET-004 권한 집행                 |
| 예측 가능·최소 기계 장치                    | `enableParallelSubagents: false`, `selfVerification: false`                             | (d)(e) PRESET-004 능력 플래그(끔)        |
| 스크립트 가능·재현 가능 출력                | `effort: 'medium'`(예측 가능/스크립트 가능)                                             | (a) provider/core 호출, 배선=선행 백로그 |
| 얇은 프리셋(과지시 스캐폴딩 제거)           | 아래 LIGHT-PRESET AUTHORING CONSTRAINT 준수                                             | (b) 프리셋 저자 규칙                     |

#### LIGHT-PRESET AUTHORING CONSTRAINT (설계 §6.1 항목 17)

페르소나는 **가벼워야** 한다(Hermes식 얇은 페르소나의 핵심):

- "CRITICAL" / "MUST" 류 강조어를 쌓아 지시를 누적하지 않는다(과지시 스캐폴딩 금지).
- 모델에게 raw reasoning을 드러내거나 echo 하라고 지시하지 않는다("추론을 보여줘"/"show your reasoning").
- 소수의 지향 특성(문자 그대로 따름 · 최소 편집 · 최소 범위 · terse)으로 정의한다(설계 §2.3).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-preset(정의/등록/SPEC), 메커니즘은 PRESET-002/003/004가 소유
- [x] Sibling scan 완료 — `default`(PRESET-001) 및 동형 sibling PRESET-005 `autonomous-builder` 형태 확인 후 동일 `IPreset` 형태로 작성
- [x] 대안 최소 2개 검토 완료 — 2개 검토(페르소나 전용 / 페르소나+메커니즘 SET)
- [x] 결정 근거 문서화 완료 — Hermes neutral alignment 근거 + generic 식별자(벤더 토큰 금지) + 능력 끄는 메커니즘 SET 근거 기록

## Solution

1. `neutral-executor.ts`에 `IPreset` 정의:
   - **정체성**: `id: 'neutral-executor'`(generic, 벤더 토큰 없음 — 'hermes'는 식별자 불가), `title`,
     `description`("Hermes식 neutral alignment에서 영감" 출처 각주 허용)
   - **페르소나**(`appendSystemPrompt`, 가볍게): 시스템 프롬프트 + 사용자 지시를 문자 그대로 따름(literal) ·
     editorializing/코멘트 최소 · 요청 범위 밖 확장 금지(minimal-scope) · terse 출력. "CRITICAL"/"MUST"
     누적 금지, "show your reasoning" 류 지시 금지.
   - **자율 메커니즘**: `autonomy: 'balanced'`(묻지도 과행동도 않음) → PRESET-004가 권한 포스처로 매핑
   - **실행 능력 메커니즘(끔)**: `enableParallelSubagents: false`, `selfVerification: false`(예측 가능·최소 기계 장치)
   - **effort 메커니즘**: `effort: 'medium'`(예측 가능/스크립트 가능 — 주석으로 근거 명시)
2. 레지스트리에 등록 → `listPresets()`에 노출.
3. SPEC.md 카탈로그에 항목 추가(Hermes neutral alignment 근거 + 매핑 표 반영).

## Affected Files

- `packages/agent-preset/src/presets/neutral-executor.ts` (NEW)
- `packages/agent-preset/src/resolve-preset.ts`
- `packages/agent-preset/docs/SPEC.md`

## Completion Criteria

- [ ] TC-01: `resolvePreset('neutral-executor', base)` 결과가 `autonomy === 'balanced'`임을 단언하는 단위 테스트 통과
- [ ] TC-02: `resolvePreset('neutral-executor', base)` 결과가 `enableParallelSubagents === false`임을 단언하는 단위 테스트 통과
- [ ] TC-03: `resolvePreset('neutral-executor', base)` 결과가 `selfVerification === false`임을 단언하는 단위 테스트 통과
- [ ] TC-04: `resolvePreset('neutral-executor', base)` 결과의 `effort`가 SET되어 있음(`'medium'`)을 단언하는 단위 테스트 통과
- [ ] TC-05: `resolvePreset('neutral-executor', base)` 결과의 `appendSystemPrompt`가 literal-instruction-following 어구(시스템/사용자 지시를 문자 그대로 따름)와 minimal-scope 어구(요청 범위 밖 확장 금지)를 둘 다 포함함을 단언하는 단위 테스트 통과
- [ ] TC-06: `neutral-executor.ts`에 대해 `rg -i "show your reasoning|reveal your reasoning|CRITICAL|MUST"` 결과가 0건임(페르소나가 raw reasoning echo 지시와 "CRITICAL"/"MUST" 누적을 포함하지 않음)을 단언하는 커맨드폼 테스트 통과
- [ ] TC-07: `rg -nE "\bid:\s*['\"]" packages/agent-preset/src/presets/neutral-executor.ts` 의 식별자 라인에 벤더 토큰(`hermes`/`nous`/`claude`/`anthropic`)이 없음을 단언하는 커맨드폼 테스트 통과(있다면 description 각주 한정)
- [ ] TC-08: `listPresets()`에 `id === 'neutral-executor'`(title/description 비어있지 않음) 항목 존재 단언 테스트 통과
- [ ] TC-09: `pnpm --filter @robota-sdk/agent-preset test` + `build` → exit 0

## Test Plan

Type BEHAVIOR + tags cli → 프리셋 resolve 메커니즘 단언(autonomy/병렬 끔/자기검증 끔/effort 핀) +
페르소나 어구 단언 + grep 부재/식별자 검사 + 테스트/빌드 스모크.

| TC-ID | Test Type              | Tool / Approach                                                   | Notes    |
| ----- | ---------------------- | ----------------------------------------------------------------- | -------- |
| TC-01 | RULE (unit)            | vitest — resolvePreset autonomy === 'balanced' 단언               |          |
| TC-02 | RULE (unit)            | vitest — resolvePreset enableParallelSubagents === false 단언     |          |
| TC-03 | RULE (unit)            | vitest — resolvePreset selfVerification === false 단언            |          |
| TC-04 | RULE (unit)            | vitest — resolvePreset effort === 'medium' 단언                   |          |
| TC-05 | RULE (unit)            | vitest — appendSystemPrompt literal+minimal-scope 어구 단언       |          |
| TC-06 | CI pipeline smoke test | `rg -i` reasoning-echo/CRITICAL/MUST 부재 단언                    | 커맨드폼 |
| TC-07 | CI pipeline smoke test | `rg -nE` id 라인 벤더 토큰 부재 단언                              | 커맨드폼 |
| TC-08 | RULE (unit)            | vitest — listPresets 항목 단언                                    |          |
| TC-09 | CI pipeline smoke test | `pnpm --filter @robota-sdk/agent-preset test` + `build` exit code | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — neutral-executor terse/literal vs default:** 전제: PRESET-001~004 완료 + 프로바이더 설정.
  실행: 동일 작업 프롬프트(예: "이 함수에 null 체크를 추가해줘")를 `robota -p "..."`(default)와
  `robota --preset neutral-executor -p "..."`로 각각 실행. 기대: neutral-executor 쪽이 더 terse·literal
  (요청한 변경만 수행, 인접 리팩터/코멘트 없음, 병렬 서브에이전트·자기검증 루프 미사용)으로 동작하는
  관찰 가능한 차이. 정리: 변경 파일 되돌리기. Evidence: 두 실행의 출력/행동 비교 캡처(구현 후 기록).

환경: PRESET-002 선행, 실제 프로바이더 키 필요(로컬 설정 사용). depends_on: PRESET-001(done), 002, 003, 004.

## Tasks

- [ ] `.agents/tasks/PRESET-010.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: BEHAVIOR` (valid 11-prefix value); `tags: [cli]` present.
- Problem: concrete symptom (`rg -l "neutral-executor" packages/` = 0건; only `default.ts` exists; `robota --preset neutral-executor` falls to PRESET-002 "unknown preset" path) + reproduction condition (`listPresets()` lacks neutral/steerable preset); no TBD/TODO/vague single-sentence.
- Architecture Review Checklist: all 4 items `[x]`; Sibling scan `[x]` with completion evidence (default/PRESET-005 form confirmed); Alternatives Considered = 2 entries each with Pro/Con; Decision references the driving trade-off (능력을 끄는 방향 → scriptable 대조군).
- Completion Criteria: TC-01..TC-09 all carry TC-N prefix; each is command-form or observable assertion (=== checks, grep counts, exit 0); no banned phrases (`works correctly`/`no errors`/`implemented`/`displays correctly`) found via rg (exit 1).
- Test Plan: `## Test Plan` present; 9 rows TC-01..TC-09 match 9 Completion Criteria (count matches); every row has non-empty Test Type and Tool/Approach (no TBD); no row uses Tool "manual" so manual-justification rule does not trigger.
- Structure: Tasks section present with placeholder; Evidence Log present and empty before this run; no `## Status` or `## Classification` body sections.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved

- Prior-gate precondition: `### [GATE-WRITE] — ✅ PASS | 2026-06-14` entry present in Evidence Log; frontmatter `status: review-ready` matches expected input stage. Prior gate confirmed in order.
- Explicit approval (verbatim): orchestrator asked "다르게 튜닝된 추가 프리셋(careful-reviewer, neutral-executor)을 지금 백로그로 구체화할까요?" and the user replied "지금 백로그 생성 (PRESET-009/010)" — direct, unambiguous authorization naming PRESET-010 explicitly to create and advance this backlog as an approved spec.
- Directed at this spec: approval names "PRESET-009/010" and "neutral-executor" explicitly; not approval of a different item, not a clarifying-question answer.
- No Architecture Review or frontmatter type/tags modified after approval: frontmatter intact (`type: BEHAVIOR`, `tags: [cli]`); Architecture Review section unchanged.
- NON-COMPLIANCE trigger check (no implementation started): `.agents/tasks/PRESET-010.md` absent (ls: No such file or directory); `packages/agent-preset/src/presets/neutral-executor.ts` absent; `rg -l "neutral-executor" packages/` = 0 results. No implementation work begun before this gate.
