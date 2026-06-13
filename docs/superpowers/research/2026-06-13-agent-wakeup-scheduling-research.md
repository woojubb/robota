# Agent Wakeup & Scheduling 아키텍처 리서치

리서치 날짜: 2026-06-13
목적: Claude Code의 "백그라운드 작업 모니터 + 예약 wakeup으로 에이전트 재호출" 기능을 Robota CLI에 도입하기 위한 아키텍처 조사. 본 문서는 백로그 [[FLOW-001]] (스케줄/모니터 agent wakeup)과 [[BEHAVIOR-003]] (scheduled-task-runner 타이밍 플레이크) 설계 근거다.

## Sources

- Claude Code Overview: https://code.claude.com/docs/en/overview
- Anthropic — local scheduled tasks (`/loop`, `/schedule`, Cron): https://the-decoder.com/anthropic-turns-claude-code-into-a-background-worker-with-local-scheduled-tasks/
- Claude Code Routines (cloud scheduling): https://www.mindstudio.ai/blog/claude-code-routines-scheduled-cloud-tasks
- Claude Code loop vs scheduled tasks: https://www.mindstudio.ai/blog/claude-code-loop-vs-scheduled-tasks
- Feature request: proactive scheduled hooks (cron-like): https://github.com/anthropics/claude-code/issues/4785
- DBOS — Durable Execution for Crashproof AI Agents: https://www.dbos.dev/blog/durable-execution-crashproof-ai-agents
- Temporal — Durable multi-agent architecture: https://temporal.io/blog/using-multi-agent-architectures-with-temporal
- AI agent loop architecture: https://blogs.oracle.com/developers/what-is-the-ai-agent-loop-the-core-architecture-behind-autonomous-ai-systems

---

## 1. Claude Code의 기능 모델 (재현 대상)

이 세션에서 직접 관찰한 3개 primitive:

| Primitive          | 동작                                                         | 생존 범위                            |
| ------------------ | ------------------------------------------------------------ | ------------------------------------ |
| **ScheduleWakeup** | 미래 시각에 follow-up 지시와 함께 에이전트를 재개            | 호스트 활성 중 (in-process)          |
| **Monitor**        | 백그라운드 프로세스의 출력 라인을 이벤트로 → 에이전트 재호출 | 호스트 활성 중 (in-process)          |
| **Cron / `/loop`** | cron 표현식으로 반복 자율 실행                               | 호스트 활성 중 (`/loop`)             |
| **Routines**       | 클라우드에서 cadence로 실행 (Anthropic 인프라에 hand-off)    | 크로스 프로세스 / 호스트 종료 후에도 |

핵심 실행 모델 (출처: the-decoder, mindstudio):

- 로컬 스케줄(`/loop`, `/schedule`)은 **Claude Code가 떠 있는 동안만** 동작한다.
- 예약 시각이 오면 "spins up → 작업 실행 → 종료"하며, 다음 실행은 fresh하게 시작한다. 표준 cron 표현식 + 로컬 타임존.
- Routines는 별도 시스템(클라우드)으로, 호스트가 꺼져 있어도 동작 — 즉 로컬 스케줄과 크로스 프로세스 스케줄은 **별개의 레이어**다.

→ 시사점: Robota도 "in-process wakeup"을 먼저(Phase 1) 완성하고, 크로스 프로세스(OS scheduler / daemon)는 별도 레이어로 분리하는 것이 Claude Code의 검증된 분할과 일치한다.

## 2. Durable Execution 패턴 (지속성/재개)

DBOS, Temporal, LangGraph에서 공통으로 나타나는 primitive:

- **Checkpoint & Resume**: 워크플로 상태를 저장소에 체크포인트하고, 재시작 시 마지막 체크포인트부터 재개 (LangGraph PostgresSaver, DBOS `@workflow`/`@step`).
- **비차단 비동기 호출**: 작업을 spawn하고 즉시 제어 반환 (`DBOS.start_workflow` → returns immediately) — 사용자는 계속 대화 가능.
- **Wakeup = recv/send**: 일시정지된 워크플로를 외부 이벤트로 재개. `DBOS.recv(timeout)`로 대기, 외부에서 `DBOS.send(workflow_id, payload)`로 깨움. pause 기간과 실행 연속성을 분리.
- **Durable timer**: Temporal의 timer/sleep은 워커가 죽어도 살아남아 만료 시 재개.

→ 시사점: "wake 지시(instruction)와 다음 발화 시각(nextFireAt)을 반드시 체크포인트해야 재시작 후 재개 가능"이라는 지속성 계약. Robota의 session record는 이미 `backgroundTasks` / `backgroundTaskEvents` / `nextFireAt`을 영속화하므로 이 계약을 만족한다.

## 3. Robota CLI 현재 상태 — 코드베이스 맵

(탐색 일자 2026-06-13, develop 기준)

### 이미 존재하는 것 ✅

