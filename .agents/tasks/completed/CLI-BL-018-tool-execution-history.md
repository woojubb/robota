---
title: Tool Execution History — 개별 도구 실행을 히스토리에 기록
status: backlog
priority: high
urgency: now
created: 2026-03-27
packages:
  - agent-sdk
  - agent-cli
---

## 요약

스트리밍 중 개별 tool 실행(start/end)이 히스토리에 기록되지 않음. 현재는 실행 완료 시 `pushToolSummaryMessage()`로 한꺼번에 요약만 기록. 개별 실행 기록이 없어서 resume 시 어떤 도구가 언제 실행됐는지 알 수 없음.

## 현재 동작

1. tool_start → `activeTools`에 push (메모리만)
2. tool_end → `activeTools`에서 업데이트 (메모리만)
3. 실행 완료 → `pushToolSummaryMessage()` → 요약을 `IHistoryEntry`로 히스토리에 1회 기록

## 문제

- 개별 tool 실행 타임라인이 없음
- 같은 도구가 여러 번 호출되면 구분 불가 (firstArg 잘림)
- resume 시 tool 실행 순서/결과를 복원할 수 없음

## 해결

각 tool_start/tool_end를 개별 `IHistoryEntry`로 히스토리에 기록:

```typescript
// tool_start 시
this.history.push({
  id: randomUUID(),
  timestamp: new Date(),
  category: 'event',
  type: 'tool-start',
  data: { toolName, firstArg, isRunning: true },
});

// tool_end 시
this.history.push({
  id: randomUUID(),
  timestamp: new Date(),
  category: 'event',
  type: 'tool-end',
  data: { toolName, firstArg, isRunning: false, result },
});
```

기존 `pushToolSummaryMessage()` (tool-summary)는 유지 — 최종 요약으로 사용.
