---
title: 'BGTASK-001: ManagedShellProcessRunner를 agent-runtime으로 이동 + ScheduledTaskRunner 신규 추가'
status: backlog
created: 2026-05-14
priority: high
urgency: later
area: agent-runtime, agent-cli
---

## 레이어 위반 내용

`ManagedShellProcessRunner`(shell 프로세스 실행 구현체)가 `agent-cli/src/background/`에 위치한다.

```
현재 (잘못된 구조)
agent-cli
  └── background/managed-shell-process-runner.ts  ← IBackgroundTaskRunner 구현체

올바른 구조
agent-runtime
  └── background-tasks/runners/managed-shell-process-runner.ts  ← 인터페이스와 같은 패키지
```

**근거**: `IBackgroundTaskRunner` 인터페이스, `IBackgroundTaskManager`, 상태머신, watchdog이 모두
`agent-runtime`에 있다. 구현체도 인터페이스와 같은 패키지에 있어야 한다.
`ManagedShellProcessRunner`의 모든 import(`BackgroundTaskError`, `IBackgroundTaskHandle` 등)는
이미 `agent-runtime` 타입이다 — 의존성 이동 비용 없음.

> CLI 종료 시 자식 프로세스가 종료되는 것은 의도된 동작이다. 프로세스 영속성(daemon mode)은
> 이 작업의 범위가 아니다. 목표는 구현체를 올바른 레이어로 이동하는 것이다.

## 기능 요구사항

레이어 이동과 함께 CLI 세션 수명 안에서 다음 태스크 타입을 `agent-runtime` 레벨에서 지원한다.

| 타입          | 예시                         | 설명                                        |
| ------------- | ---------------------------- | ------------------------------------------- |
| **Process**   | `node server.js`, `pnpm dev` | shell 프로세스 (현재 지원, 레이어만 잘못됨) |
| **Scheduled** | `*/5 * * * * pnpm test`      | cron 표현식 기반 주기 실행                  |

## 이동 및 확장 범위

### A. `ManagedShellProcessRunner` → `agent-runtime`

```
이동 전: packages/agent-cli/src/background/managed-shell-process-runner.ts
이동 후: packages/agent-runtime/src/background-tasks/runners/managed-shell-process-runner.ts
```

- `agent-runtime/index.ts`에서 `createManagedShellProcessRunner` export
- `agent-cli/cli.ts`는 `@robota-sdk/agent-runtime`에서 import로 변경
- `agent-cli/src/background/` 디렉터리 삭제

### B. `ScheduledTaskRunner` → `agent-runtime` 신규 추가

```
신규: packages/agent-runtime/src/background-tasks/runners/scheduled-task-runner.ts
```

- cron 표현식 파싱 및 스케줄 관리 (라이브러리 선정 필요 → 리서치 R-1)
- `TBackgroundTaskKind`에 `'scheduled'` 추가
- `TBackgroundTaskStatus`에 `'sleeping'`(다음 실행 대기) 추가

### C. `agent-runtime` 기본 runner 번들 팩토리

```typescript
// agent-runtime이 제공
export function createDefaultBackgroundTaskRunners(): IBackgroundTaskRunner[] {
  return [createManagedShellProcessRunner(), createScheduledTaskRunner()];
}
```

`agent-cli`는 이것을 가져다 쓰면 된다.

## 리서치 과제

### R-1: cron 라이브러리 선정

`node-cron`, `croner`, `cron-parser` 중 ESM + 경량 + time zone 처리 가능한 것 선정.
`agent-runtime` 번들 사이즈 영향 검토. `agent-runtime`의 현재 의존성 정책 확인.

### R-2: `ScheduledTaskRunner` 실행 단위

스케줄 fire 시 `IBackgroundTaskManager.spawn()` 재귀 호출 vs 직접 실행.
내부 순환 참조 위험 확인.

## 수용 기준

- [ ] `ManagedShellProcessRunner`가 `agent-runtime`에서 export
- [ ] `agent-cli/src/background/` 디렉터리 삭제
- [ ] `ScheduledTaskRunner`가 `agent-runtime`에 구현되어 cron 표현식으로 프로세스 주기 실행
- [ ] TUI에서 scheduled 태스크의 `sleeping` 상태 및 다음 실행 시각 표시
- [ ] `pnpm typecheck && pnpm lint && pnpm test` 전 범위 통과

## Test Plan

- Unit: `ManagedShellProcessRunner` 이동 후 기존 테스트 동일 통과
- Unit: `ScheduledTaskRunner` — cron 파싱, next-fire 계산, fire 시 process spawn 확인
- Unit: `createDefaultBackgroundTaskRunners()` — 두 runner 모두 포함
- Integration: `agent-cli`가 `agent-runtime`의 runner를 사용해 process 태스크 정상 실행
- Lint: `agent-cli`에 `managed-shell-process-runner` 자체 구현 없음

## User Execution Test Scenarios

### 시나리오 1 — Process 태스크 (레이어 이동 후 기존 동작 유지)

**전제 조건**: Robota CLI 실행 가능

1. Robota CLI에서 백그라운드 process 태스크 실행 (예: `echo hello`)
2. TUI에서 태스크 `completed` 상태 확인
3. 태스크 로그에서 `hello` 출력 확인

**예상 결과**: 이동 전과 동일하게 동작

**증거 필드**: (구현 후 기록)

### 시나리오 2 — Scheduled 태스크

**전제 조건**: Robota CLI 실행 중

1. cron `* * * * *`으로 `date >> /tmp/robota-sched-test.txt` 등록
2. TUI에서 `sleeping` 상태 및 다음 실행 시각 표시 확인
3. 1분 대기 후 `running` → `sleeping` 전환 확인
4. `cat /tmp/robota-sched-test.txt` → 타임스탬프 기록 확인

**예상 결과**: 스케줄 자동 실행, 상태 전환 표시

**증거 필드**: (구현 후 기록)

## 의존 관계

- [[MULTI-001]] — TUI 멀티플렉서로 태스크 전환 기능
- [[ARCH-FIX-020]] — subagent runner 이동과 같은 계열, 함께 진행 권장