| 영역                    | 위치 / 핵심                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scheduled runner (cron) | `packages/agent-executor/src/background-tasks/runners/scheduled-task-runner.ts` — `croner`, `background_task_sleeping{nextFireAt}` / `background_task_waking` emit |
| Process runner          | `.../runners/managed-shell-process-runner.ts` — 장기 프로세스 스트리밍 (`background_task_text_delta`, `tool_*`)                                                    |
| 이벤트 파이프라인       | manager → `interactive-session-background-tracker.ts` → `execution-workspace-projection.ts` → TUI status bar                                                       |
| 프롬프트 재진입 큐      | `interactive-session-execution-controller.ts` — `executing` / `pendingPrompt` / `drainPendingQueue()`                                                              |
| 영속화                  | session record에 `backgroundTasks` / `backgroundTaskEvents` / `nextFireAt` 저장·resume 복원                                                                        |
| 명령 등록 표면          | `packages/agent-cli/src/startup/command-setup.ts` + `packages/agent-command/` (ICommandModule)                                                                     |

### 빠진 것 ❌ (이 기능의 gap)

1. **wake 이벤트 → 에이전트 턴 주입**: `background_task_waking`을 소비해 `pendingPrompt`에 비-사용자 턴을 넣는 producer가 없다. 현재 scheduled task는 shell `command`만 재실행할 뿐 에이전트는 깨어나지 않는다.
2. **wake 지시를 담는 요청 모델**: 백그라운드 task가 shell command 대신/외에 "에이전트 지시(instruction)"를 carry하는 변형이 없다.
3. **monitor primitive**: 출력 매칭 라인을 wake 이벤트로 바꾸는 in-process monitor 추상이 없다.
4. **사용자 표면**: `/schedule`, `/loop`, monitor 명령이 없다.
5. **크로스 프로세스**: CLI가 꺼져 있을 때의 wake는 유실된다 (OS scheduler / daemon 미존재).

### 핵심 주입 지점

`SessionExecutionController`의 `pendingPrompt` + `drainPendingQueue()`가 유일한 재진입 메커니즘. wake 이벤트 리스너가 여기에 "비-사용자 턴"을 enqueue하면 현재 턴 종료 후 자동 재진입한다. 이것이 가장 작은 surface로 루프를 닫는 길.

## 4. 설계 결론 — 6계층 분해 (사용자 지시, 2026-06-13)

in-process 기능을 계층(core→sessions→sdk→cli)별로 쌓는 6개 백로그로 분해. 각 층은 독립 PR이며 이전 층 위에 쌓인다. L1+L2만으로 "예약 wakeup이 에이전트를 깨운다"는 핵심 가치 동작.

| 층  | 백로그       | 패키지                   | 범위                                                                                                                              | 의존  |
| --- | ------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----- |
| L1  | [[FLOW-001]] | agent-executor           | wake-event 기초: `agentInstruction` 모델, runner가 instruction 실은 wake emit, manager가 `background_task_waking` 전파(현재 삼킴) | —     |
| L2  | FLOW-002     | agent-framework          | 세션 wake 주입: manager wake 소비 → 실행 컨트롤러 pending 큐로 비-사용자 턴 주입 + 큐/coalesce                                    | L1    |
| L3  | FLOW-003     | agent-framework          | resume re-arm + missed-wake 표시                                                                                                  | L2    |
| L4  | FLOW-004     | agent-executor/framework | monitor: 프로세스 출력 매칭 → wake(매칭 라인 context)                                                                             | L1·L2 |
| L5  | FLOW-005     | agent-cli/command        | `/schedule`·monitor 명령 표면                                                                                                     | L2·L4 |
| L6  | FLOW-006     | agent-transport          | TUI agent-wake 태스크 라벨링                                                                                                      | L2    |

- 지속성 계약: wake instruction + nextFireAt은 반드시 체크포인트 → 재시작 시 re-arm (session record가 이미 지원, L3에서 활용).
- **에픽 밖 (별도 미래 스펙)**: OS scheduler 크로스 프로세스 routines, 장기 daemon (DBOS/Temporal durable-execution). 호스트 종료 후 생존이 필요할 때.

## 5. 부수 발견 — 타이밍 플레이크 (→ BEHAVIOR-003)

리서치 중 `pnpm harness:verify:release`에서 `scheduled-task-runner.test.ts`가 간헐 실패: `nextFireAt`(croner의 whole-second 경계, 예 `…320000`)이 베이스라인(`…320188`, 초 중간에 캡처)보다 작아 `toBeGreaterThan` 실패. 재실행 시 6/6 통과. wall-clock 초 내 위치에 의존하는 fragile assertion. 별도 백로그 [[BEHAVIOR-003]]로 분리 — 고정 시계(fake timers)로 결정화하고, 런타임이 과거 nextFireAt을 방출할 수 있는지 root cause 확인 후 필요 시 런타임도 수정.
