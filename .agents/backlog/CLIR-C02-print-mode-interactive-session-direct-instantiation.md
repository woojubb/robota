---
title: 'CLIR-C02: print-mode.ts — new InteractiveSession() 직접 생성으로 IAgentRuntime 추상화 우회'
status: todo
created: 2026-05-17
priority: critical
urgency: soon
area: packages/agent-cli, packages/agent-framework
---

## 배경

코드리뷰 보고서: `.design/agent-cli-review-2026-05-17.html` #C-02

`packages/agent-cli/src/modes/print-mode.ts:50`에서 `runPrintMode`가
`new InteractiveSession({ ... })`을 직접 호출하여 세션을 생성한다.

```typescript
// print-mode.ts:50
const session = new InteractiveSession({
  cwd: runtime.cwd,
  // ... runtime 필드를 꺼내 직접 넘김
});
```

`cli.ts`는 `createAgentRuntime()`으로 `IAgentRuntime`을 조립한 뒤 이를 `runPrintMode`에 주입하지만,
`runPrintMode` 내부에서는 전달받은 `runtime`의 필드를 꺼내 `InteractiveSession` 생성자에 직접 넘긴다.

결과적으로:

1. `IAgentRuntime` 추상화가 무의미해진다.
2. print-mode가 `createAgentRuntime`이 계산한 기본값을 신뢰하지 않고 런타임 조립을 부분적으로 재수행한다.
3. `tui-mode.ts`와 print-mode.ts가 서로 다른 세션 생성 경로를 사용하여 일관성이 깨진다.

## 문제 상세

현재 tui-mode는 `InteractiveSession`을 `TuiTransport` 내부에서 생성하는 방식이라
tui-mode도 직접 `InteractiveSession`에 접근하는 구조다. 그러나 print-mode가 직접
`new InteractiveSession`을 호출하는 것은 "CLI가 IAgentRuntime을 통해 세션 팩토리를 호출해야 한다"는
원칙에 어긋난다.

## 규칙 참조

- `code-quality.md` — "CLI/TUI command thinness. agent-cli may not own command-specific state machines or setup flows."
- `agent-framework SPEC` — "creates InteractiveSession({ cwd, provider, commandModules }) ... subscribes to events → renders to terminal"

## 권장 조치

**옵션 A (선호):** `IAgentRuntime`에 `createSession(opts)` 팩토리 메서드를 추가한다.
`runPrintMode`는 세션을 직접 구성하는 대신 `runtime.createSession(opts)`를 호출한다.

**옵션 B:** `agent-framework`의 `InteractiveSession` 생성자가 `IAgentRuntime`을 직접 받도록
오버로드를 제공한다.

구현 전 **설계 컨펌 필요**.

## Test Plan

- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 0 errors
- [ ] `grep -n "new InteractiveSession" packages/agent-cli/src/modes/print-mode.ts` — 결과 없음
- [ ] `pnpm --filter @robota-sdk/agent-cli test` 전체 통과
- [ ] print-mode와 tui-mode가 동일한 `IAgentRuntime` 팩토리 경로를 통해 세션을 생성함을 확인

## User Execution Test Scenarios

### Scenario 1 — print 모드 기본 동작 확인

**Prerequisites**: `pnpm build`, API 키 설정 완료

**Steps**:

```bash
echo "What is 1+1?" | robota --print
```

**Expected**: AI 응답이 stdout에 출력되고 정상 종료 (exit 0).
리팩토링 전과 동일한 응답 형식.

**Evidence**: (구현 후 채울 것)

**Cleanup**: 없음 (단발 실행)

### Scenario 2 — TUI 모드와 동일한 세션 생성 경로 사용 확인

**Prerequisites**: `pnpm build`

**Steps**:

```bash
# print 모드
echo "hello" | robota --print
# TUI 모드
robota
```

**Expected**: 두 모드 모두 동일한 `IAgentRuntime` 기반으로 세션이 생성되어
동일한 설정(backgroundTaskRunners, commandModules 등)이 적용됨.

**Evidence**: (구현 후 채울 것)
