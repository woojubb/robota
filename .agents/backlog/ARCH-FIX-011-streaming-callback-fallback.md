---
title: 'ARCH-FIX-011: streaming callback fallback 패턴 제거'
status: todo
created: 2026-05-10
priority: medium
urgency: backlog
area: code-quality
related: [V-SYS-008]
---

## Problem

`agent-sdk` SPEC.md에 streaming callback 우선순위 fallback이 명시되어 있다:

```
run_scoped callback || provider_level callback
```

이는 `||` 연산자를 통한 암묵적 fallback으로, `operational.md` no-fallback 정책과 충돌한다. fallback 패턴은 잘못된 설정을 숨기고 예측 불가능한 동작을 유발한다.

## Solution

1. streaming callback 우선순위 로직이 구현된 위치를 파악한다.
2. fallback 분기를 제거한다. 호출 시점에 callback이 명시적으로 선택되어야 한다.
3. 두 레벨의 callback이 모두 있을 때 명시적 충돌 에러를 throw하거나, 단일 경로로 정규화한다.
4. SPEC.md에서 fallback 동작 설명을 제거하고 명시적 선택 로직으로 업데이트한다.

## Test Plan

- 관련 streaming 테스트 전체 통과
- fallback 분기 코드 없음 확인
- `pnpm --filter @robota-sdk/agent-sdk test`
- `pnpm typecheck`

## User Execution Test Scenarios

### 시나리오: streaming 모드 CLI 실행 정상 동작 확인

**전제 조건**: Node.js 22+, 빌드 완료, 유효한 provider 설정

**실행 단계**:

```bash
pnpm build
echo "hello" | robota --output-format stream-json
```

**기대 결과**: streaming 출력이 fallback 없이 정상 동작.

**증거**: (구현 후 기록)
