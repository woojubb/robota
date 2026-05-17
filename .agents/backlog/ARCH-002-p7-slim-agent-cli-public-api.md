---
title: 'ARCH-002-p7: agent-cli index.ts를 startCli 단일 export로 축소'
status: backlog
created: 2026-05-17
priority: medium
urgency: soon
area: packages/agent-cli
---

# ARCH-002-p7 — agent-cli public API 축소

## Context

ARCH-002 원칙에 따라 agent-cli는 CLI 진입점 패키지여야 한다.
현재 `src/index.ts`는 `startCli` 외에 subagent runner 구현체, isolation adapter 구현체,
그리고 이미 agent-core에 존재하는 `ITerminalOutput` / `ISpinner` 타입까지 재수출한다.

```typescript
// 현재 index.ts
export { startCli } from './cli.js';                               // ✓ 적절
export { ChildProcessSubagentRunner, ... } from './subagents/index.js'; // ✗ 구현체 노출
export type { IChildProcessSubagentRunnerOptions, ... } from './subagents/index.js'; // ✗
export type { ITerminalOutput, ISpinner } from './types.js';       // ✗ agent-core에 이미 있음
```

이 재수출들은 agent-cli를 "구현체 창고"처럼 사용하게 만든다.
ARCH-FIX-020이 subagent runner를 다른 패키지로 이동할 때, index.ts 재수출도 함께 정리해야
agent-cli의 public API가 깔끔해진다.

## Violations

### 1. subagent runner / isolation adapter 재수출

`ChildProcessSubagentRunner`, `createChildProcessSubagentRunnerFactory`,
`GitWorktreeIsolationAdapter`, `createGitWorktreeIsolationAdapter`,
`IChildProcessSubagentRunnerOptions`, `IGitWorktreeIsolationAdapterOptions`를
agent-cli에서 재수출한다.

- **위반 이유**: 이 심벌들은 ARCH-FIX-020에서 agent-framework / agent-executor로 이동 예정이다.
  agent-cli에서 재수출하면 소비자가 잘못된 경로에 의존하게 된다.
- **수정**: ARCH-FIX-020 완료 후 해당 줄 제거. 소비자는 각각의 원천 패키지에서 직접 import.

### 2. `ITerminalOutput` / `ISpinner` 재수출

`src/types.ts`를 통해 `ITerminalOutput`, `ISpinner`를 재수출하는데,
이 타입들은 이미 `@robota-sdk/agent-core`의 공식 export다.

- **위반 이유**: 동일 타입이 두 경로로 export되면 소비자가 어디서 import해야 하는지
  혼란스럽고, 타입 동일성(structural equality) 검사 오류가 발생할 수 있다.
- **수정**: `src/types.ts`에서 해당 재수출 라인 제거.
  소비자는 `@robota-sdk/agent-core`에서 직접 import.

## Acceptance Criteria

- `packages/agent-cli/src/index.ts`가 `startCli`만 export한다.
- `ITerminalOutput`, `ISpinner`의 agent-cli 재수출이 없다.
- subagent runner / isolation adapter의 agent-cli 재수출이 없다.
- `pnpm --filter @robota-sdk/agent-cli typecheck` 통과.
- `pnpm --filter @robota-sdk/agent-cli test` 전체 통과.
- agent-cli를 소비하는 다른 패키지의 typecheck도 통과.

## Dependencies

- ARCH-FIX-020 (`ChildProcessSubagentRunner`, `GitWorktreeIsolationAdapter` 이동) 선행 권장.
  단, types.ts 재수출 제거는 독립적으로 먼저 실행 가능.

## Test Plan

- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 에러 없음
- [ ] `pnpm --filter @robota-sdk/agent-cli test` 전부 통과
- [ ] `grep -n "ITerminalOutput\|ISpinner" packages/agent-cli/src/index.ts` — 결과 없음
- [ ] `grep -n "ChildProcessSubagentRunner\|GitWorktreeIsolation" packages/agent-cli/src/index.ts` — 결과 없음
- [ ] `cat packages/agent-cli/src/index.ts` — startCli export만 남아 있음

## User Execution Test Scenarios

이 작업은 내부 export 정리다. CLI 외부 소비자 행동 변화: subagent runner를 agent-cli에서
import하던 코드는 원천 패키지에서 import하도록 변경된다.

### Scenario 1: CLI 정상 동작 확인

**Prerequisites**: robota CLI 빌드 완료

**Steps**:

```bash
robota --help
```

**Expected**: help 텍스트 정상 출력, exit 0

**Evidence**: (구현 후 채움)

### Scenario 2: 소비자 패키지 빌드 확인

**Prerequisites**: agent-cli 의존 패키지 존재 (apps/agent-tui 등)

**Steps**:

```bash
pnpm typecheck
```

**Expected**: 전체 workspace typecheck 통과 — subagent runner import 경로 변경 반영

**Evidence**: (구현 후 채움)
