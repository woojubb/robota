---
title: 'CORE-023: 공용 킬 헬퍼: SIGTERM→grace→SIGKILL + 프로세스그룹, 5개 지점 수렴'
status: todo
created: 2026-07-04
priority: high
urgency: soon
area: packages/agent-executor, packages/agent-tools, packages/agent-subagent-runner, packages/agent-testing
depends_on: ['CORE-018']
---

# 공용 킬 헬퍼: SIGTERM→grace→SIGKILL + 프로세스그룹, 5개 지점 수렴

Re-audit P2-8 (RUNTIME-01~05 + 55). SIGKILL 에스컬레이션이 5개 지점에서 각각 누락: child.killed
오해 죽은 가드, timeout 즉시 reject, shell-tool 프로세스그룹 미킬, 서브에이전트 SIGTERM뿐,
scheduled fire child 미추적, spawn-pty 킬 1회.

## What

1. 공용 kill 유틸(detached/프로세스그룹 + SIGTERM→grace→SIGKILL, exit 이벤트 기반 settled) 신설
   후 5개 지점 교체.
2. 동반: RUNTIME-16(워크트리 제거 전 exit 대기), 31(stdin.end), 48(stdin error 리스너),
   53(spawnInherited 시그널 종료코드).

## Test Plan

- SIGTERM 무시 자식 fixture로 에스컬레이션 실측(각 지점).

## User Execution Test Scenarios

- agent-executable. 라이브 shell 도구로 trap SIGTERM 자식 트리 생성 후 취소 — ps로 프로세스그룹
  잔존 0 실측.
- Evidence: (record after execution)
