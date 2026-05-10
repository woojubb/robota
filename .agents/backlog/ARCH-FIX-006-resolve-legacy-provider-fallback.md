---
title: 'ARCH-FIX-006: resolveLegacyProvider() fallback 패턴 제거'
status: todo
created: 2026-05-10
priority: high
urgency: soon
area: code-quality
related: [V-SYS-006]
---

## Problem

`resolveLegacyProvider()` 함수가 `currentProvider`가 없을 때 구형 flat 설정으로 자동 fallback한다. `operational.md`의 no-fallback 정책 위반이다.

미배포 프로젝트에서 backward compatibility를 위한 fallback 경로는 존재 이유가 없다. silent fallback은 잘못된 설정을 숨기고 디버깅을 어렵게 만든다.

## Solution

1. `resolveLegacyProvider()` 함수 위치를 확인한다.
2. fallback 분기를 제거하고 `currentProvider`가 없을 때 명시적 에러를 throw한다.
3. 호출부에서 필요한 경우 설정 마이그레이션 로직을 명시적으로 호출하도록 수정한다.
4. "legacy" 접두사 함수가 더 이상 필요 없다면 함수 자체를 삭제한다.

## Test Plan

- `pnpm typecheck` 전체 통과
- `pnpm test` 전체 통과
- `resolveLegacyProvider` 관련 테스트에서 fallback 경로 없음 확인
- 잘못된 설정 입력 시 명시적 에러 발생 확인

## User Execution Test Scenarios

### 시나리오: provider 설정 없이 CLI 실행 시 명시적 에러 메시지 확인

**전제 조건**: Node.js 22+, pnpm 빌드 완료, provider 미설정 상태

**실행 단계**:

```bash
pnpm build
robota --provider nonexistent
```

**기대 결과**: silent fallback 없이 "provider not found" 또는 유사한 명시적 에러 메시지 출력.

**증거**: (구현 후 기록)
