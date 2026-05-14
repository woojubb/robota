---
title: 'PROV-002: configure flow — 중복 provider 추가 시 프로필 이름 생성 로직 개선'
status: done
created: 2026-05-12
priority: medium
urgency: soon
area: packages/agent-sdk/src/command-api/provider/provider-profile-names.ts
---

## Problem

`suggestProviderProfileName()`이 프로필 이름의 base를 **model ID 우선**으로 생성한다.

```typescript
// provider-profile-names.ts
const baseName =
  sanitizeProviderProfileName(input.model) ?? // ← model ID 먼저
  sanitizeProviderProfileName(input.type) ??
  FALLBACK_PROFILE_NAME;
```

같은 타입 두 번째 프로필 추가 시 suffix `-2`가 붙어 `claude-sonnet-4-6-2` 같은 이름이 생성된다.
Status bar가 이 프로필 이름을 그대로 표시하므로 사용자는 존재하지 않는 모델 ID처럼 보인다.

**실제 발생 사례**: `currentProvider: "claude-sonnet-4-6-2"` (프로필 이름) → status bar에 `claude-sonnet-4-6-2 (anthropic) Claude Sonnet 4.6` 표시 → 사용자가 모델 revision으로 오해.

## Root Cause

`suggestProviderProfileName`이 `input.model`을 base로 쓰는 이유는 불명확하다.
프로필 이름은 "어떤 API 키/계정을 쓰는가"를 식별하는 것이지 "어떤 모델을 쓰는가"가 아니다.
모델은 프로필 내부 설정값이고 언제든 변경 가능하므로 프로필 이름의 구성 요소가 되어서는 안 된다.

## Recommendation

**provider type을 base로 사용** (`anthropic`, `anthropic-2`, `openai` 등)

```typescript
const baseName =
  sanitizeProviderProfileName(input.type) ?? // type 우선
  FALLBACK_PROFILE_NAME;
// model은 사용하지 않음
```

**근거:**

1. **프로필 = 계정/키 식별자**: type이 "이게 어떤 제공사 계정인지"를 정확히 표현한다.
2. **모델은 가변**: 모델은 프로필 이름 결정 후에도 바꿀 수 있다. 이름과 실제 모델이 달라지면 더 혼란스럽다.
3. **예측 가능한 이름**: `anthropic`, `anthropic-2` 패턴은 보편적이고 직관적이다.
4. **모델 ID와 구분 명확**: type 기반이면 프로필 이름이 모델 ID처럼 보일 일이 없다.

**대안으로 고려한 것들:**

- 사용자에게 직접 이름 입력 요청 → UX 마찰 증가, 단순 케이스에 불필요
- `{type}-{model}` 조합 → 여전히 model이 이름에 포함되어 모델 변경 시 stale
- 랜덤 suffix → 예측 불가능하고 기억하기 어려움

## Acceptance Criteria

- `suggestProviderProfileName`이 `input.type`을 base로 프로필 이름 생성한다.
- 첫 번째 `anthropic` 프로필 → `anthropic`, 두 번째 → `anthropic-2`
- 기존 잘못된 프로필 이름(`claude-sonnet-4-6-2` 등)은 별도 마이그레이션 불필요 (미배포 프로젝트이므로 사용자가 재설정)
- 관련 테스트(`provider-profile-names.test.ts`) 업데이트

## Notes

관련 파일:

- `packages/agent-sdk/src/command-api/provider/provider-profile-names.ts` — `suggestProviderProfileName()` 수정
- `packages/agent-sdk/src/command-api/provider/provider-profile-names.test.ts` — 테스트 업데이트
