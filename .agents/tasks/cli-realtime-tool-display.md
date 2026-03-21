---
title: CLI 실시간 tool 실행 표시
status: backlog
priority: medium
created: 2026-03-22
packages:
  - agent-cli
  - agent-core
---

# CLI 실시간 Tool 실행 표시

## 문제

현재 TUI에서 스트리밍 중 tool call이 발생해도 실시간으로 표시되지 않음. tool 실행이 끝나고 session.run() 완료 후에야 "[N tools]" 메시지로 한꺼번에 표시됨.

사용자는 tool이 실행되고 있는지, 어떤 tool이 실행 중인지 알 수 없어 "멈춘 것 같은" 느낌을 받음.

## 기대 동작

- 스트리밍 중 tool call 감지 시 즉시 UI에 tool 이름 표시
- tool 실행 중 spinner 또는 진행 표시
- tool 완료 시 결과 요약 (성공/실패)
- Claude Code 참고: tool 실행 시 `Tool: Bash(command)` 형태로 실시간 표시

## 관련 코드

- `packages/agent-cli/src/ui/App.tsx` — runSessionPrompt, tool call 표시
- `packages/agent-cli/src/utils/tool-call-extractor.ts` — 현재 사후 추출 방식
- `packages/agent-core/src/services/execution-round.ts` — tool 실행 루프
- `packages/agent-sessions/src/session.ts` — onTextDelta 콜백

## 구현 방향 (검토 필요)

- Session에 `onToolStart(toolName, args)` / `onToolEnd(toolName, result)` 콜백 추가
- 또는 기존 event system 활용 (PreToolUse/PostToolUse hook)
- App.tsx에서 실시간으로 tool 실행 상태를 표시하는 UI 컴포넌트
