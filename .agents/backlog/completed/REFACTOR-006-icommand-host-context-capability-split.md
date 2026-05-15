---
title: 'REFACTOR-006: ICommandHostContext capability sub-interfaces 분리'
status: backlog
created: 2026-05-15
priority: high
urgency: soon
area: packages/agent-sdk, packages/agent-command-agent
---

## Problem

**문제 1 — ICommandHostContext optional 멤버 10개:**
`packages/agent-sdk/src/command-api/host-context.ts:75–113`에서 20개 메서드 중 10개가 optional(`?:`). command module이 핵심 기능을 `?.` 없이 안전하게 호출할 수 없어 인터페이스가 보증하는 것이 없는 상태다.

```ts
clearConversationHistory?(): void;
validateCurrentSessionReplayLog?(): boolean;
getAutoCompactThresholdSource?(): ...;
// ... 10개
```

**문제 2 — agent-command-agent의 as unknown as 캐스트:**
`packages/agent-command-agent/src/agent-command-module.ts:12`의 `asAgentHostContext()` 헬퍼가 `context as unknown as IAgentJobHostContext`를 수행한다. `InteractiveSession`이 런타임에 `IAgentJobHostContext`를 구현하지만 타입 시스템이 이를 알지 못한다.

Rule violation: Interface contracts should guarantee what is available. `as unknown as` in production code.

Source: COMBINED-006 (SD-003, SD-004)

## Scope

1. `ICommandHostContext`를 required base + optional capability interfaces로 분리:
   - `ICommandHostContext` — 모든 command module이 의존하는 required 메서드만
   - `ICompactCapable` — `getAutoCompactThreshold`, `setAutoCompactThreshold`
   - `IContextReferenceCapable` — `listContextReferences`, `addContextReference`, `removeContextReference`, `clearContextReferences`
   - `ICheckpointCapable` — `inspectEditCheckpoint`, `listEditCheckpoints`
   - `IAgentJobHostContext` — agent job 관련 (현재 정의 유지)

2. `ICommandHostContext`에 `getCapabilities?(): { agentJob?: IAgentJobHostContext; compact?: ICompactCapable; ... }` 또는 개별 capability getter 추가로 `as unknown as` 없이 접근 가능하게.

3. `agent-command-agent/src/agent-command-module.ts`에서 `as unknown as IAgentJobHostContext` 제거.

4. 각 command module이 필요한 capability interface만 선언.

구현 전 설계안 사용자 컨펌 필요.

## Test Plan

- `pnpm typecheck` — 전체 통과
- `pnpm --filter @robota-sdk/agent-sdk test` — 통과
- `pnpm --filter @robota-sdk/agent-command-agent test` — 통과
- `grep -r "as unknown as IAgentJobHostContext" packages --include="*.ts"` — 결과 없음 (프로덕션 파일)
- `pnpm build` — 전체 통과

## User Execution Test Scenarios

Not applicable — 내부 타입 계약 재구성이며 사용자 관찰 가능한 command 동작 변화 없음.
