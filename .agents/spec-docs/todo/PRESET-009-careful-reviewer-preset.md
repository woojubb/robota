---
status: approved
type: BEHAVIOR
tags: [cli]
---

# PRESET-009: careful-reviewer 프리셋 (읽기 중심·ask-first 검토형)

## Problem

프리셋 시스템(PRESET-001, 구현 완료)은 임의 개수의 튜닝/비튜닝 프로파일을 동일한 계약으로 다루는
**일반 시스템**이다(설계 §6). 그러나 현재 출하되는 프리셋은 `default`(순정·vanilla)와
`autonomous-builder`(act-first·능동 튜닝, PRESET-005) 둘뿐이다. 자율성 축(ask-first ↔ act-first)에서
**act-first 극단만 채워져 있고, 대조되는 ask-first(읽기 중심·검토형) 아키타입이 비어 있다**. 시스템은
이미 이를 지원하므로(PRESET-001 done) 본 백로그는 **콘텐츠만** 추가한다 — 시스템 변경 없이 N개를
수용한다(설계 §6 각주).

이 프리셋은 **페르소나 텍스트뿐 아니라 실제 메커니즘 설정**이어야 한다(설계 §6.1). 즉
`careful-reviewer`는 agent-preset의 빌트인 콘텐츠로서 framework/executor 메커니즘을 **구성(CONFIGURE)**
한다 — agent-cli에 로직을 추가하지 않는다. 페르소나만으로 "검토형"을 흉내 내는 것은 본 백로그의
완료 조건이 아니다.

**선행 의존성:** PRESET-001(`IPreset` 계약 + resolvePreset + listPresets, **done**) ·
PRESET-002(`--preset` 선택 배선) · PRESET-003(페르소나/시스템 프롬프트 합성) ·
PRESET-004(`autonomy` → `defaultPermissionMode`/`defaultTrustLevel` 매핑 + 권한 집행). 이들이 없으면
`autonomy: 'ask-first'`/`selfVerification`/`effort` 필드가 실제 권한 포스처·호출까지 전달되지 못한다.

**재현 조건:** `listPresets()`에 ask-first/검토 지향 프리셋이 없다(`default`+`autonomous-builder`만 노출).
`rg -l "careful-reviewer" packages/`가 0건 — `careful-reviewer` 프리셋 파일이 존재하지 않는다.
`robota --preset careful-reviewer` → PRESET-002의 "알 수 없는 preset" 오류.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §5.1, §6, §6.1.

## Architecture Review

### Affected Scope

- `packages/agent-preset/src/presets/careful-reviewer.ts` (NEW — 프리셋 정의)
- `packages/agent-preset/src/resolve-preset.ts` — 레지스트리(`PRESETS`)에 등록
- `packages/agent-preset/docs/SPEC.md` — 프리셋 카탈로그 항목 추가
- 소비(선행 백로그가 제공): PRESET-001 `IPreset` 계약 + resolvePreset/listPresets, PRESET-002 `--preset`
  선택 배선, PRESET-003 페르소나 합성, PRESET-004 `autonomy` → 권한 포스처 매핑 + 권한 집행

### Alternatives Considered

1. **`autonomy: 'ask-first'`를 라벨로만 두고 페르소나 텍스트만으로 "검토형"을 흉내 내며 메커니즘은
   손대지 않음.**
   - Pro: agent-preset 한 파일만 추가하면 됨, 페르소나 외 설정 불필요.
   - Con: ask-first가 권한 포스처(ask-on-write)로 전달되지 않아 "write/exec마다 묻기"가 관찰 가능한
     동작 차이로 이어지지 않음 — 설계 §6.1(작동원리→메커니즘) 위반. Rejected.
2. **메커니즘 필드(`autonomy`/`selfVerification`/`enableParallelSubagents`/`effort`)만 설정하고 페르소나는
   비움.**
   - Pro: 권한 포스처는 정확히 ask-first로 동작.
   - Con: "읽기/분석 먼저 → 계획 제시 → 확인 대기" 행동 가이드와 근거·트레이드오프 설명 스타일이
     모델에 전달되지 않아 검토형 보이스가 사라짐 — 설계 §6.1 #7/#13의 페르소나 재현 수단 누락. Rejected.
