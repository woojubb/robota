---
title: 'ARCH-FIX-020: agent-cli subagents/ 디렉터리를 agent-runtime·agent-sdk로 분산 이동'
status: done
created: 2026-05-14
completed: 2026-05-14
priority: high
urgency: later
area: agent-cli, agent-runtime, agent-sdk
related: [BGTASK-001, ARCH-FIX-021]
---

## 레이어 위반 내용

`agent-cli/src/subagents/` 6개 파일이 각자 다른 레이어의 인터페이스를 구현하면서도 CLI에 위치한다.
**각 파일의 올바른 목적지가 다르다** — 일괄 agent-sdk 이동이 아니라 파일별로 분산한다.

## 파일별 목적지 분석

| 파일                                      | 구현 인터페이스                        | 현재      | **올바른 목적지**             | 근거                                                                                  |
| ----------------------------------------- | -------------------------------------- | --------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| `git-worktree-isolation-adapter.ts`       | `ISubagentWorktreeAdapter` (agent-sdk) | agent-cli | **`agent-runtime`**           | `worktree-subagent-runner.ts`가 이미 agent-runtime에 있음                             |
| `child-process-subagent-ipc.ts`           | (IPC 프로토콜 타입)                    | agent-cli | **runner와 동행**             | 단독 의존성 없음                                                                      |
| `child-process-subagent-transport.ts`     | (process cancel/send)                  | agent-cli | **runner와 동행**             | 단독 의존성 없음                                                                      |
| `child-process-subagent-runner-result.ts` | (결과 빌더)                            | agent-cli | **runner와 동행**             | 단독 의존성 없음                                                                      |
| `child-process-subagent-runner.ts`        | `ISubagentRunner` (agent-runtime)      | agent-cli | **`agent-sdk`** ← 리서치 필요 | `getBuiltInAgent`, `IInProcessSubagentRunnerDeps` 등 SDK 레벨 의존성 보유             |
| `child-process-subagent-worker.ts`        | (fork 워커 엔트리포인트)               | agent-cli | **`agent-sdk`** ← 리서치 필요 | `createSubagentSession`(agent-sdk) 사용; `createProviderFromProfile` 의존성 해소 필요 |

### `GitWorktreeIsolationAdapter` → `agent-runtime`

```
이동 전: agent-cli/src/subagents/git-worktree-isolation-adapter.ts
이동 후: agent-runtime/src/subagents/git-worktree-isolation-adapter.ts
```

`worktree-subagent-runner.ts`(`agent-runtime`)가 `ISubagentWorktreeAdapter`를 이미 사용한다.
어댑터의 git 구현체가 같은 패키지에 있어야 응집도가 높다.
`execFileSync`(Node.js 내장)만 사용하므로 agent-runtime 의존성 정책과 충돌 없음.

### `ChildProcessSubagentRunner` → `agent-sdk`

```
이동 전: agent-cli/src/subagents/child-process-subagent-{runner,ipc,transport,result,worker}.ts
이동 후: agent-sdk/src/subagents/child-process-subagent-{runner,ipc,transport,result,worker}.ts
```

`InProcessSubagentRunner`가 `agent-sdk/src/subagents/`에 있고 동일한 `ISubagentRunner`를 구현한다.
`ChildProcessSubagentRunner`가 `getBuiltInAgent`, `IInProcessSubagentRunnerDeps` 등 SDK 레벨
심볼을 사용하므로 `agent-runtime`으로는 이동 불가 (상향 의존 발생).

## 리서치 과제

### R-1: `ChildProcessSubagentRunner`의 agent-sdk 의존성 목록 확정

현재 agent-sdk에서 import하는 심볼 중:

- `getBuiltInAgent` — agent-sdk에서만 존재. agent-runtime으로 내릴 수 있는가?
- `IInProcessSubagentRunnerDeps` — agent-sdk 레벨인가, agent-runtime으로 내릴 수 있는가?

