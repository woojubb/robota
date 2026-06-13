---
status: draft
type: BEHAVIOR
tags: [cli]
---

# PRESET-004: 번들 — 명령 모듈 선택 + 권한/신뢰 프로파일 per preset

## Problem

풀 번들 프리셋(사용자 확인)은 페르소나·모델뿐 아니라 **명령 모듈 구성**과 **권한/신뢰 프로파일**도
프리셋마다 다르게 묶어야 진짜 "개성"이 드러난다. 그러나 명령 모듈 목록은
`packages/agent-command/src/default/default-command-modules.ts:31-61`에 20개가 **하드코딩**되어 조건부
선택이 불가능하고, 프리셋이 기본 권한 모드/신뢰 수준을 지정할 경로도 없다.

**재현 조건:** `createDefaultCommandModules`는 인자에 무관하게 항상 20개 모듈을 같은 순서로 반환한다
(`default-command-modules.ts:31-61`). 프리셋 기반 enable/disable 분기 없음. `IPreset`에 권한 프로파일을
조립에 적용하는 경로 없음.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §2.4, §5.1.

## Architecture Review

### Affected Scope

- `packages/agent-command/src/default/default-command-modules.ts` — 조건부 선택 지원
  (enable 화이트리스트 / disable 블랙리스트), 기본(프리셋 미지정)은 현재 20개 그대로
- `packages/agent-cli/src/startup/command-setup.ts` — 프리셋 모듈 선택 + 권한 프로파일 주입
- `packages/agent-framework` — 기본 권한 모드/신뢰 수준 적용 경로(기존 `permissionMode`/`defaultTrustLevel` 재사용)
- 소비: PRESET-001 `IPreset.enabledCommandModules`/`disabledCommandModules`/`defaultPermissionMode`/`defaultTrustLevel`/`allowedTools`/`deniedTools`

### Alternatives Considered

1. **모듈 목록을 프리셋이 통째로 제공(전체 배열 전달).**
   - Pro: 최대 유연.
   - Con: 프리셋마다 20개 목록을 중복 나열 — 표류·중복; 기본셋 변경 시 모든 프리셋 갱신 필요. Rejected.
2. **기본셋 + enable 화이트리스트 / disable 블랙리스트(deny > allow) 델타 모델.**
   - Pro: 프리셋은 차이(델타)만 선언; 기본셋이 SSOT로 유지; 무회귀(미지정 시 전체).
   - Con: enable/disable 동시 지정 시 우선순위 규칙 명시 필요(deny > allow).

### Decision

**Alternative 2.** `createDefaultCommandModules`를 델타 기반 조건부 선택으로 확장한다(기본 = 현재 20개,
프리셋이 `enabled`/`disabled`로 차이만 선언, deny > allow). 권한/신뢰는 기존 `permissionMode`/
`defaultTrustLevel` seam을 프리셋 값으로 채운다(신규 권한 엔진 만들지 않음). 트레이드오프: 우선순위
규칙 명시 비용을 감수하고 기본셋 SSOT 유지 + 무회귀를 얻는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-command(모듈 선택), agent-cli(주입), agent-framework(권한 seam)
- [x] Sibling scan 완료 — 기존 `permissions`/`defaultTrustLevel`(SettingsSchema) 및 `createDefaultCommandModules` 시그니처 확인 후 재사용
- [x] 대안 최소 2개 검토 완료 — 2개 검토
- [x] 결정 근거 문서화 완료 — 델타 모델 + deny>allow + 무회귀 근거 기록

## Solution

1. `createDefaultCommandModules`에 선택 옵션 추가: `enabledCommandModules?`(화이트리스트),
   `disabledCommandModules?`(블랙리스트). 둘 다 미지정 시 현재 20개 그대로(무회귀). 동시 지정 시
   deny > allow.
2. `command-setup.ts`에서 resolve된 프리셋의 모듈 선택을 전달.
3. 프리셋 `defaultPermissionMode`/`defaultTrustLevel`/`allowedTools`/`deniedTools`를 기존 권한 seam
   (`permissionMode`, settings의 `permissions`/`defaultTrustLevel`)에 주입. 우선순위: 명시/CLI > 프리셋 > settings 기본.

## Affected Files

- `packages/agent-command/src/default/default-command-modules.ts`
- `packages/agent-cli/src/startup/command-setup.ts`
- `packages/agent-framework/src/config/config-types.ts` (필요 시 권한 주입 경로)

## Completion Criteria

- [ ] TC-01: `enabledCommandModules: ['help','agent']` 프리셋 적용 시 등록 모듈 집합이 정확히 그 2개임을 단언하는 통합 테스트 통과
- [ ] TC-02: `disabledCommandModules: ['background']` 프리셋 적용 시 해당 모듈이 등록 집합에서 제외됨을 단언하는 통합 테스트 통과
- [ ] TC-03: enable과 disable에 동일 모듈을 동시 지정 시 제외됨(deny > allow)을 단언하는 통합 테스트 통과
- [ ] TC-04: 프리셋 미지정(또는 default) 시 등록 모듈 수가 현재 기본셋과 동일(20개)임을 단언하는 통합 테스트 통과 — 무회귀
- [ ] TC-05: `defaultPermissionMode`를 가진 프리셋 적용 시(settings 미설정) 세션 권한 모드가 프리셋 값과 일치함을 단언하는 통합 테스트 통과
- [ ] TC-06: `pnpm --filter @robota-sdk/agent-command --filter @robota-sdk/agent-cli build` + `pnpm typecheck` → exit 0

## Test Plan

Type BEHAVIOR + tags cli → 등록 모듈 집합/권한 모드 통합 단언 테스트 + 빌드 스모크.

| TC-ID | Test Type              | Tool / Approach                             | Notes    |
| ----- | ---------------------- | ------------------------------------------- | -------- |
| TC-01 | BEHAVIOR               | 통합 테스트 — enable 화이트리스트 집합 단언 |          |
| TC-02 | BEHAVIOR               | 통합 테스트 — disable 제외 단언             |          |
| TC-03 | BEHAVIOR               | 통합 테스트 — deny>allow 단언               |          |
| TC-04 | BEHAVIOR               | 통합 테스트 — 무회귀 모듈 수 단언           |          |
| TC-05 | BEHAVIOR               | 통합 테스트 — 권한 모드 적용 단언           |          |
| TC-06 | CI pipeline smoke test | `pnpm build` + `pnpm typecheck` exit code   | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — 모듈 구성 차이:** 전제: PRESET-002 배선 + 모듈 델타를 가진 임시/실제 프리셋. 실행:
  `robota --preset <id>` 세션에서 `/help`로 사용 가능한 명령 목록 확인. 기대: 프리셋이 disable한 명령은
  목록에 없음. 정리: 없음. Evidence: `/help` 출력 캡처(구현 후 기록).

환경: PRESET-002 선행.

## Tasks

- [ ] `.agents/tasks/PRESET-004.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
