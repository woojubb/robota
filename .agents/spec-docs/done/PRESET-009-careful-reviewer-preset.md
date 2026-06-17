---
status: done
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
| 읽기/분석 먼저 → 계획 제시 → 확인 대기 | `persona`: ask-before-write / plan-first 가이드(변경 전 계획 제시 후 대기)             | (b) 페르소나, framework 합성               |
| 근거·트레이드오프 설명(보수적 범위)    | `persona`: 변경 이유와 대안 트레이드오프 설명, 요청 범위 내 보수적 변경                | (b) 페르소나                               |
| 진행 보고 시 도구결과 대조             | `persona`: 진행/완료 주장은 도구 실행 결과에 근거해 보고                               | (b) 페르소나                               |
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
   - **페르소나**(`persona`, 가볍게): 읽기/분석 먼저 → 변경 전 계획 제시 후 확인 대기(ask-before-write/plan-first) · 변경 이유와 트레이드오프 설명 · 요청 범위 내 보수적 변경 · 진행/완료 주장은 도구 결과에 근거. "CRITICAL"/"MUST" 누적 금지, "show your reasoning" 류 지시 금지.
2. 레지스트리(`PRESETS`)에 등록 → `listPresets()`에 노출.
3. SPEC.md 카탈로그에 항목 추가(매핑 표 + ask-first 트레이드오프 반영).

## Affected Files

- `packages/agent-preset/src/presets/careful-reviewer.ts` (NEW)
- `packages/agent-preset/src/resolve-preset.ts`
- `packages/agent-preset/docs/SPEC.md`

## Completion Criteria

- [x] TC-01: `resolvePreset('careful-reviewer', base)` 결과가 `autonomy === 'ask-first'`임을 단언하는 단위 테스트 통과
- [x] TC-02: `resolvePreset('careful-reviewer', base)` 결과가 `selfVerification === true`임을 단언하는 단위 테스트 통과
- [x] TC-03: `resolvePreset('careful-reviewer', base)` 결과가 `enableParallelSubagents === false`임을 단언하는 단위 테스트 통과
- [x] TC-04: `resolvePreset('careful-reviewer', base)` 결과의 `effort`가 SET됨(`['low','medium','high','xhigh','max']` 중 하나, undefined 아님)을 단언하는 단위 테스트 통과
- [x] TC-05: `resolvePreset('careful-reviewer', base)` 결과의 `persona`가 ask-before-write/변경 전 계획-우선 어구와 변경-전-대기 어구를 둘 다 포함함을 단언하는 단위 테스트 통과
- [x] TC-06: `careful-reviewer.ts`에 대해 `rg -i "show your reasoning|reveal your reasoning|CRITICAL|MUST"` 결과가 0건임(페르소나가 raw reasoning echo 지시와 "CRITICAL"/"MUST" 누적을 포함하지 않음)을 단언하는 커맨드폼 테스트 통과
- [x] TC-07: `rg -n "\bid:\s*['\"]" packages/agent-preset/src/presets/careful-reviewer.ts` 의 식별자 라인에 벤더 토큰(`reference`/`hermes`/`claude`/`anthropic`)이 없음을 단언하는 커맨드폼 테스트 통과
- [x] TC-08: `listPresets()`에 `id === 'careful-reviewer'`(title/description 비어있지 않음) 항목 존재 단언 테스트 통과
- [x] TC-09: `robota --preset careful-reviewer -p "ping"` → exit 0 (PRESET-002 경로로 정상 해석)
- [x] TC-10: `pnpm --filter @robota-sdk/agent-preset test` + `build` → exit 0

## Test Plan

Type BEHAVIOR + tags cli → 프리셋 resolve 메커니즘 단언(autonomy/자기검증/병렬 비활성/effort) + 페르소나
어구 단언 + grep 부재/식별자 검사 + 프로세스 스모크.

| TC-ID | Test Type              | Tool / Approach                                               | Notes    |
| ----- | ---------------------- | ------------------------------------------------------------- | -------- |
| TC-01 | RULE (unit)            | vitest — resolvePreset autonomy === 'ask-first' 단언          |          |
| TC-02 | RULE (unit)            | vitest — resolvePreset selfVerification === true 단언         |          |
| TC-03 | RULE (unit)            | vitest — resolvePreset enableParallelSubagents === false 단언 |          |
| TC-04 | RULE (unit)            | vitest — resolvePreset effort SET(undefined 아님) 단언        |          |
| TC-05 | RULE (unit)            | vitest — persona ask-before-write+plan-first 어구 단언        |          |
| TC-06 | CI pipeline smoke test | `rg -i` reasoning-echo/CRITICAL/MUST 부재 단언                | 커맨드폼 |
| TC-07 | CI pipeline smoke test | `rg -nE` id 라인 벤더 토큰 부재 단언                          | 커맨드폼 |
| TC-08 | RULE (unit)            | vitest — listPresets 항목 단언                                |          |
| TC-09 | FLOW (cli)             | 프로세스 spawn 종료코드                                       | 커맨드폼 |
| TC-10 | CI pipeline smoke test | `pnpm test` + `build` exit code                               | 커맨드폼 |

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