→ 내릴 수 있다면 `agent-runtime`이 최종 목적지. 내릴 수 없다면 `agent-sdk` 확정.

### R-2: `child-process-subagent-worker.ts`의 `createProviderFromProfile` 의존성

워커는 현재 `agent-cli/utils/provider-factory.ts`의 `createProviderFromProfile`을 import한다.
ARCH-FIX-021에서 이 함수가 `agent-runtime`으로 이동될 예정이다.
워커가 agent-sdk로 이동할 때 이 의존성을 agent-runtime에서 가져올 수 있는지 확인.

### R-3: `agent-sdk`의 `subagents/` 노출 범위 결정

`ChildProcessSubagentRunner`를 agent-sdk로 이동하면 agent-sdk의 index.ts에서 어디까지 export할지,
또는 내부 구현체로 두고 `createChildProcessSubagentRunnerFactory`만 노출할지 결정 필요.

## 의존성 해소 필요 사항

### W-1: `child-process-subagent-worker.ts` → `ITerminalOutput`

워커는 `agent-cli/types.ts`의 `ITerminalOutput`을 import한다.
ARCH-FIX-005 완료 후 agent-sdk에서 가져오도록 변경.

### W-2: `agent-cli/index.ts` re-export 제거

```typescript
// 제거 대상
export { ChildProcessSubagentRunner, createChildProcessSubagentRunnerFactory, ... }
export { GitWorktreeIsolationAdapter, createGitWorktreeIsolationAdapter, ... }
```

## 수용 기준

- [ ] `GitWorktreeIsolationAdapter`가 `agent-runtime/src/subagents/`에 위치
- [ ] `ChildProcessSubagentRunner`(+관련 파일 4개)가 `agent-sdk/src/subagents/`에 위치
      _(R-1 결과에 따라 agent-runtime으로 변경 가능)_
- [ ] `agent-sdk/index.ts`에서 `createChildProcessSubagentRunnerFactory` export
- [ ] `agent-cli/src/subagents/` 디렉터리 삭제
- [ ] `agent-cli/index.ts`에 subagent runner re-export 없음
- [ ] `pnpm typecheck && pnpm lint && pnpm test` 전 범위 통과

## Test Plan

- Unit: `GitWorktreeIsolationAdapter` 기존 테스트 동일 통과 (agent-runtime에서)
- Unit: `ChildProcessSubagentRunner` 기존 테스트 동일 통과 (agent-sdk에서)
- Integration: CLI에서 child-process subagent runner 동작 확인 (regression 없음)
- Lint: `agent-cli`에 `child-process-subagent` 파일 없음

## User Execution Test Scenarios

### 시나리오 1 — Subagent 실행 regression 없음

**전제 조건**: Robota CLI 실행 중, subagent 실행 가능

1. subagent를 spawn하는 작업 실행
2. child process로 실행 및 TUI에서 진행 상태 확인
3. 완료 후 결과가 main 세션에 반영 확인

**예상 결과**: 이동 전과 동일한 동작

**증거 필드**: 모든 unit test 통과 (agent-runtime: 67 tests, agent-sdk: 757 tests, agent-cli: 142 tests). pnpm typecheck 0 errors, pnpm lint 0 errors. git-worktree-isolation-adapter → agent-runtime, child-process-subagent-{ipc,transport,runner-result,runner} → agent-sdk 이동 완료. worker는 CLI fork 엔트리포인트로 agent-cli 잔류 (DEFAULT_PROVIDER_DEFINITIONS CLI-specific 의존).

## 의존 관계

- [[BGTASK-001]] — ManagedShellProcessRunner 이동과 같은 계열
- [[ARCH-FIX-021]] — createProviderFromProfile(agent-runtime 이동) 선행 필요 (W-2)
- ARCH-FIX-005 (ITerminalOutput SSOT) — W-1 해소 선행 조건
