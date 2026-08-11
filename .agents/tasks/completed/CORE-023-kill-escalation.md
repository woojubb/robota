---
title: 'CORE-023: 공용 킬 헬퍼: SIGTERM→grace→SIGKILL + 프로세스그룹, 5개 지점 수렴'
status: done
created: 2026-07-04
completed: 2026-07-04
priority: high
urgency: soon
area: packages/agent-process, packages/agent-executor, packages/agent-tools, packages/agent-subagent-runner, packages/agent-testing
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
- Evidence: **PASSED 2026-07-04** — live probe `scratch/src/core-023-user-execution.ts`
  (gitignored scratch workspace; recipe `pnpm --filter robota-scratch run run
src/core-023-user-execution.ts`) drove the real Shell tool with a real AbortSignal: a shell
  that `trap '' TERM` (ignores SIGTERM) backgrounded a grandchild `sleep` and recorded its PID;
  the run was aborted mid-execution. Output:
  `grandchildStarted=true abortedResult=Aborted grandchildSurvived=false` / `CORE-023-OK` —
  the trapped-shell's grandchild was reaped by the process-group SIGKILL escalation. This is the
  exact process that SURVIVED in the CORE-018 live UE (bare SIGTERM killed only the direct shell).
  Model-driven variant was flaky (transient empty provider response), so the tool — the unit under
  test — was driven directly, still exercising the real spawn(detached) + killProcessTree path.

## Implementation Evidence (2026-07-04)

- **New package `@robota-sdk/agent-process`** (user-approved placement, Option A): zero
  `@robota-sdk` deps, domain-free. `killProcessTree(child, { graceMs, signal, processGroup,
preKill })` — SIGTERM→grace→SIGKILL over the process group (POSIX `process.kill(-pid)`,
  Windows `taskkill /T /F`), settling on the real `exit` event (not synchronously, not on the
  misleading `child.killed` flag). `DEFAULT_KILL_GRACE_MS = 2000` (was duplicated in 2 runners).
  SPEC + README + docs/README written; own tests 6/6 (SIGKILL escalation + grandchild reaping).
- **5 kill sites converged** (each spawns/forks `detached` on POSIX + `killProcessTree`):
  - `agent-tools/src/builtins/shell-tool.ts` — timeout + onAbort now group-kill (was bare SIGTERM).
  - `agent-executor/.../managed-shell-process-runner.ts` — timeout + `cancelProcess` (removed the
    `child.killed` dead-guard; cancel now awaits real exit).
  - `agent-executor/.../scheduled-task-runner.ts` — the fired child is now tracked on state and
    killed on cancel (was a local var, orphaned).
  - `agent-subagent-runner/.../child-process-subagent-transport.ts` — `cancelChildProcess` now
    escalates to SIGKILL via `preKill` (graceful IPC cancel first, then group SIGTERM→SIGKILL);
    was SIGTERM-only.
  - `agent-testing/src/pty/spawn-pty.ts` — `dispose()` mirrors the escalation pattern inline
    (SIGKILL after grace); kept zero `@robota-sdk` deps (PTY is a different `IPty` abstraction).
- **Companion fixes**: RUNTIME-31 (shell-tool closes the child's stdin so stdin-readers don't hang);
  RUNTIME-48 (managed-shell initial stdin write goes through the error-listener path); RUNTIME-53
  (`agent-command/.../spawn-inherited.ts` translates a signal termination to exit code `128+signal`
  instead of a false `0`); RUNTIME-16 (worktree removal now follows child exit transitively, since
  `killProcessTree` awaits exit and the subagent cancel awaits `cancelChildProcess`).
- Registration: `.agents/project-structure.md` package listing + `check-capability-placement.mjs`
  family-rule table entry for the new package.
- Full workspace: build/typecheck 0 errors; touched-package tests green (agent-process 6, agent-tools
  147, agent-executor 82, agent-subagent-runner 13, agent-command 210, agent-testing 2); lint 0
  errors; 45/45 harness scans.
