---
status: draft
type: BEHAVIOR
tags: [cli]
---

# PRESET-004: 번들 — 명령 모듈 선택 + 권한/신뢰 포스처 + 실행 능력(병렬 서브에이전트·자기검증) per preset

## Problem

풀 번들 프리셋(사용자 확인)은 페르소나·모델뿐 아니라 **명령 모듈 구성**, **권한/신뢰 포스처**,
그리고 **실행 능력(병렬 서브에이전트·자기검증)**까지 프리셋마다 다르게 묶어야 진짜 "개성"이 드러난다.
그러나 (1) 명령 모듈 목록은 `packages/agent-command/src/default/default-command-modules.ts:31-61`에 20개가
**하드코딩**되어 조건부 선택이 불가능하고, (2) 프리셋의 `autonomy`(ask-first/balanced/act-first)를 기본 권한
모드/신뢰 수준으로 변환하는 경로가 없으며, (3) `IPreset.enableParallelSubagents`/`selfVerification`를 프레임워크
실행 능력(`enableAgentRuntime`·서브에이전트/백그라운드 디스패치·자기검증 루프)에 연결하는 배선이 없다.

**재현 조건:**

- `createDefaultCommandModules`는 인자에 무관하게 항상 20개 모듈을 같은 순서로 반환한다
  (`default-command-modules.ts:31-61`). 프리셋 기반 enable/disable 분기 없음.
- `IPreset.autonomy`를 `defaultPermissionMode`/`defaultTrustLevel`로 매핑하는 resolve 단계가 없어, 프리셋이
  권한 포스처를 집행하지 못한다.
- `IPreset.enableParallelSubagents`/`selfVerification`가 조립 시 프레임워크 옵션으로 흘러가는 경로가 없어,
  agent-runtime/서브에이전트 디스패치·자기검증이 프리셋으로 켜지지 않는다.