3. **읽기 중심·ask-first 행동 가이드 페르소나를 가볍게 구성하고, 동시에 framework/executor 메커니즘
   (`autonomy: 'ask-first'` → 권한 포스처 + `selfVerification` + `enableParallelSubagents: false` +
   `effort`)을 SET 하는 generic 튜닝 프리셋.**
   - Pro: 검증 가능한 행동 차이(쓰기/실행 전 ask, 계획 우선); 규칙(벤더명 금지) 준수;
     `autonomous-builder`(act-first)와 대조되는 ask-first 축을 메커니즘으로 구현; 설계 §6.1 추적
     매트릭스(autonomy→권한 포스처, 자기검증, 페르소나) 충족.
   - Con: 매번 묻는 권한 포스처는 비대화형(print) 흐름에서 더 자주 멈출 수 있음 — 검토형의 의도된
     트레이드오프이며 페르소나/문서로 명시한다.

### Decision

**Alternative 3.** `careful-reviewer`는 페르소나 + 메커니즘 SET을 함께 한다. 페르소나는 가볍게(읽기/분석
먼저 → 변경 전 계획 제시 → 확인 대기, 근거·트레이드오프 설명, 보수적 범위)로 구성하고, **동시에**
framework/executor seam을 ask-first로 켜는 필드를 설정한다(아래 매핑 표). 식별자는
generic(`careful-reviewer`, 벤더 토큰 없음). 트레이드오프: 매번 묻는 ask-on-write 포스처로 인해 자율
실행 속도를 포기하는 대신, 검토 가능성·승인 게이트·관찰 가능한 ask-first 행동 차이를 얻는다 —
`autonomous-builder`(act-first)의 정확한 대조군이 된다.

#### 검토형 작동원리 → 본 프리셋의 구체 설정 매핑 (설계 §6.1 참조)

| 검토형 작동원리                        | 본 프리셋의 구체 설정                                                                  | 재현 수단 / 소유 레이어                    |
| -------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------ |
| write/exec마다 묻기 (ask-first 자율성) | `autonomy: 'ask-first'` → 권한 포스처(ask-on-write defaultPermissionMode/보수적 trust) | (c) PRESET-004 권한 집행                   |
| 변경 전 자기검토·검증 루프             | `selfVerification: true`                                                               | (e) framework/executor verifier 루프       |
| 집중 분석(fan-out 아님)                | `enableParallelSubagents: false`                                                       | (d) agent-executor/subagent-runner(미활성) |
| 철저한 분석을 위한 깊은 effort         | `effort: 'high'`                                                                       | (a) provider/core 호출, 배선=PRESET-008    |
| 읽기/분석 먼저 → 계획 제시 → 확인 대기 | `appendSystemPrompt`: ask-before-write / plan-first 가이드(변경 전 계획 제시 후 대기)  | (b) 페르소나, framework 합성               |
| 근거·트레이드오프 설명(보수적 범위)    | `appendSystemPrompt`: 변경 이유와 대안 트레이드오프 설명, 요청 범위 내 보수적 변경     | (b) 페르소나                               |
| 진행 보고 시 도구결과 대조             | `appendSystemPrompt`: 진행/완료 주장은 도구 실행 결과에 근거해 보고                    | (b) 페르소나                               |
| 과지시 스캐폴딩 제거                   | 아래 LIGHT-PRESET AUTHORING CONSTRAINT 준수                                            | (b) 프리셋 저자 규칙                       |

> effort=high 선택 근거: 검토형은 변경 전 코드/맥락을 철저히 읽고 영향과 트레이드오프를 분석하는
> 프로파일이라 깊은 effort가 작동원리에 부합한다. (장기 자율 실행이 아니므로 `xhigh`/`max`까지는 두지
> 않는다.) medium으로 낮추는 것도 가능하나, 본 결정은 "철저한 분석"을 우선해 high로 SET 한다.

#### LIGHT-PRESET AUTHORING CONSTRAINT

페르소나는 **가벼워야** 한다:

