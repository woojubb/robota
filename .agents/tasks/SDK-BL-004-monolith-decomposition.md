---
title: agent-sdk monolith decomposition (3 files)
status: backlog
priority: high
urgency: soon
created: 2026-03-27
packages:
  - agent-sdk
---

## 요약

agent-sdk에 300줄 초과 프로덕션 파일 3개. 책임 기준으로 분해.

## 위반 파일

- `interactive/interactive-session.ts` (663줄) — 가장 큰 파일. 초기화/이벤트/실행/히스토리 분리
- `plugins/marketplace-client.ts` (403줄)
- `plugins/bundle-plugin-loader.ts` (333줄)

## 테스트 계획

- `pnpm --filter @robota-sdk/agent-sdk test` 전후 통과 확인
- 분해 후 300줄 초과 파일 0개 확인
