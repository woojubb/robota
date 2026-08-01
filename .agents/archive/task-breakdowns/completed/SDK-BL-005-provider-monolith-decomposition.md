---
title: agent-provider-* monolith decomposition (3 packages, 3 files)
status: completed
priority: medium
urgency: later
created: 2026-03-27
packages:
  - agent-provider-anthropic
  - agent-provider-google
  - agent-provider-openai
---

## 요약

3개 provider 패키지 각각 메인 provider 파일 1개씩 300줄 초과.

## 위반 파일

- `agent-provider-anthropic/provider.ts` (577줄) — 가장 큰 파일
- `agent-provider-google/provider.ts` (375줄)
- `agent-provider-openai/provider.ts` (351줄)

## 분리 패턴

- 메시지 변환 로직 → `message-converter.ts` (이미 일부 패키지에 존재)
- 스트리밍 핸들링 → `stream-handler.ts` (이미 일부 패키지에 존재)
- 설정/검증 → `provider-config.ts`

## 테스트 계획

- 각 provider 분해 전후 해당 패키지 테스트 통과 확인
- 분해 후 300줄 초과 파일 0개 확인
