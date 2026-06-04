---
title: 'CLI-B09: TUI 사용자 표시 컨트랙트 테스트 누락 — ARCH-003 회귀 재발 방지'
status: done
created: 2026-05-31
priority: critical
urgency: now
area: packages/agent-transport
depends_on: [CLI-B05, CLI-B06, CLI-B07, CLI-B08]
---

## 왜 이 버그들이 사전에 방지되지 못했는가

### 직접 원인: 두 레이어의 혼동

INFRA-001에서 추가한 `TuiInteractionChannel.lifecycle.test.ts`는 **메커니즘 레이어**를 검증했다:

> "이벤트가 내부 상태 필드(`streamingText`, `contextState`, `activeTools`)를 올바르게 조작하는가"

그러나 사용자가 실제로 보는 것을 정의하는 **표시 컨트랙트 레이어**는 검증하지 않았다:

> "이벤트 발생 후 `stateManager.history`에 올바른 role의 entry가 존재하는가"

이 두 레이어의 차이가 CLI-B05~B08을 전부 통과시켰다.

### 간접 원인: 표시 컨트랙트 테스트가 ARCH-003에서 삭제되고 재작성되지 않음

ARCH-003이 `useInteractiveSession` 훅을 `TuiInteractionChannel`로 대체하면서 훅이 보장하던 표시 동작 테스트를 함께 삭제했다. INFRA-001은 생명주기 연결(start/stop, onChange 전파)에 집중했지만, 기존 훅이 암묵적으로 보장하던 다음 컨트랙트들을 재검증하는 테스트를 작성하지 않았다.

### B2 테스트의 맹점

INFRA-001의 B2 테스트조차 `getFullHistory` mock을 수동으로 주입해서 `complete → syncHistory` 경로를 우회했다. 이 때문에 `user_message` 핸들러가 실제로 history를 건드리지 않는다는 사실이 드러나지 않았다.

## 누락된 표시 컨트랙트 (공식화해야 할 테스트 목록)

| 시나리오                                          | 검증 조건                                                                    | 잡히는 버그            |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------- |
| `user_message('hello')` 이벤트 직후 (complete 전) | `history[0].role === 'user'`, `text === 'hello'`                             | CLI-B05                |
| `complete(result)` 후                             | `history`에 `role === 'assistant'` entry 포함                                | —                      |
| `error()` 후                                      | `history`에 오류 entry 포함 (role 'system' 또는 'error')                     | CLI-B06                |
| `tool_end(state)` 후                              | `activeTools`에 `isRunning: false` 항목 없음 OR `complete` 후 배열 완전 비움 | CLI-B07                |
| abort 경로: `thinking(false)` 후 `complete` 없음  | `activeTools === []`                                                         | CLI-B08                |
| 전체 대화 흐름: submit → text_delta → complete    | `history`에 user entry + assistant entry 순서대로 포함                       | CLI-B05 + CLI-B02 복합 |

## 해결 방향

새 테스트 파일 `TuiInteractionChannel.display-contract.test.ts` 추가.

기존 `TuiInteractionChannel.lifecycle.test.ts`와의 분리 이유:

- lifecycle 테스트: 이벤트 라우팅/onChange 전파/stop 경계 (메커니즘)
- **display-contract 테스트: 사용자에게 보이는 상태 (표시 컨트랙트)**

### 설계 원칙

1. **mock 주입 금지**: `getFullHistory` mock을 수동 주입하지 않는다. 실제 이벤트 발화 → 실제 stateManager 상태 변화만 검증한다.
2. **role 검증 필수**: history entry의 role(`user`, `assistant`, `system`/`error`)을 반드시 assert한다.
3. **타이밍 검증**: `complete` 전에도 user 메시지가 즉시 history에 있어야 한다.
4. **오류 가시성**: `error` 이벤트 후 화면에 빈 상태가 아닌 오류 내용이 있어야 한다.

## Done gate

- [ ] `TuiInteractionChannel.display-contract.test.ts` 신규 작성
- [ ] 표의 6개 시나리오 모두 테스트로 작성 및 통과
- [ ] CLI-B05, B06, B07, B08 수정 후 해당 테스트도 모두 통과
- [ ] `pnpm --filter @robota-sdk/agent-transport test` 전체 통과
- [ ] `pnpm --filter @robota-sdk/agent-transport typecheck` 통과

## User Execution Test Scenarios

이 백로그는 테스트 코드 추가이므로 별도의 수동 실행 시나리오 없음. 테스트 자체가 재발 방지 증거다.

---

## 재발 방지 원칙 (향후 인터페이스 변경 시 체크리스트)

1. TUI 레이어에서 `IInteractionChannel` 구현체를 교체하거나 이벤트 핸들러를 변경할 때:
   - `display-contract` 테스트를 먼저 실행해 모두 통과하는지 확인
   - 통과하지 않으면 인터페이스 변경을 배포하지 않는다
2. 새 세션 이벤트가 `wireSessionEvents()`에 추가될 때:
   - 해당 이벤트가 `history` / `activeTools` / `streamingText` 중 어느 것을 변경하는지 문서화
   - 해당 변화를 검증하는 display-contract 테스트를 함께 추가
