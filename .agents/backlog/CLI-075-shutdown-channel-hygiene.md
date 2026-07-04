---
title: 'CLI-075: 종료/채널 위생: TUI 리스너 해제·permission 큐 drain·graceful shutdown'
status: todo
created: 2026-07-04
priority: medium
urgency: soon
area: packages/agent-transport-tui, packages/agent-cli, packages/agent-tools
depends_on: ['CORE-022']
---

# 종료/채널 위생: TUI 리스너 해제·permission 큐 drain·graceful shutdown

Re-audit P2-18 (RUNTIME-31/32/33/35). TuiInteractionChannel.stop이 리스너 13종 미해제+구세션
미shutdown; abort가 permission 큐 미drain(processingPermission 고착); renderApp 종료가
process.exit(0) 즉시 + 행 시 2차 Ctrl+C no-op.

## What

1. stop() 리스너 unwire + 세션 전환 시 구세션 shutdown 정책 명시.
2. cancelAllPermissions() 추가(abort/shutdown 경로).
3. 타임아웃부 await channel.stop() + 2차 시그널 process.exit(130) (api-boundary 준수).
4. 동반: 스톨 감지기 도구 실행 중 억제(39), tui-state-manager dispose(52).

## Test Plan

- 채널 stop 후 리스너 0; permission drain; 시그널 경로 테스트.

## User Execution Test Scenarios

- agent-executable. 라이브 TUI(PTY) 기동 → 세션 전환 → 종료 후 프로세스 자연 종료(핸들 0) 실측
  - 종료 중 pending permission drain 확인.
- Evidence: (record after execution)