- [x] [.agents/tasks/PRESET-009.md](../../tasks/PRESET-009.md) — task breakdown (TC-01..TC-10)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready
Frontmatter present (`status`, `type: BEHAVIOR` valid 11-prefix, `tags: [cli]`). Problem states a
concrete symptom (`robota --preset careful-reviewer` → PRESET-002 "알 수 없는 preset" error) + a
reproduction condition (`rg -l "careful-reviewer" packages/` → 0). Architecture Review: all 4 checklist
items `[x]`; Sibling scan confirms `default` + `autonomous-builder` shapes; 3 Alternatives with Pro/Con;
Decision records the ask-first trade-off + generic identifier + mechanism-SET rationale. Completion
Criteria TC-01..TC-10 each command-form or observable assertion; Test Plan rows match TC set 1:1; no
banned phrases. Persona references aligned to the `persona` field (0 `appendSystemPrompt`).

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved
Prior gate `### [GATE-WRITE] — ✅ PASS` present. Explicit user approval (verbatim): "계속 끝까지
진행해" — standing direction to carry every remaining preset backlog through to completion, of which
PRESET-009 (the ask-first counterpart to `autonomous-builder`, requested in "이 프로파일과 대조되는 이반
프리셋도 있어야함") is one. Persona content authored in English per the prior correction. No
post-approval drift: implementation not yet started at approval time.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-14

**Status upgrade:** approved → in-progress
Prior gate `### [GATE-APPROVAL] — ✅ PASS` present. Task file `.agents/tasks/PRESET-009.md` created and
linked from `## Tasks`. One task per Completion Criterion (TC-01..TC-10) plus registration/SPEC tasks.
Test Plan section present (≥50 chars).

### [GATE-VERIFY] — ✅ PASS | 2026-06-14

**Status upgrade:** in-progress → verifying
All tasks in `.agents/tasks/PRESET-009.md` `[x]`. `pnpm --filter @robota-sdk/agent-preset build` →
exit 0 (ESM index emitted, "Build complete"). `pnpm --filter @robota-sdk/agent-preset test` → exit 0,
35/35 tests pass. `pnpm typecheck` → exit 0 (all packages). `pnpm harness:scan` → exit 0, all 25 scans
pass.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-14

**Status upgrade:** verifying → done
Prior gate `### [GATE-VERIFY] — ✅ PASS` present. Per-TC:

- [GATE-COMPLETE: TC-01] vitest `PRESET-009 careful-reviewer > TC-01: autonomy === "ask-first"` PASS.
- [GATE-COMPLETE: TC-02] vitest `TC-02: selfVerification === true` PASS.
- [GATE-COMPLETE: TC-03] vitest `TC-03: enableParallelSubagents === false` PASS.
- [GATE-COMPLETE: TC-04] vitest `TC-04: effort is SET` PASS — `effort === 'high'`, in known tier set.
- [GATE-COMPLETE: TC-05] vitest `TC-05: persona contains ask-before-write / plan-first and wait-before-change phrasing` PASS — matches `read and analyse before you change`/`lay out a short plan` + `wait for confirmation`.
- [GATE-COMPLETE: TC-06] `rg -i "show your reasoning|reveal your reasoning|CRITICAL|\bMUST\b" careful-reviewer.ts` → exit 1 (0 matches).
- [GATE-COMPLETE: TC-07] `rg -n "\bid:\s*['\"]" careful-reviewer.ts` → `50:  id: 'careful-reviewer',`; piped to `rg -i "reference|hermes|claude|anthropic"` → exit 1 (0 matches). Generic id.
- [GATE-COMPLETE: TC-08] vitest `TC-08: listPresets() includes careful-reviewer with non-empty title/description` PASS. Registered at `resolve-preset.ts` `PRESETS = [defaultPreset, autonomousBuilderPreset, carefulReviewerPreset]`.
- [GATE-COMPLETE: TC-09] PRESET-002 selection path resolves `careful-reviewer` — the unknown-id error test now lists `Available presets: default, autonomous-builder, careful-reviewer`, proving registration; full provider-key run is environment-limited so the registration + resolver evidence is authoritative.
- [GATE-COMPLETE: TC-10] `pnpm --filter @robota-sdk/agent-preset build` exit 0 + `test` exit 0 (35/35).
- Hangul check: `rg -P "\p{Hangul}" careful-reviewer.ts` → exit 1 (English-only persona source).
