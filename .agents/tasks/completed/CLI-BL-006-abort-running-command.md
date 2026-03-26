---
title: CLI 실행 중 ESC로 명령 중지 기능
status: completed
priority: high
created: 2026-03-24
packages:
  - agent-cli
  - agent-sessions
  - agent-core
---

## 요약

프롬프트 입력 후 AI가 작업 중일 때 ESC 키로 현재 실행을 중지하는 기능.

## 현재 상태

- App.tsx에 `if (key.escape && isThinking) session.abort()` 코드가 이미 존재
- Session.abort() 메서드 존재 여부 및 동작 확인 필요
- Anthropic API streaming 중 abort 시 정상 종료되는지 확인 필요

## 리서치 필요

- Session.abort()의 현재 구현 상태
- Anthropic SDK의 streaming abort 지원 (AbortController)
- abort 후 conversation history 정합성 (중단된 assistant message 처리)
- UI 피드백: abort 시 사용자에게 표시할 내용
- tool 실행 중 abort 시 rollback 필요 여부
