---
title: Tool 실행 결과 합산 시 context overflow 방지
status: backlog
priority: high
created: 2026-03-22
packages:
  - agent-core
  - agent-sessions
---

# Tool 실행 결과 합산 시 Context Overflow 방지

## 문제

AI가 10~20개 tool을 한번에 요청하면, 모든 tool result가 히스토리에 추가된 후 다음 라운드에서야 context 체크가 발생. 이 시점에 이미 context가 100%를 초과하여 provider call이 실패하거나 응답을 못 받음.

현재 pre-send check는 provider call 직전에만 동작 → tool result 대량 추가로 인한 overflow를 잡지 못함.

## 재현 시나리오

```
User: "난 아직도 뭘해야 할지 모르겠어."
→ AI가 10개 tool 실행 요청 (Bash, Read 등)
→ 10개 tool result 전부 히스토리에 추가
→ context 100% 초과
→ "No response received. The context window may be full"
```

## 해결 방안 (2가지)

### 방안 A: Tool result 합산 중 context 예측 → compact 후 전송

- Tool result를 히스토리에 추가할 때마다 context 크기를 누적 추정
- 임계값 초과 시 provider call 전에 자동 compact 실행
- Compact된 히스토리 + 최근 tool result로 provider call
- **장점**: 모든 tool result가 보존됨 (요약 형태)
- **단점**: compact 자체가 provider call을 필요로 함 → 추가 비용

### 방안 B: Tool result 합산 중 임계값 초과 시 나머지 tool 스킵

- Tool result를 히스토리에 추가할 때마다 context 크기를 누적 추정
- 임계값 초과 시 나머지 tool 실행을 중단
- 이미 수집된 결과만으로 provider call 진행
- 스킵된 tool에 대해 "context limit reached, skipped" 결과 반환
- **장점**: 단순, 추가 비용 없음
- **단점**: 일부 tool result 손실

## 관련 코드

- `packages/agent-core/src/services/execution-round.ts` — executeAndRecordToolCalls, addToolResultsToHistory
- `packages/agent-core/src/services/tool-execution-service.ts` — executeTools (parallel batch)
- `packages/agent-sessions/src/session.ts` — compact(), run()
- `packages/agent-sessions/src/context-window-tracker.ts` — token tracking

## Claude Code 참고

Claude Code는 모든 tool result를 무조건 수집 후 ~95%에서 사후 compact. 이로 인해 대량 tool output 시 overflow → compact 실패까지 발생하는 알려진 버그가 있음 (issues #12054, #11155).

## 추천: Permission deny 패턴 재활용 (방안 C)

기존 permission deny 시 AI에게 "Permission denied" 결과를 반환하고 AI가 대응하는 구조가 이미 있음. Context overflow도 동일 패턴:

1. Tool result를 히스토리에 추가할 때마다 context 크기를 누적 추정
2. 임계값 초과 시 **남은 tool 실행을 cancel** (실행 자체를 하지 않음)
3. Cancel된 tool에 대해 `"Error: Context window near capacity. Tool execution skipped. Use /compact to free space."` 결과 반환
4. AI가 이 결과를 보고 스스로 `/compact` 요청하거나 접근 방식 변경

**장점:**
- 기존 permission deny 인프라 그대로 활용
- 추가 API call(compact) 비용 없음
- AI가 상황을 인지하고 자율적으로 대응 (compact, 작업 축소 등)
- 구현이 단순함

**기존 방안 대비:**
- 방안 A(auto-compact): compact에 추가 API call 필요, 복잡
- 방안 B(단순 스킵): AI가 이유를 모름 → 방안 C는 이유를 알려줌

## 구현 포인트

- `addToolResultsToHistory` 또는 `executeAndRecordToolCalls`에서 각 tool result 추가 후 context 크기 추정
- 임계값 초과 시 나머지 tool 실행을 skip하고 error result 반환
- PermissionEnforcer의 deny 결과 반환 패턴 참고
- system prompt에 "context overflow로 tool이 skip되면 /compact 후 재시도" 안내 추가
