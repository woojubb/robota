---
title: 'CORE-024: 백그라운드 스케줄러 위생: 슬롯/hung fire 기아/wakeTaskIds/IPC flush 레이스'
status: done
created: 2026-07-04
completed: 2026-07-04
priority: high
urgency: soon
area: packages/agent-executor, packages/agent-subagent-runner, packages/agent-framework
depends_on: []
---

# 백그라운드 스케줄러 위생: 슬롯/hung fire 기아/wakeTaskIds/IPC flush 레이스

Re-audit P2-9 (RUNTIME-17/18/19/20/25 + 47 동반). 잠자는 cron이 maxConcurrent(4) 슬롯 영구 점유
→ spawn 기아; hung fire protect:true 기아; wake 축출 시 wakeTaskIds 미정리 → 미래 wake 영구
거부; 워커 IPC result/exit flush 레이스로 성공이 crash 오보 + usage 유실(ANALYTICS-001 부류).

## What

1. SLEEP 전이 시 슬롯 반환(또는 스케줄 태스크 동시성 제외); fire별 timeout+kill.
2. pending 프롬프트 큐 배열화(최소: 축출 시 wakeTaskIds 정리); 워커 exit를 process.send 완료
   이후로; 무조건 exit 예약 vs runFollowUp 모순 해소.
3. 동반: IPC usage 스키마 검증(RUNTIME-47).

## Test Plan

- 스케줄러 상태기계 단위 테스트; IPC flush 레이스 회귀.

## User Execution Test Scenarios

- agent-executable. 라이브 스케줄 태스크 실행 — 성공이 crash로 오보되지 않고 usage가 부모 로그
  귀속 실측(ANALYTICS-001 라이브 레시피 재사용).
- Evidence: **PASSED 2026-07-04** — live ANALYTICS-001 recipe with the real built CLI
  (`robota -p "Use the Agent tool to spawn a general-purpose subagent …"` against a real
  Anthropic provider, model claude-haiku-4-5, throwaway cwd, key from the gitignored agent-cli
  `.env`). The subagent **completed successfully** (relayed its output; previously it exited
  `[failed]`), and `session analyze <id> --usage` read:
  `main thread 87.3% (35.7K) · general-purpose 12.7% (5.2K) · top consumer: main thread` —
  i.e. the subagent's tokens were forwarded over IPC and attributed to its own source, not lost
  and not misreported as a crash (RUNTIME-20), matching the ANALYTICS-001 baseline
  (87.1%/12.9%). The `usage` payload crossing the IPC boundary is validated by the new guard
  (RUNTIME-47).
- **Blocker discovered + fixed in-scope:** the recipe first failed with the subagent exiting
  `[failed]` because `getDefaultSubagentWorkerPath()` forks
  `dist/node/child-process-subagent-worker.js`, which the tsdown build never emitted (it bundled
  the worker into `index.js`) — the child-process subagent was **non-functional from any dist
  build**. Fixed by adding the worker as a separate tsdown entry; this was the enabler for the
  live UE the backlog requires.

## Implementation Evidence (2026-07-04)

SPEC first: agent-executor SPEC § Concurrency and Slot Accounting + § Scheduled Fire Watchdog;
agent-subagent-runner SPEC § Worker Lifecycle & IPC Integrity; agent-framework SPEC § Agent Wake
Dedup & Eviction.

- **RUNTIME-17** (slot starvation): `background-task-manager.ts` replaces the `activeCount` number
  with an id-keyed `slotHolders` Set; a `background_task_sleeping` event releases the slot (+drains
  the queue), a `background_task_waking` re-acquires it. `markBackgroundTaskCancelled` dropped its
  now-unused `wasActive` flag. Test: "a sleeping scheduled task releases its concurrency slot".
- **RUNTIME-18** (hung fire): `scheduled-task-runner.ts` adds a per-fire timeout that
  `killProcessTree`s the hung child (process group) so `close` fires and the next cron tick runs,
  defeating croner `protect:true` starvation. Test spawns a real 60s-hang fire with a 700ms
  timeout and asserts subsequent fires still happen.
- **RUNTIME-19** (wakeTaskIds eviction): `interactive-session-execution-controller.ts`
  `clearPendingQueue()` now deletes the pending turn's `wakeTaskId` from `wakeTaskIds`, so an
  aborted/dropped queued wake no longer locks out every future wake for that task. Test:
  "aborting a queued wake evicts its id".
- **RUNTIME-20** (exit before flush): `child-process-subagent-worker.ts` replaces the
  `finally { setImmediate(process.exit) }` with `sendTerminalMessageAndExit`, which exits only
  from the `process.send` flush callback (with a fallback timer) — the result+usage flushes
  before exit, so the parent settles on the result instead of a crash projection.
- **RUNTIME-47** (usage schema): `child-process-subagent-ipc.ts` guard now validates the optional
  `usage` payload (three numeric fields) on a `result` message. Tests: accepts well-formed usage,
  rejects malformed/partial/non-object usage.
- **Enabler**: `tsdown.config.ts` emits `child-process-subagent-worker` as a separate entry.
- Full workspace: build/typecheck 0 errors; touched-package tests green (agent-executor 84,
  agent-subagent-runner 14, agent-framework 1036); lint 0; 45/45 harness scans. (The
  command-handoff PTY e2e is HOME-env-sensitive — green under real HOME, per prior note.)
