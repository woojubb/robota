---
status: approved
type: BEHAVIOR
tags: [cli]
---

# PRESET-005: 첫 프리셋 autonomous-builder (reference profile 작업 스타일 모방)

## Problem

프리셋 인프라(PRESET-001~004, 008)가 갖춰져도 **출하되는 의견 있는(opinionated) 프리셋이 하나도
없으면** 기능이 무의미하다. 사용자가 요청한 첫 프리셋은 "reference profile 스타일"이다. 그러나 리서치 결과
Anthropic은 reference profile의 시스템 프롬프트나 성격 명세를 공개한 적이 없으므로(설계 제안서 §2.1)
"프롬프트 복제"는 불가능하다. 대신 **문서화된 작업 스타일**(능동·철저·자기검증·고자율·요청 범위 확장
경향)과 Anthropic "Claude's Character" 원칙을 재현한 generic 프리셋을 만든다. 식별자에는 벤더명을
쓸 수 없다(`feedback_no_product_names`, `naming-style.md`).

이 프리셋은 **페르소나 텍스트뿐 아니라 실제 메커니즘 설정**이어야 한다(설계 §6.1). 즉
`autonomous-builder`는 agent-preset의 빌트인 콘텐츠로서 framework/executor 메커니즘을 **구성(CONFIGURE)**
한다 — agent-cli에 로직을 추가하지 않는다. 페르소나만으로 "스타일"을 흉내 내는 것은 본 백로그의
완료 조건이 아니다.

**선행 의존성:** PRESET-002(`--preset` 선택 배선) · PRESET-003(페르소나/시스템 프롬프트 합성) ·
PRESET-004(모듈/권한 번들 + 실행 능력 활성) · PRESET-008(effort → 모델 호출 배선). 이들이 없으면
`effort`/`autonomy`/`enableParallelSubagents`/`selfVerification` 필드가 실제 호출까지 전달되지 못한다.

**재현 조건:** `listPresets()`에 `default` 외 의견 프리셋이 없다. `robota --preset autonomous-builder`
→ PRESET-002의 "알 수 없는 preset" 오류.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §2.1, §2.2, §5.1, §6, §6.1.

## Architecture Review

### Affected Scope

- `packages/agent-preset/src/presets/autonomous-builder.ts` (NEW — 프리셋 정의)
- `packages/agent-preset/src/resolve-preset.ts` — 레지스트리에 등록
- `packages/agent-preset/docs/SPEC.md` — 프리셋 카탈로그 항목 추가
- 소비(선행 백로그가 제공): PRESET-001 `IPreset` 계약, PRESET-002 `--preset` 선택 배선, PRESET-003
  페르소나 합성, PRESET-004 모듈/권한 번들 + 실행 능력 활성, PRESET-008 effort 배선

### Alternatives Considered

1. **공개되지 않은 "reference profile 시스템 프롬프트"를 추측해 재현.**
   - Pro: 사용자의 "reference profile 모방" 요청에 표면적으로 충실.
   - Con: 1차 출처가 없어 날조가 됨 — 정직성 위반, 검증 불가. Rejected.
2. **페르소나 텍스트만으로 스타일을 흉내 내고 메커니즘은 손대지 않음.**
   - Pro: agent-preset 한 파일만 추가하면 됨, 선행 의존성 최소.
   - Con: effort/autonomy/병렬 서브에이전트/자기검증이 실제 호출에 전달되지 않아 "스타일"이
     관찰 가능한 동작 차이로 이어지지 않음 — 설계 §6.1(작동원리→메커니즘) 위반. Rejected.
3. **문서화된 reference profile 작업 스타일 + Claude's Character 원칙으로 페르소나를 구성하고, 동시에
   framework/executor 메커니즘(effort/autonomy→권한 포스처/병렬 서브에이전트/자기검증)을 SET 하는
   generic 프리셋.**
   - Pro: 검증 가능한 출처 기반; 규칙(벤더명 금지) 준수; 실제 행동 차이(고자율·자기검증·병렬)를
     메커니즘으로 구현; 설계 §6.1 추적 매트릭스 충족.
   - Con: "reference profile와 똑같은 프롬프트"는 아님(애초에 공개 안 됨) — 사용자에게 이 한계를 명시해야 함.

