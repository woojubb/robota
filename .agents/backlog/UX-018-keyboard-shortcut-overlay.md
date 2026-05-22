---
title: 'UX-018: ? 키 인라인 단축키 오버레이 — TUI 내 도움말 즉시 접근'
status: todo
created: 2026-05-23
priority: medium
urgency: later
area: packages/agent-cli, packages/agent-transport
depends_on: []
---

## Background

TUI 키보드 단축키가 README에만 있고 앱 내에서 확인할 수 없다. 새 사용자가 단축키를 발견하지 못해 기능을 활용하지 못한다.

## 작업 항목

- TUI에서 `?` 키 입력 시 인라인 단축키 오버레이 표시
  ```
  ┌─ 키보드 단축키 ────────────────────────┐
  │  Enter      메시지 제출               │
  │  ESC        현재 실행 중지            │
  │  Ctrl+C     즉시 종료                 │
  │  ↑/↓        입력 히스토리 탐색        │
  │  Tab        자동완성 선택             │
  │  ?          이 도움말 닫기            │
  └───────────────────────────────────────┘
  ```
- `?` 또는 ESC로 오버레이 닫기
- 오버레이 표시 중에는 입력 비활성화

## Test Plan

- `?` 키 입력 시 오버레이 표시 확인
- ESC로 오버레이 닫기 확인

## User Execution Test Scenarios

Not applicable — UI overlay change.
