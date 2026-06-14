---
title: 'DQ-AUDIT-007: 사소 — OpenAI 무음 기본모델 fallback + IAIProvider 이중 API 표면'
status: done
created: 2026-06-14
completed: 2026-06-14
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

- [x] DQ-16 가드 추가 (무음 기본모델 제거 → throw)
- [x] DQ-17 SPEC 결정 — 의도적 이중 contract 명시

## Evidence Log

### 구현 완료 — 2026-06-14

**DQ-16:** `openai/streaming/stream-handler.ts`의 `model: model || 'gpt-4o-mini'` 무음 대체 제거 →
`request.model` 누락 시 `ConfigurationError('OpenAI streaming request is missing a model')` throw
(API 호출 전 차단). 구 버그를 단언하던 테스트("should default model to gpt-4o-mini")를 새 동작
("should throw when model is not specified")으로 갱신.

**DQ-17 (결정: 의도적 이중 contract 명시):** `IAIProvider`의 universal(`chat`/`chatStream`,
`TUniversalMessage`) + raw(`generateResponse`/`generateStreamingResponse`, `IProviderRequest`/
`IRawProviderResponse`) 이중 표면을 agent-core SPEC에 "intentional"로 문서화. provider 인스턴스는
본질적으로 universal+raw 둘 다이고, raw 경로는 core `conversation-service` 전용 내부 프로토콜 경로
(provider-native payload 캡처)이지 공개 API가 아님 — 분리가 비례적이지 않아 의도적 단일 인터페이스로
확정하고 사용 규칙(일반 계층은 chat/chatStream만, raw는 conversation-service만)을 명시.

**검증 증거:**

- agent-provider typecheck + build + **554 테스트** passed(갱신된 stream-handler 테스트 포함).
  `pnpm harness:scan` **25/25 passed**, conformance PASS.

User Execution Test Scenario gate: Not applicable(provider 내부 가드 + SPEC 문서화, 정상 경로 동작 무변경).
