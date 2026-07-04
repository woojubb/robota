---
title: 'CORE-026: 부동 프라미스/레이스 잔여 수리 + no-floating-promises 린트 활성화'
status: todo
created: 2026-07-04
priority: medium
urgency: soon
area: packages/agent-core, packages/agent-framework, packages/agent-transport
depends_on: ['CORE-018']
---

# 부동 프라미스/레이스 잔여 수리 + no-floating-promises 린트 활성화

Re-audit P2-17 (RUNTIME-12/21/24/26/36; T4 부류 차단). 린트 도입 사용자 승인 완료(안건 3):
@typescript-eslint/no-floating-promises error, 기존 위반 소진 후 활성화.

## What

1. 턴 이중 시작 레이스(executing 동기 설정, RUNTIME-12).
2. 버려진 runStream 제너레이터 FIFO 큐 웨징 가드(21) + Session.run abortController 레이스(24).
3. init/wake/drain 부동 프라미스 → reportBackgroundError 라우팅(26); headless 슬래시커맨드
   3개소 .catch + 종료코드 계약 복원(36).
4. 잔여 위반 소진 후 린트 error 활성화.

## Test Plan

- 레이스 재현 단위 테스트; 린트 활성화 후 0 error.

## User Execution Test Scenarios

- agent-executable. 라이브 headless 실패 커맨드 → 문서화된 종료코드 실측; 연속 submit 2건 →
  이중 턴 미발생.
- Evidence: (record after execution)