### Decision

**Alternative 3.** `autonomous-builder`는 페르소나 + 메커니즘 SET을 함께 한다. 페르소나는 문서화된
작업 스타일(능동·철저·자기검증·고자율, 병렬 서브에이전트 적극) + Claude's Character 원칙(비아첨적
정직·원칙 기반)으로 구성하고, **동시에** framework/executor seam을 켜는 필드를 설정한다(아래 매핑
표). 식별자는 generic(`autonomous-builder`), description에 "reference profile 작업 스타일에서 영감" 출처 각주만
허용(사용자 확인). 트레이드오프: "동일 프롬프트 복제"를 포기(불가능)하고 검증 가능·규칙 준수·
메커니즘으로 뒷받침되는 실제 행동 차이를 얻는다.

#### reference profile 작동원리 → 본 프리셋의 구체 설정 매핑 (설계 §6.1 참조)

| reference profile 작동원리 (#)                        | 본 프리셋의 구체 설정                                                                      | 재현 수단 / 소유 레이어                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| effort 다이얼, 기본 high (#3)               | `effort: 'high'` (장기작업 시 `'xhigh'`/'ultra' 옵션)                                      | (a) provider/core 호출, 배선=PRESET-008             |
| 묻지 않고 실행·고자율 (#5·#6)               | `autonomy: 'act-first'` → 권한 포스처(defaultPermissionMode/trust)로 매핑                  | (c) PRESET-004 권한 집행                            |
| 병렬 서브에이전트 적극 디스패치 (#8)        | `enableParallelSubagents: true`                                                            | (d) agent-executor/subagent-runner, PRESET-004 활성 |
| 자기검증(작업 후 검증 루프) (#4)            | `selfVerification: true`                                                                   | (e) framework/executor verifier 루프                |
| 능동성 + 범위 확장(과확장 억제 포함) (#7)   | `appendSystemPrompt`: 능동적이되 **요청 범위를 넘는 과도한 리팩터 금지**(scope-constraint) | (b) 페르소나, framework 합성                        |
| 출력 스타일(결과 우선·작업 약어 금지) (#12) | `appendSystemPrompt`: outcome-first, "작업 중…" 류 약어 없이 결과 보고                     | (b) 페르소나                                        |
| 진행 보고 시 도구결과 대조 (#13)            | `appendSystemPrompt`: 진행/완료 주장은 **도구 실행 결과에 근거**해 보고                    | (b) 페르소나                                        |
| 과지시 스캐폴딩 제거 (#17)                  | 아래 LIGHT-PRESET AUTHORING CONSTRAINT 준수                                                | (b) 프리셋 저자 규칙                                |

#### LIGHT-PRESET AUTHORING CONSTRAINT (reference profile 원리 #17)

페르소나는 **가벼워야** 한다:

- "CRITICAL" / "MUST" 류 강조어를 쌓아 지시를 누적하지 않는다(과지시 스캐폴딩 금지).
- 모델에게 **raw reasoning을 드러내거나 echo 하라고 지시하지 않는다**("추론을 보여줘"/"show your
  reasoning"). reference 계열의 `reasoning_extraction` 거부를 유발할 위험이 있다.
- 소수의 지향 특성 + 안내 역할 + 근거 있는 원칙으로 정의한다(Claude's Character §2.2).

#### 정직성 노트 — 프리셋이 만들 수 없는 모델 고유 속성

다음은 **모델 고유**라 어떤 프리셋도 제조할 수 없다. 본 프리셋은 `model`을 핀(PIN)할 뿐, 다른 모델
위에서 이 속성들을 만들어 내지 못한다(설계 §6.1, 항목 1·2·9·11·16):

- 상시(always-on) adaptive thinking — 비활성화 불가, 프리셋이 켜는 것이 아님
- raw chain-of-thought 비공개(CoT privacy)
- 1M 컨텍스트 / 트레이닝된 검색
- 트레이닝된 도구 신뢰성
- 플랫폼 safety classifier

→ 프리셋은 effort·권한 포스처·병렬 서브에이전트 활성·자기검증 루프·페르소나만 구성한다. 위 속성은
정직하게 "재현 불가 — 모델 핀만 가능"으로 표기한다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-preset(정의/등록/SPEC), 메커니즘은 PRESET-002/003/004/008이 소유
- [x] Sibling scan 완료 — `default` 프리셋 형태(PRESET-001) 확인 후 동일 `IPreset` 형태로 작성
- [x] 대안 최소 2개 검토 완료 — 3개 검토(추측 복제 / 페르소나 전용 / 페르소나+메커니즘)
- [x] 결정 근거 문서화 완료 — 정직성 경계 + generic 식별자 + 메커니즘 SET 근거 기록

## Solution

1. `autonomous-builder.ts`에 `IPreset` 정의:
   - **정체성**: `id: 'autonomous-builder'`(generic, 벤더 토큰 없음), `title`, `description`(출처 각주 포함)
   - **모델/effort 메커니즘**: `model` 핀, `effort: 'high'`(장기작업 시 `'xhigh'`/'ultra' 사용 가능 — 주석으로 명시)
   - **자율 메커니즘**: `autonomy: 'act-first'` → PRESET-004가 권한 포스처(defaultPermissionMode/trust)로 매핑
   - **실행 능력 메커니즘**: `enableParallelSubagents: true`, `selfVerification: true`
   - **페르소나**(`appendSystemPrompt`, 가볍게): 능동성 + scope-constraint(과확장 금지) · outcome-first
     출력 스타일(작업 약어 금지) · 진행/완료 주장은 도구 결과에 근거. "CRITICAL"/"MUST" 누적 금지,
     "show your reasoning" 류 지시 금지.
2. 레지스트리에 등록 → `listPresets()`에 노출.
3. SPEC.md 카탈로그에 항목 추가(정직성 노트 + 매핑 표 반영).

## Affected Files

- `packages/agent-preset/src/presets/autonomous-builder.ts` (NEW)
- `packages/agent-preset/src/resolve-preset.ts`
- `packages/agent-preset/docs/SPEC.md`

## Completion Criteria

- [ ] TC-01: `resolvePreset('autonomous-builder', base)` 결과가 `effort === 'high'`임을 단언하는 단위 테스트 통과
- [ ] TC-02: `resolvePreset('autonomous-builder', base)` 결과가 `autonomy === 'act-first'`임을 단언하는 단위 테스트 통과
- [ ] TC-03: `resolvePreset('autonomous-builder', base)` 결과가 `enableParallelSubagents === true`임을 단언하는 단위 테스트 통과
- [ ] TC-04: `resolvePreset('autonomous-builder', base)` 결과가 `selfVerification === true`임을 단언하는 단위 테스트 통과
- [ ] TC-05: `resolvePreset('autonomous-builder', base)` 결과의 `appendSystemPrompt`가 scope-constraint 어구(과확장/과도한 리팩터 억제)와 진행-보고 그라운딩 어구(도구 결과 대조)를 둘 다 포함함을 단언하는 단위 테스트 통과
- [ ] TC-06: `autonomous-builder.ts`에 대해 `rg -i "show your reasoning|reveal your reasoning|CRITICAL|MUST"` 결과가 0건임(페르소나가 raw reasoning echo 지시와 "CRITICAL"/"MUST" 누적을 포함하지 않음)을 단언하는 커맨드폼 테스트 통과
- [ ] TC-07: `rg -nE "\bid:\s*['\"]" packages/agent-preset/src/presets/autonomous-builder.ts` 의 식별자 라인에 벤더 토큰(`reference`/`hermes`/`claude`/`anthropic`)이 없음을 단언하는 커맨드폼 테스트 통과(있다면 description 각주 한정)
- [ ] TC-08: `listPresets()`에 `id === 'autonomous-builder'`(title/description 비어있지 않음) 항목 존재 단언 테스트 통과
- [ ] TC-09: `robota --preset autonomous-builder -p "ping"` → exit 0 (PRESET-002 경로로 정상 해석)
- [ ] TC-10: `pnpm --filter @robota-sdk/agent-preset test` + `build` → exit 0

## Test Plan

Type BEHAVIOR + tags cli → 프리셋 resolve 메커니즘 단언(effort/autonomy/병렬/자기검증) + 페르소나
어구 단언 + grep 부재/식별자 검사 + 프로세스 스모크.

| TC-ID | Test Type              | Tool / Approach                                                 | Notes    |
| ----- | ---------------------- | --------------------------------------------------------------- | -------- |
| TC-01 | RULE (unit)            | vitest — resolvePreset effort === 'high' 단언                   |          |
| TC-02 | RULE (unit)            | vitest — resolvePreset autonomy === 'act-first' 단언            |          |
| TC-03 | RULE (unit)            | vitest — resolvePreset enableParallelSubagents 단언             |          |
| TC-04 | RULE (unit)            | vitest — resolvePreset selfVerification 단언                    |          |
| TC-05 | RULE (unit)            | vitest — appendSystemPrompt scope-constraint+그라운딩 어구 단언 |          |
| TC-06 | CI pipeline smoke test | `rg -i` reasoning-echo/CRITICAL/MUST 부재 단언                  | 커맨드폼 |
| TC-07 | CI pipeline smoke test | `rg -nE` id 라인 벤더 토큰 부재 단언                            | 커맨드폼 |
| TC-08 | RULE (unit)            | vitest — listPresets 항목 단언                                  |          |
| TC-09 | FLOW (cli)             | 프로세스 spawn 종료코드                                         | 커맨드폼 |
| TC-10 | CI pipeline smoke test | `pnpm test` + `build` exit code                                 | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — autonomous-builder 체감:** 전제: PRESET-001~004 + 008 완료 + 프로바이더 설정.
  실행: 동일 작업 프롬프트(예: "이 함수의 버그를 고쳐줘")를 `robota -p "..."`(default)와
  `robota --preset autonomous-builder -p "..."`로 각각 실행. 기대: autonomous-builder 쪽이 더 능동적
  (자기검증·인접 이슈 처리·범위 확장하되 과확장 없음, 병렬 서브에이전트 활용)으로 동작하는 관찰
  가능한 차이. 정리: 변경 파일 되돌리기. Evidence: 두 실행의 출력/행동 비교 캡처(구현 후 기록).

환경: PRESET-002 선행, effort 배선(PRESET-008) 필요, 실제 프로바이더 키 필요(로컬 설정 사용).

## Tasks

- [ ] `.agents/tasks/PRESET-005.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: BEHAVIOR` (valid 11-prefix value); `tags: [cli]` present.
- Problem: concrete symptom (`robota --preset autonomous-builder` → PRESET-002 "알 수 없는 preset" error) + reproduction (`listPresets()` has no opinionated preset besides `default`); no TBD/TODO/vague descriptions.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (default/`IPreset` shape checked); Alternatives Considered = 3 entries each with Pro/Con; Decision references trade-off (drops "identical prompt replication" for verifiable, rule-compliant, mechanism-backed behavior).
- Completion Criteria: TC-01 through TC-10 all TC-N prefixed; each uses command or observable-behavior form; no banned phrases ("works correctly"/"no errors"/"implemented"/"displays correctly").
- Test Plan: `## Test Plan` present; 10 rows (TC-01..TC-10) — count matches 10 Completion Criteria; each row has non-empty Test Type and Tool/Approach; no row uses "manual" Tool (vitest/`rg`/spawn — no manual-justification gap).
- Structure: Tasks section present with placeholder; Evidence Log present and empty before this run; no `## Status` or `## Classification` body sections (status/type live in frontmatter).
- TC-N count match confirmed: Completion Criteria = 10, Test Plan = 10.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved

- Prior-gate precondition: `### [GATE-WRITE] — ✅ PASS | 2026-06-14` present in Evidence Log; frontmatter `status: review-ready`; file in `backlog/` folder — matches expected input stage.
- Explicit approval: orchestrator asked "8개를 GATE-APPROVAL까지 올릴까요?" and the user replied verbatim "다음 진행해" — an unambiguous statement authorizing advancement of all 8 PRESET specs to `approved`.
- Directed at this spec: PRESET-005 is one of the 8 PRESET specs covered by the approval scope.
- No Architecture Review or frontmatter type/tags modified after approval: Architecture Review section and frontmatter (`type: BEHAVIOR`, `tags: [cli]`) unchanged.
- NON-COMPLIANCE trigger not fired: no `.agents/tasks/PRESET-005.md` and no `packages/agent-preset/` exist — implementation has not started.
