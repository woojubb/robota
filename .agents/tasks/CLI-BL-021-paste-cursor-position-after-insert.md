---
title: Paste Cursor Position — 붙여넣기 후 커서가 삽입된 텍스트 끝으로 이동
status: backlog
priority: medium
urgency: soon
created: 2026-03-27
packages:
  - agent-cli
---

## 요약

CLI-BL-020에서 커서 위치에 붙여넣기는 수정됨. 그러나 붙여넣기 후 커서가 맨 뒤로 이동하는 문제 남아있음. 삽입된 label 끝으로 커서가 이동해야 함.

## 원인

CjkTextInput의 외부 값 동기화 로직 (`cursorRef.current = value.length`)이 onPaste에서 설정한 커서 위치를 덮어씀. tab completion과 paste의 커서 동작이 충돌.

## 해결 방향

- onPaste가 새 커서 위치를 반환하는 패턴
- CjkTextInput의 외부 값 동기화에서 paste 직후를 구분하는 메커니즘 필요
- tab completion (끝으로), paste (label 끝으로), clear (0으로) 각각 다른 커서 동작

## 주의

CjkTextInput의 커서 동기화 로직을 변경할 때 tab completion, clear, paste 3가지 케이스 모두 검증 필요.
