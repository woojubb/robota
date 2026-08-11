---
title: Ctrl+C 동작 명확화
status: completed
priority: medium
created: 2026-03-25
packages:
  - agent-cli
---

## 요약

Ctrl+C의 동작이 명확하지 않음. 현재 App.tsx에서 `exit()`을 호출하지만, PluginTUI나 다른 오버레이가 활성화되어 `useInput`이 비활성화된 상태에서는 Ctrl+C가 작동하지 않을 수 있음.

## 현재 상태

- App.tsx `useInput`에서 `key.ctrl && _input === 'c'` → `exit()` 호출
- `useInput`의 `isActive`가 `!permissionRequest && !showPluginTUI`로 설정
- PluginTUI 활성화 시 App의 Ctrl+C 핸들러 비활성화
- PluginTUI, MenuSelect, TextPrompt, ConfirmPrompt 어디에서도 Ctrl+C를 처리하지 않음

## 리서치 필요

- Ink의 raw mode에서 Ctrl+C 처리 방식
- Claude Code의 Ctrl+C 동작 (abort vs exit)
- Ctrl+C가 항상 동작해야 하는지 (프로세스 종료) vs ESC와 역할 분담
