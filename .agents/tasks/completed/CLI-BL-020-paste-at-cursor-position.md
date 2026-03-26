---
title: Paste at Cursor Position — 현재 커서 위치에 붙여넣기
status: backlog
priority: high
urgency: now
created: 2026-03-27
packages:
  - agent-cli
---

## 요약

텍스트 사이에 커서를 두고 붙여넣기하면 커서 위치가 아닌 맨 뒤에 붙여넣기됨. CjkTextInput 또는 InputArea의 paste 처리에서 커서 위치를 무시하는 버그.

## 재현

1. 입력 필드에 텍스트 입력
2. 방향키로 커서를 텍스트 중간으로 이동
3. 붙여넣기 (Cmd+V)
4. 기대: 커서 위치에 삽입
5. 실제: 맨 뒤에 삽입됨
