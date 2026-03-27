---
title: agent-plugin-* monolith decomposition (8 packages, 8 files)
status: completed
priority: medium
urgency: later
created: 2026-03-27
packages:
  - agent-plugin-logging
  - agent-plugin-webhook
  - agent-plugin-event-emitter
  - agent-plugin-conversation-history
  - agent-plugin-execution-analytics
  - agent-plugin-performance
  - agent-plugin-limits
  - agent-plugin-error-handling
---

## 요약

8개 plugin 패키지 각각 메인 플러그인 파일 1개씩 300줄 초과. 동일 패턴 — 검증/팩토리/유틸 분리.

## 위반 파일

- `agent-plugin-logging/logging-plugin.ts` (497줄)
- `agent-plugin-webhook/webhook-plugin.ts` (482줄)
- `agent-plugin-event-emitter/event-emitter-plugin.ts` (397줄)
- `agent-plugin-conversation-history/conversation-history-plugin.ts` (367줄)
- `agent-plugin-execution-analytics/execution-analytics-plugin.ts` (365줄)
- `agent-plugin-performance/performance-plugin.ts` (340줄)
- `agent-plugin-limits/limits-plugin.ts` (331줄)
- `agent-plugin-error-handling/error-handling-plugin.ts` (320줄)

## 분리 패턴

각 플러그인에서 공통적으로:

- `validateOptions()` → `{plugin}-validation.ts`
- 팩토리/헬퍼 함수 → `{plugin}-helpers.ts`
- JSDoc 보일러플레이트 간소화

## 테스트 계획

- 각 플러그인 분해 전후 해당 패키지 테스트 통과 확인
- 분해 후 300줄 초과 파일 0개 확인
