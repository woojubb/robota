# CLI-025: 프로바이더 핫 스왑 설계

## 배경

현재 `/model` 또는 `/provider switch` 커맨드는 CLI를 재시작한다. 재시작 시 세션 히스토리가 보존되지 않아 장기 세션에서 모델 전환이 불편하다.

## 현재 구조

```
InteractiveSession
  └── provider: IAIProvider  (생성 시 주입, 이후 불변)
      └── Session (agent-core)
          └── ConversationStore → history
```

`InteractiveSession`은 `provider`를 생성자에서 받아 `agent-core/Session` 인스턴스로 넘긴다. `Session` 내부도 provider를 불변으로 보유한다.

## 설계 방향

### Option A: InteractiveSession에 `swapProvider()` 추가 (권장)

`InteractiveSession`에 `swapProvider(newProvider: IAIProvider): void` 메서드를 추가한다.

```typescript
// packages/agent-framework/src/interactive/interactive-session.ts
swapProvider(newProvider: IAIProvider): void {
  // 1. 현재 진행 중인 generation 중단
  this.session?.abort();
  // 2. agent-core Session의 provider 교체
  this.session?.swapProvider(newProvider);
  // 3. 내부 provider 참조 업데이트
  this._provider = newProvider;
}
```

`agent-core/Session`에도 `swapProvider()` 메서드를 추가해야 한다:

```typescript
// packages/agent-core/src/session.ts
swapProvider(newProvider: IAIProvider): void {
  this.provider = newProvider;
  // history는 유지, 새 provider에 맞게 parts 필터링은 하지 않음
  // (포맷 비호환은 각 provider converter가 gracefully 처리)
}
```

**포맷 호환성:** 기존 히스토리에 vision parts가 있는데 새 provider가 vision을 지원하지 않으면, 해당 provider의 message-converter가 parts를 무시하고 text만 전달한다 (현재 fallback 동작).

**히스토리 압축(compaction):** 선택적 옵션으로 `swapProvider(provider, { compact: true })`를 통해 전환 전 히스토리를 요약할 수 있다.

### Option B: 새 Session 생성 + history 이전 (복잡)

기존 세션을 종료하고 새 Session을 만든 뒤, 히스토리를 복사하는 방식. 이벤트 핸들러/transport 재연결이 필요해 복잡도가 높다.

**→ Option A를 권장.**

## `/provider switch` UX

현재 `/provider` 커맨드는 TUI 메뉴를 연다. 헤드리스 경로에서는 목록을 출력한다.

변경: `/provider switch <profile-name>` 서브커맨드 추가.

```
/provider switch openai
→ "Switched to openai (gpt-4o). History preserved. (Turn 12)"
```

기존 `/model` 커맨드의 재시작 동작은 유지하되, `/provider switch`는 재시작 없이 동작한다.

## 영향 범위

| 파일                                                              | 변경 내용                                      |
| ----------------------------------------------------------------- | ---------------------------------------------- |
| `packages/agent-core/src/session.ts`                              | `swapProvider()` 메서드 추가                   |
| `packages/agent-framework/src/interactive/interactive-session.ts` | `swapProvider()` 메서드 추가                   |
| `packages/agent-command/src/provider/provider-switch-command.ts`  | `/provider switch` 서브커맨드 신규             |
| `packages/agent-framework/src/runtime/agent-runtime.ts`           | `IAgentRuntime`에 optional `swapProvider` 노출 |

## 리스크

- `agent-core/Session`은 현재 provider를 불변으로 설계됨 — setter 추가 시 SPEC.md 수정 필요
- `/model` 커맨드와 `/provider switch`의 동작 차이를 사용자가 혼동할 수 있음 (문서화 필요)
- 히스토리 포맷 호환성: vision parts를 가진 메시지를 vision 미지원 provider로 전환 시 parts가 조용히 drop됨 — 경고 메시지 추가 권장

## 구현 순서

1. `agent-core/Session.swapProvider()` 추가 + SPEC.md 수정
2. `InteractiveSession.swapProvider()` 추가
3. `/provider switch <name>` 커맨드 구현
4. 통합 테스트 작성
