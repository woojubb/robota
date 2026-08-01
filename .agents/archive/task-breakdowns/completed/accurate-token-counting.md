---
title: Accurate token counting for context window management
status: completed
priority: high
created: 2026-03-23
packages:
  - agent-core
  - agent-sessions
  - agent-provider-anthropic
---

## 결론

디버깅 결과, context overflow 방지 메커니즘(tool result 선별 첨부)은 **정상 작동**하고 있었음.

"No response received" 문제의 실제 원인은 **Anthropic provider의 `max_tokens = 4096` 하드코딩**이었음. AI가 tool call 후 최종 응답을 생성할 때 4096 tokens로 부족해서 빈 응답.

## 해결 (완료)

- `getModelMaxOutput(modelId)` 함수 추가 (agent-core)
- Anthropic provider가 모델의 실제 maxOutput 사용 (Sonnet 4.6: 64K, Opus 4.6: 128K)
- `context-overflow-on-plugin-skill.md` 태스크에서 수정됨

## 토큰 추정 현황

| 위치                        | 방식                                             | 평가                                       |
| --------------------------- | ------------------------------------------------ | ------------------------------------------ |
| context-window-tracker      | API `usage.inputTokens` 우선, fallback `chars/4` | 적절 — API 값이 있으면 정확                |
| execution-round pre-send    | `max(cumulativeInputTokens, chars/2)`            | 적절 — API 값이 있으면 정확, 없으면 보수적 |
| execution-round tool result | `max(cumulativeInputTokens, chars/2)`            | 적절 — 동일                                |

현재 추정 방식은 충분히 작동함. 정확한 로컬 토큰 카운팅은 Anthropic tokenizer가 비공개이므로 불가능. `countTokens()` API는 무료지만 rate limit과 latency로 실시간 체크에는 부적합.

## 향후 개선 (필요시)

- chars/token 비율을 content type별로 조정 (한국어, JSON, 코드)
- `countTokens()` API를 임계값 근처에서만 호출하는 하이브리드 접근
