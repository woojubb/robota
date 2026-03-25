---
title: 연속된 assistant 메시지를 하나로 합쳐서 표시
status: backlog
priority: medium
created: 2026-03-25
packages:
  - agent-cli
---

## 요약

abort 후 또는 멀티 라운드 실행 후 여러 개의 Robota: 메시지가 분리되어 표시됨. 연속된 assistant 메시지는 하나로 합쳐서 보여주는 것이 UX적으로 좋음.

## 현재 상태

- 멀티 라운드 실행 시 각 라운드마다 별도 assistant message가 history에 추가됨
- abort 시 useSubmitHandler가 history에서 모든 assistant message를 개별로 addMessage
- 결과: "Robota:" 헤더가 여러 번 반복됨

## 구현 방향

- useSubmitHandler에서 연속 assistant message를 content 합산하여 하나의 메시지로 표시
- 또는 MessageList에서 렌더링 시 연속 assistant message를 그룹핑
- history 자체는 변경하지 않음 (append-only 원칙 유지)