- "CRITICAL" / "MUST" 류 강조어를 쌓아 지시를 누적하지 않는다(과지시 스캐폴딩 금지).
- 모델에게 **raw reasoning을 드러내거나 echo 하라고 지시하지 않는다**("추론을 보여줘"/"show your
  reasoning"). reasoning_extraction 거부를 유발할 위험이 있다.
- 소수의 지향 특성 + 안내 역할 + 근거 있는 원칙으로 정의한다(Claude's Character §2.2).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-preset(정의/등록/SPEC), 메커니즘은 PRESET-002/003/004 소유
- [x] Sibling scan 완료 — `default`(PRESET-001) + `autonomous-builder`(PRESET-005) 프리셋 형태 확인 후 동일 `IPreset` 형태로 작성, act-first 대조군으로 설계
- [x] 대안 최소 2개 검토 완료 — 3개 검토(페르소나 전용 / 메커니즘 전용 / 페르소나+메커니즘)
- [x] 결정 근거 문서화 완료 — ask-first 포스처 트레이드오프 + generic 식별자 + 메커니즘 SET 근거 기록

## Solution

1. `careful-reviewer.ts`에 `IPreset` 정의:
   - **정체성**: `id: 'careful-reviewer'`(generic, 벤더 토큰 없음), `title`, `description`(읽기 중심·ask-first 요약)
   - **자율 메커니즘**: `autonomy: 'ask-first'` → PRESET-004가 권한 포스처(ask-on-write `defaultPermissionMode` + 보수적 `defaultTrustLevel`)로 매핑
   - **실행 능력 메커니즘**: `selfVerification: true`, `enableParallelSubagents: false`(집중·fan-out 아님)
   - **모델/effort 메커니즘**: `effort: 'high'`(철저한 분석 — 위 근거 주석)
   - **페르소나**(`appendSystemPrompt`, 가볍게): 읽기/분석 먼저 → 변경 전 계획 제시 후 확인 대기(ask-before-write/plan-first) · 변경 이유와 트레이드오프 설명 · 요청 범위 내 보수적 변경 · 진행/완료 주장은 도구 결과에 근거. "CRITICAL"/"MUST" 누적 금지, "show your reasoning" 류 지시 금지.
2. 레지스트리(`PRESETS`)에 등록 → `listPresets()`에 노출.
3. SPEC.md 카탈로그에 항목 추가(매핑 표 + ask-first 트레이드오프 반영).

## Affected Files

- `packages/agent-preset/src/presets/careful-reviewer.ts` (NEW)
- `packages/agent-preset/src/resolve-preset.ts`
- `packages/agent-preset/docs/SPEC.md`

## Completion Criteria

- [ ] TC-01: `resolvePreset('careful-reviewer', base)` 결과가 `autonomy === 'ask-first'`임을 단언하는 단위 테스트 통과
- [ ] TC-02: `resolvePreset('careful-reviewer', base)` 결과가 `selfVerification === true`임을 단언하는 단위 테스트 통과
- [ ] TC-03: `resolvePreset('careful-reviewer', base)` 결과가 `enableParallelSubagents === false`임을 단언하는 단위 테스트 통과
- [ ] TC-04: `resolvePreset('careful-reviewer', base)` 결과의 `effort`가 SET됨(`['low','medium','high','xhigh','max']` 중 하나, undefined 아님)을 단언하는 단위 테스트 통과
- [ ] TC-05: `resolvePreset('careful-reviewer', base)` 결과의 `appendSystemPrompt`가 ask-before-write/변경 전 계획-우선 어구와 변경-전-대기 어구를 둘 다 포함함을 단언하는 단위 테스트 통과
- [ ] TC-06: `careful-reviewer.ts`에 대해 `rg -i "show your reasoning|reveal your reasoning|CRITICAL|MUST"` 결과가 0건임(페르소나가 raw reasoning echo 지시와 "CRITICAL"/"MUST" 누적을 포함하지 않음)을 단언하는 커맨드폼 테스트 통과
- [ ] TC-07: `rg -nE "\bid:\s*['\"]" packages/agent-preset/src/presets/careful-reviewer.ts` 의 식별자 라인에 벤더 토큰(`fable`/`hermes`/`claude`/`anthropic`)이 없음을 단언하는 커맨드폼 테스트 통과
- [ ] TC-08: `listPresets()`에 `id === 'careful-reviewer'`(title/description 비어있지 않음) 항목 존재 단언 테스트 통과
- [ ] TC-09: `robota --preset careful-reviewer -p "ping"` → exit 0 (PRESET-002 경로로 정상 해석)
- [ ] TC-10: `pnpm --filter @robota-sdk/agent-preset test` + `build` → exit 0

## Test Plan

Type BEHAVIOR + tags cli → 프리셋 resolve 메커니즘 단언(autonomy/자기검증/병렬 비활성/effort) + 페르소나
어구 단언 + grep 부재/식별자 검사 + 프로세스 스모크.

| TC-ID | Test Type              | Tool / Approach                                                   | Notes    |
| ----- | ---------------------- | ----------------------------------------------------------------- | -------- |
| TC-01 | RULE (unit)            | vitest — resolvePreset autonomy === 'ask-first' 단언              |          |
| TC-02 | RULE (unit)            | vitest — resolvePreset selfVerification === true 단언             |          |
| TC-03 | RULE (unit)            | vitest — resolvePreset enableParallelSubagents === false 단언     |          |
| TC-04 | RULE (unit)            | vitest — resolvePreset effort SET(undefined 아님) 단언            |          |
| TC-05 | RULE (unit)            | vitest — appendSystemPrompt ask-before-write+plan-first 어구 단언 |          |
| TC-06 | CI pipeline smoke test | `rg -i` reasoning-echo/CRITICAL/MUST 부재 단언                    | 커맨드폼 |
| TC-07 | CI pipeline smoke test | `rg -nE` id 라인 벤더 토큰 부재 단언                              | 커맨드폼 |
| TC-08 | RULE (unit)            | vitest — listPresets 항목 단언                                    |          |
| TC-09 | FLOW (cli)             | 프로세스 spawn 종료코드                                           | 커맨드폼 |
| TC-10 | CI pipeline smoke test | `pnpm test` + `build` exit code                                   | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — careful-reviewer vs default 대조(쓰기 작업):** 전제: PRESET-001(done)~004 완료 +
  프로바이더 설정. 실행: 동일한 쓰기 유발 프롬프트(예: "이 파일에 함수 하나를 추가해줘")를
  `robota -p "..."`(default)와 `robota --preset careful-reviewer -p "..."`로 각각 실행. 기대:
  careful-reviewer 쪽은 곧바로 파일을 쓰지 않고 **먼저 읽기/분석 후 변경 계획을 제시하고 확인을
  기다리거나**(plan-first) write/exec 시점에 **묻는**(ask-on-write) 관찰 가능한 차이를 보인다 — default는
  더 직접적으로 진행. 정리: 변경/생성 파일 되돌리기. Evidence: 두 실행의 출력/행동(ask 여부·계획 제시
  여부) 비교 캡처(구현 후 기록).

환경: PRESET-002 선행, PRESET-004(autonomy→권한 포스처 매핑) 필요, 실제 프로바이더 키 필요(로컬 설정 사용).

## Tasks

- [ ] `.agents/tasks/PRESET-009.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready

- Frontmatter: begins with `---`; `status: draft`; `type: BEHAVIOR` (valid 11-prefix value); `tags: [cli]` present.
- Problem: concrete symptom (`rg -l "careful-reviewer" packages/` = 0건; `robota --preset careful-reviewer` → "알 수 없는 preset" 오류) + reproduction condition (`listPresets()`에 ask-first 프리셋 부재); no TBD/TODO/vague single-sentence.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (default + autonomous-builder confirmed); Alternatives Considered = 3 entries each with Pro/Con; Decision references trade-off (ask-on-write posture vs autonomous speed, generic identifier).
- Completion Criteria: 10 items all TC-N prefixed (TC-01…TC-10); each in command/observable form; no banned phrases ("works correctly"/"no errors"/"implemented"/"displays correctly").
- Test Plan: present; 10 rows (TC-01…TC-10) match 10 Completion Criteria — count matches; each row has non-empty Test Type + Tool/Approach, no "TBD"; no row uses "manual" tool (N/A for manual-Notes justification; command-form rows carry Notes).
- Structure: Tasks section present with placeholder; Evidence Log present and empty before this run; no `## Status` or `## Classification` body sections.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved

- Prior-gate precondition: `### [GATE-WRITE] — ✅ PASS | 2026-06-14` present in Evidence Log; frontmatter `status: review-ready`; file resides in `backlog/` — prior gate confirmed, in order.
- Explicit approval: orchestrator asked "다르게 튜닝된 추가 프리셋(careful-reviewer, neutral-executor)을 지금 백로그로 구체화할까요?" and the user selected/replied verbatim "지금 백로그 생성 (PRESET-009/010)" — unambiguous authorization to create and advance these backlogs.
- Directed at this spec: approval names PRESET-009 explicitly (and its sibling PRESET-010); careful-reviewer is one of the two named presets — approval targets this document.
- No post-approval modification: Architecture Review section + frontmatter `type: BEHAVIOR` / `tags: [cli]` unchanged after approval.
- NON-COMPLIANCE trigger check: no `.agents/tasks/PRESET-009.md` and no `packages/agent-preset/src/presets/careful-reviewer.ts` — implementation not started.
