---
title: agent-core monolith decomposition (15 files)
status: completed
priority: high
urgency: soon
created: 2026-03-27
packages:
  - agent-core
---

## 요약

agent-core에 300줄 초과 프로덕션 파일 15개. 책임 기준으로 분해.

## 위반 파일

- `services/execution-round.ts` (675줄)
- `services/execution-service.ts` (623줄)
- `core/robota.ts` (484줄)
- `services/execution-event-emitter.ts` (481줄)
- `index.ts` (475줄)
- `managers/conversation-store.ts` (440줄)
- `managers/agent-factory.ts` (409줄)
- `services/execution-stream.ts` (404줄)
- `plugins/event-emitter-plugin.ts` (396줄)
- `abstracts/abstract-workflow-converter.ts` (396줄)
- `abstracts/abstract-module.ts` (396줄)
- `abstracts/abstract-ai-provider.ts` (387줄)
- `utils/execution-proxy.ts` (328줄)
- `services/tool-execution-service.ts` (322줄)
- `interfaces/tool.ts` (304줄)

## 테스트 계획

- 각 파일 분해 전 `pnpm --filter @robota-sdk/agent-core test` 통과 확인
- 분해 후 동일 테스트 통과 (행동 변경 없음)
- 분해 후 300줄 초과 파일 0개 확인
- index.ts는 re-export 정리 (그룹별 barrel file 분리)