**레이어 불변식:** 기능/동작원리는 `agent-command`(모듈 선택 델타)·`agent-framework`(권한 포스처 적용·실행 능력
배선)·`agent-executor`(서브에이전트/백그라운드/자기검증 실행 능력)가 소유한다. `agent-cli`는 resolve된 옵션을
**그대로 전달하는 껍데기**일 뿐 이 로직을 소유하지 않는다.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §5(레이어 표), §5.1(IPreset — enableParallelSubagents·selfVerification·autonomy), §6.1(매트릭스 #4·#5·#6·#8).

## Architecture Review

### Affected Scope

**로직 소유 레이어 (기능/동작원리):**

- `packages/agent-command/src/default/default-command-modules.ts` — 모듈 선택 델타 로직 소유
  (enable 화이트리스트 / disable 블랙리스트, deny > allow), 기본(프리셋 미지정)은 현재 20개 그대로
- `packages/agent-framework` — 권한 포스처 적용(autonomy → `defaultPermissionMode`/`defaultTrustLevel` 매핑·기존
  `permissionMode`/`defaultTrustLevel` seam 재사용) + 실행 능력 배선(`enableParallelSubagents` → `enableAgentRuntime`·
  서브에이전트/백그라운드 디스패치 활성, `selfVerification` 플래그 스레딩)
- `packages/agent-executor` — 서브에이전트/백그라운드 디스패치·자기검증 루프 실행 능력(프레임워크가 활성화하는 대상)

**껍데기(전달만):**

- `packages/agent-cli/src/startup/command-setup.ts` — resolve된 프리셋 옵션(모듈 선택·권한 포스처·실행 능력 플래그)을
  기존 조립 진입점으로 **그대로 전달**(로직 미소유)

**소비 계약:** PRESET-001 `IPreset.enabledCommandModules`/`disabledCommandModules`/`defaultPermissionMode`/
`defaultTrustLevel`/`allowedTools`/`deniedTools`/`autonomy`/`enableParallelSubagents`/`selfVerification`

### Alternatives Considered

1. **모듈 목록을 프리셋이 통째로 제공(전체 배열 전달) + 권한/실행 능력을 agent-cli가 직접 분기.**
   - Pro: 최대 유연; cli 한 곳에서 조합.
   - Con: 프리셋마다 20개 목록을 중복 나열 — 표류·중복; 기본셋 변경 시 모든 프리셋 갱신 필요. 더 중요하게,
     권한 포스처·실행 능력 분기를 cli(껍데기)가 소유하게 되어 레이어 불변식 위반. Rejected.
2. **기본셋 + enable/disable 델타(deny > allow) + autonomy→권한 포스처 매핑·실행 능력 배선을 적정 레이어가 소유.**
   - Pro: 프리셋은 차이(델타)만 선언; 기본셋이 SSOT로 유지; 무회귀(미지정 시 전체); 권한/실행 로직은
     agent-framework/agent-executor가 소유하고 cli는 전달만 → 레이어 불변식 준수.
   - Con: autonomy→권한 매핑 표와 enable/disable 우선순위 규칙(deny > allow)을 명시해야 한다.

### Decision

**Alternative 2.** (a) `createDefaultCommandModules`를 델타 기반 조건부 선택으로 확장한다(기본 = 현재 20개,
프리셋이 `enabled`/`disabled`로 차이만 선언, deny > allow). (b) `autonomy`를 권한 포스처로 매핑한다:
`act-first` → 더 자율적인 기본 권한 모드(쓰기에 매번 묻지 않음) + 더 높은 신뢰, `ask-first` → 쓰기마다 묻는
모드(ask-on-write) + 보수적 신뢰, `balanced` → 중간. 매핑 결과는 기존 `permissionMode`/`defaultTrustLevel`
seam을 채운다(신규 권한 엔진 만들지 않음). (c) `enableParallelSubagents` → 프레임워크 `enableAgentRuntime` +
서브에이전트/백그라운드 디스패치 활성, `selfVerification` → 프레임워크/executor 자기검증 플래그로 스레딩한다.
트레이드오프: 매핑·우선순위 명시 비용을 감수하고 기본셋 SSOT 유지 + 무회귀 + 레이어 불변식 준수를 얻는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-command(모듈 선택 델타), agent-framework(권한 포스처 매핑·실행 능력 배선), agent-executor(서브에이전트/자기검증 실행 능력), agent-cli(전달 껍데기)
- [x] Sibling scan 완료 — 기존 `permissions`/`defaultTrustLevel`(SettingsSchema), `permissionMode`, `enableAgentRuntime` seam, `createDefaultCommandModules` 시그니처 확인 후 재사용
- [x] 대안 최소 2개 검토 완료 — 2개 검토(레이어 소유권 차이 포함)
- [x] 결정 근거 문서화 완료 — 델타 모델 + deny>allow + autonomy→권한 매핑 + 실행 능력 배선 + 무회귀 + 레이어 불변식 근거 기록

## Solution

1. **모듈 선택 델타 (agent-command):** `createDefaultCommandModules`에 선택 옵션 추가:
   `enabledCommandModules?`(화이트리스트), `disabledCommandModules?`(블랙리스트). 둘 다 미지정 시 현재 20개
   그대로(무회귀). 동시 지정 시 deny > allow.
2. **권한/신뢰 포스처 (agent-framework):** 프리셋 `autonomy`를 권한 포스처로 매핑한다 —
   `act-first` → 더 자율적인 기본 권한 모드(쓰기에 매번 묻지 않음) + 높은 신뢰, `ask-first` → ask-on-write 모드 +
   보수적 신뢰, `balanced` → 중간. 매핑 결과와 명시 `defaultPermissionMode`/`defaultTrustLevel`/`allowedTools`/
   `deniedTools`를 기존 권한 seam(`permissionMode`, settings의 `permissions`/`defaultTrustLevel`)에 주입한다.
   우선순위: 명시 필드 > autonomy 매핑 기본. 전체 우선순위: 명시/CLI > 프리셋 > settings 기본.
3. **실행 능력 배선 (agent-framework → agent-executor):** `IPreset.enableParallelSubagents === true`이면
   프레임워크 `enableAgentRuntime`를 활성화하고 서브에이전트/백그라운드 디스패치 능력을 켠다.
   `IPreset.selfVerification` 플래그를 프레임워크/executor 자기검증 옵션으로 스레딩한다.
4. **전달 (agent-cli 껍데기):** `command-setup.ts`는 resolve된 프리셋 옵션(모듈 선택·권한 포스처·실행 능력 플래그)을
   기존 조립 진입점으로 그대로 전달한다. cli는 매핑·집행·디스패치 로직을 소유하지 않는다.

## Affected Files

- `packages/agent-command/src/default/default-command-modules.ts` — 모듈 선택 델타
- `packages/agent-framework/src/config/config-types.ts` — 권한 포스처/실행 능력 옵션 주입 경로
- `packages/agent-framework/src/assembly/create-session.ts` — autonomy→권한 매핑 적용 + `enableAgentRuntime`/자기검증 배선
- `packages/agent-executor` — 서브에이전트/백그라운드 디스패치·자기검증 루프 실행 능력(프레임워크가 활성화)
- `packages/agent-cli/src/startup/command-setup.ts` — resolve된 옵션 전달(껍데기)

## Completion Criteria

- [ ] TC-01: `enabledCommandModules: ['help','agent']` 프리셋 적용 시 등록 모듈 집합이 정확히 그 2개임을 단언하는 통합 테스트 통과
- [ ] TC-02: `disabledCommandModules: ['background']` 프리셋 적용 시 해당 모듈이 등록 집합에서 제외됨을 단언하는 통합 테스트 통과
- [ ] TC-03: enable과 disable에 동일 모듈을 동시 지정 시 제외됨(deny > allow)을 단언하는 통합 테스트 통과
- [ ] TC-04: 프리셋 미지정(또는 default) 시 등록 모듈 수가 현재 기본셋과 동일(20개)임을 단언하는 통합 테스트 통과 — 무회귀
- [ ] TC-05: `defaultPermissionMode`를 가진 프리셋 적용 시(settings 미설정) 세션 권한 모드가 프리셋 값과 일치함을 단언하는 통합 테스트 통과
- [ ] TC-06: `autonomy: 'act-first'` 프리셋 적용 시(명시 `defaultPermissionMode` 없음) 해석된 세션 권한 모드가 쓰기에 매번 묻지 않는 자율 모드 값과 일치함을 단언하는 통합 테스트 통과
- [ ] TC-07: `autonomy: 'ask-first'` 프리셋 적용 시(명시 `defaultPermissionMode` 없음) 해석된 세션 권한 모드가 ask-on-write 값과 일치함을 단언하는 통합 테스트 통과
- [ ] TC-08: `enableParallelSubagents: true` 프리셋 적용 시 프레임워크에 전달되는 조립 옵션에서 `enableAgentRuntime`가 true이고 서브에이전트/백그라운드 디스패치 능력이 활성됨을 단언하는 통합 테스트 통과(배선 단언)
- [ ] TC-09: `selfVerification: true` 프리셋 적용 시 프레임워크/executor로 전달되는 자기검증 옵션 값이 true로 스레딩됨을 단언하는 통합 테스트 통과
- [ ] TC-10: `pnpm --filter @robota-sdk/agent-command --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-cli build` + `pnpm typecheck` → exit 0

## Test Plan

Type BEHAVIOR + tags cli → 등록 모듈 집합/권한 포스처/실행 능력 배선 통합 단언 테스트 + 빌드 스모크.

| TC-ID | Test Type              | Tool / Approach                                                    | Notes    |
| ----- | ---------------------- | ------------------------------------------------------------------ | -------- |
| TC-01 | BEHAVIOR               | 통합 테스트 — enable 화이트리스트 집합 단언                        |          |
| TC-02 | BEHAVIOR               | 통합 테스트 — disable 제외 단언                                    |          |
| TC-03 | BEHAVIOR               | 통합 테스트 — deny>allow 단언                                      |          |
| TC-04 | BEHAVIOR               | 통합 테스트 — 무회귀 모듈 수 단언                                  |          |
| TC-05 | BEHAVIOR               | 통합 테스트 — `defaultPermissionMode` 적용 단언                    |          |
| TC-06 | BEHAVIOR               | 통합 테스트 — autonomy=act-first → 자율 권한 모드 매핑 단언        |          |
| TC-07 | BEHAVIOR               | 통합 테스트 — autonomy=ask-first → ask-on-write 매핑 단언          |          |
| TC-08 | BEHAVIOR               | 통합 테스트 — `enableAgentRuntime`+서브에이전트 디스패치 배선 단언 |          |
| TC-09 | BEHAVIOR               | 통합 테스트 — `selfVerification` 옵션 스레딩 단언                  |          |
| TC-10 | CI pipeline smoke test | `pnpm build` + `pnpm typecheck` exit code                          | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 1 — 모듈 구성 차이:** 전제: PRESET-002 배선 + 모듈 델타를 가진 임시/실제 프리셋. 실행:
  `robota --preset <id>` 세션에서 `/help`로 사용 가능한 명령 목록 확인. 기대: 프리셋이 disable한 명령은
  목록에 없음. 정리: 없음. Evidence: `/help` 출력 캡처(구현 후 기록).
- **시나리오 2 — 권한 포스처(autonomy):** 전제: `autonomy: 'ask-first'` 프리셋과 `autonomy: 'act-first'`
  프리셋(명시 권한 모드 없음). 실행: 각 프리셋으로 세션 시작 후 쓰기/실행이 필요한 작업을 지시. 기대:
  ask-first는 쓰기 전 확인 프롬프트가 뜨고, act-first는 확인 없이 진행. 정리: 없음. Evidence: 두 세션의 권한
  프롬프트 유무 캡처(구현 후 기록).
- **시나리오 3 — 병렬 서브에이전트 활성:** 전제: `enableParallelSubagents: true` 프리셋. 실행: 해당 프리셋으로
  세션 시작 후 서브에이전트/백그라운드 디스패치가 필요한 작업을 지시. 기대: agent-runtime 경유 서브에이전트
  디스패치가 발생(런타임 활성). 정리: 백그라운드 태스크 종료 확인. Evidence: 서브에이전트 디스패치 로그/이벤트
  캡처(구현 후 기록).
- **시나리오 4 — 자기검증 활성:** 전제: `selfVerification: true` 프리셋. 실행: 해당 프리셋으로 세션 시작 후
  검증 가능한 산출물을 만드는 작업을 지시. 기대: 작업 종료 후 자기검증 단계가 실행됨. 정리: 없음. Evidence:
  자기검증 단계 실행 로그/이벤트 캡처(구현 후 기록).

환경: PRESET-002 선행.

## Tasks

- [ ] `.agents/tasks/PRESET-004.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready
Frontmatter: `---` block present; `status: draft`; `type: BEHAVIOR` (valid 11-prefix); `tags: [cli]` present — PASS.
Problem: concrete symptom (`default-command-modules.ts:31-61` hardcodes 20 modules, no preset branching) + reproduction conditions block (lines 18-25); no TBD/TODO/vague — PASS.
Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with reuse evidence (permissions/defaultTrustLevel/permissionMode/enableAgentRuntime/createDefaultCommandModules seams); 2 alternatives each with Pro/Con; Decision cites trade-off (mapping/priority cost vs. base-set SSOT + no-regression + layer invariant) — PASS.
Completion Criteria: TC-01..TC-10 all TC-N prefixed; covers each distinct feature (module delta, defaultPermissionMode, autonomy mapping act/ask, runtime+dispatch wiring, selfVerification, build); Command/Observable forms; no banned phrases — PASS.
Test Plan: section present; TC-N count matches (10 criteria ↔ 10 rows TC-01..TC-10); each row non-empty Test Type + Tool/Approach, no TBD; no row uses "manual" Tool so manual-Notes criterion N/A — PASS.
Structure: Tasks section with placeholder present; Evidence Log present and empty before this run; no `## Status`/`## Classification` body sections — PASS.
