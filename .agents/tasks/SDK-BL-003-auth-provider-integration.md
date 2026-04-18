---
title: AI Provider OAuth 지원 — 공식 서드파티 OAuth 출시 시 적용
status: blocked
priority: low
urgency: later
created: 2026-03-26
blocked-by: Anthropic/OpenAI 모두 서드파티 OAuth 미제공
---

## 요약

Anthropic 또는 OpenAI가 서드파티용 공식 OAuth를 제공하면 적용. 현재 양쪽 모두 API Key만 가능.

## 현황 (2026-03-26)

| Provider  | 서드파티 OAuth             | 구독 크레딧 공유 | 서드파티 인증 방식   |
| --------- | -------------------------- | ---------------- | -------------------- |
| Anthropic | 차단 (2026-01 서버측 차단) | Claude Code 전용 | API Key (`sk-ant-`)  |
| OpenAI    | 존재하지 않음              | 불가             | API Key (`sk-proj-`) |

- **Anthropic**: Claude 구독 OAuth는 Claude Code/Claude.ai 전용. 서드파티 도구(Cursor, Cline 등) 모두 2026-01에 차단됨
- **OpenAI**: 서드파티 도구용 OAuth 자체가 없음. ChatGPT Apps SDK는 역방향 (우리가 OAuth 서버). 구독을 서드파티 도구에 연결하는 메커니즘 없음
- **Robota 현재**: `agent-provider-anthropic`, `agent-provider-openai` 모두 API Key 방식으로 구현 완료. 추가 작업 불필요

## 트리거 조건

Anthropic 또는 OpenAI가 서드파티 OAuth Provider 역할을 공식 발표하면 이 태스크를 active로 전환.

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
