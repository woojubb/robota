---
title: Conversation History 아키텍처 재설계 — 기록과 사용의 분리
status: completed
priority: high
created: 2026-03-25
packages:
  - agent-core
  - agent-sessions
  - agent-cli
---

## 요약

채팅 히스토리를 투명하게 모든 데이터를 기록하는 레이어와, 다음 프롬프트에 어떤 데이터를 사용할지 판단하는 레이어를 분리. 현재는 "저장 = 다음 턴에 전달"이지만, 이를 "기록 → 판단 → 사용"으로 변경.

## 배경

현재 ConversationSession은 단순 append-only 리스트. provider 최종 응답만 저장되고, streaming 중간 데이터는 CLI React 상태에만 존재. abort 시 provider가 partial content를 "최종 반환"으로 처리하여 우연히 저장되지만 의도된 설계가 아님.

## 핵심 설계 원칙

1. **투명한 기록**: 한 프롬프트 처리 중 발생하는 모든 데이터(streaming 텍스트, tool 실행, 최종 응답)를 history에 투명하게 기록
2. **사용은 별도 판단**: 다음 프롬프트에 어떤 데이터를 보낼지는 기록과 분리된 로직으로 판단
3. **정상 완료**: streaming 데이터 축적 → 최종 응답 수신 → 최종 응답을 다음 턴에 사용
4. **중단(abort)**: streaming 데이터 축적 → ESC → partial 데이터 + `interrupted` 마크 → 다음 턴에 사용

## 구현 방향

### agent-core 레벨

- assistant message에 상태(state) 필드 추가: `complete` | `interrupted` | `streaming`
- ConversationSession에 "현재 진행 중인 응답" 추적 기능
- streaming 텍스트를 agent-core 레벨에서 축적 (provider 의존 제거)
- `onTextDelta` 콜백을 통해 core에서 partial content 추적

### 히스토리 → 프롬프트 변환 레이어

- history에서 다음 프롬프트용 메시지 목록을 생성하는 별도 로직
- `interrupted` 메시지는 "이전 응답이 중단되었음" 맥락으로 포함
- `streaming` 상태 메시지는 프롬프트에서 제외 (또는 최종 상태로 대체)

### 영향 범위

- agent-core: ConversationSession, TUniversalMessage metadata, 메시지 상태 관리
- agent-sessions: Session.run() 의 history 관리 방식
- agent-cli: streaming 텍스트 표시와 history 연동

## 리서치 필요

- Claude Code의 conversation history 관리 방식
- TUniversalMessage metadata 확장 설계 (state 필드 추가 시 하위 호환성)
- streaming 텍스트를 core에서 축적할 때 성능 영향
- compact 기능과의 상호작용 (interrupted 메시지 compact 시 처리)
