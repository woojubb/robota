---
title: 'DQ-AUDIT-007: 사소 — OpenAI 무음 기본모델 fallback + IAIProvider 이중 API 표면'
status: todo
created: 2026-06-14
priority: low
urgency: backlog
area: packages/agent-provider, packages/agent-core
depends_on: []
---

# DQ-AUDIT-007: 사소 항목 (NIT)

## 포함 findings

- **DQ-16 (NIT) — OpenAI 스트림 핸들러 무음 기본모델 대체.**
  `agent-provider/src/openai/streaming/stream-handler.ts:100` `model: model || 'gpt-4o-mini'` — 모델 없이
  도착 시 하드코딩 모델로 silent 대체. 모델은 상위에서 항상 해석되어야 하며 누락은 버그. → 누락 시
  명확한 에러 throw.
- **DQ-17 (NIT) — `IAIProvider` 이중 universal/raw API 표면.**
  `agent-core/src/interfaces/provider.ts:240-265`이 `chat()/chatStream()`(universal)과
  `generateResponse()/generateStreamingResponse()`(raw `IProviderRequest`)를 한 계약에 노출. raw 경로가
  provider-internal 형태를 universal 경계로 흘림(경미한 추상화 누수). 둘 다 라이브 사용 중. → raw 경로가
  conversation-service 내부 전용이면 별도 `IRawProvider`(internal)로 분리. **SPEC 결정 사안** — 단독 변경 금지.

## Completion Criteria

- [ ] TC-01: OpenAI stream 핸들러가 모델 누락 시 throw (silent 대체 제거)
- [ ] TC-02: (DQ-17) provider API 분리 여부 SPEC 결정 후 반영 또는 의도적 단일 계약으로 문서화
- [ ] TC-03: agent-provider/agent-core typecheck/test + `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type     | Approach                                 |
| ----- | ------------- | ---------------------------------------- |
| TC-01 | Unit          | 모델 미지정 stream 요청 시 throw 검증    |
| TC-02 | Design        | SPEC 결정 + (해당 시) 인터페이스 분리    |
| TC-03 | Build/Harness | filter typecheck + vitest + harness:scan |

## User Execution Test Scenarios

Not applicable — provider 내부 계약/가드. 정상 경로 사용자 동작 무변경.

## Tasks

- [ ] DQ-16 가드 추가
- [ ] DQ-17 SPEC 결정 (사용자 컨펌)

## Evidence Log
