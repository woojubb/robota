---
title: Core 히스토리 범용 메시지 아키텍처
status: backlog
priority: critical
created: 2026-03-26
packages:
  - agent-core
  - agent-sessions
  - agent-sdk
  - agent-cli
---

## 요약

히스토리는 AI 채팅 메시지(user, assistant, tool)만이 아니라, 시스템에서 발생하는 모든 이벤트를 담는 범용 로그여야 한다. AI provider에 전달할 때는 필요한 role만 필터링.

## 현재 문제

- `TUniversalMessage`가 `user | assistant | tool | system` role만 지원
- 스킬 실행 알림("Invoking skill: audit"), compaction 이벤트, 세션 이벤트 등을 히스토리에 기록할 수 없음
- 표시 전용 메시지를 임시로 추가하면 sync 시 사라지거나 AI에 불필요하게 전달됨

## 설계 방향

- 히스토리에 범용 이벤트 메시지를 추가할 수 있는 타입/role 확장
- AI provider에 전달 시 `getMessagesForAPI()`로 필요한 메시지만 필터링
- 히스토리는 append-only, read-only 원칙 유지
- 로그 성격: 모든 시스템 이벤트가 시간순으로 기록됨

## 예시 이벤트 타입

- skill_invocation: 스킬 실행 시작/완료
- compaction: 컨텍스트 압축 이벤트
- permission: 도구 권한 요청/승인/거부
- model_change: 모델 변경
- session_event: 세션 시작/종료/복원

## 선행 조건

- core의 IBaseMessage 타입 확장 또는 새 유니온 타입 정의
- sessions의 Session이 범용 메시지를 히스토리에 기록
- SDK의 InteractiveSession이 이벤트 발생 시 히스토리에 기록
- CLI의 MessageList가 범용 메시지 타입을 렌더링
