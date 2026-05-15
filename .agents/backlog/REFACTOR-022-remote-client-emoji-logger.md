---
title: 'REFACTOR-022: agent-remote-client 이모지 + 진단 로거 정리'
status: backlog
created: 2026-05-15
priority: low
urgency: backlog
area: packages/agent-remote-client
---

## Problem

`packages/agent-remote-client/src/client/chat-http-methods.ts:105,181,198,202,249`에 이모지 prefix와 ad-hoc 진단 문자열이 포함된 logger 호출이 있다:

```ts
logger.info('🔧 [HTTP-CLIENT] Request tools:', { count: tools.length });
logger.info('🌐 [HTTP-CLIENT] Starting streaming...');
logger.error('❌ [HTTP-CLIENT] Stream error:', error);
```

DI logger를 통하므로 `console.*` 규칙 위반은 아니나, 이모지 prefix와 info-level 매 요청 진단 로그는 구조화되지 않은 개발 스캐폴딩이다.

Source: COMBINED-022 (SD-014)

## Scope

1. 이모지 prefix 제거.
2. info-level 매 요청 tool count 로깅을 debug level로 낮춤.
3. 구조화 가능한 이벤트는 message string이 아닌 structured fields object로 전달.

## Test Plan

- `grep -r "🔧\|🌐\|❌\|🔍" packages/agent-remote-client/src --include="*.ts"` — 결과 없음
- `pnpm --filter @robota-sdk/agent-remote-client test` — 통과

## User Execution Test Scenarios

Not applicable — 로그 메시지 정리이며 사용자 관찰 가능한 동작 변화 없음.
