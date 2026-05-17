---
title: 'CLIR-M02: TTY 인터랙티브 검출이 startup 모듈 내부에 인라인 하드코딩'
status: todo
created: 2026-05-17
priority: medium
urgency: later
area: packages/agent-cli
---

## 배경

코드리뷰 보고서: `.design/agent-cli-review-2026-05-17.html` #M-02

`packages/agent-cli/src/startup/provider-startup.ts:68`에서 `ensureConfig` 함수가
`ensureProviderConfig`에 아래를 전달한다:

```typescript
isInteractive: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
```

또한 `print-mode.ts:15`에도 다음과 같은 별도의 TTY 감지가 있다:

```typescript
if (!prompt && !process.stdin.isTTY) {
```

## 문제 상세

1. **테스트 취약성**: `ensureConfig`를 단위 테스트할 때 TTY 상태를 제어하려면
   `Object.defineProperty(process.stdout, 'isTTY', ...)` 방식을 사용해야 한다.
   이는 취약한 환경 조작 방식이다.

2. **불일치**: `provider-startup.ts`는 `stdin && stdout` 모두 TTY임을 확인하는 반면,
   `print-mode.ts`는 `stdin`만 확인한다. 두 TTY 검출 방식이 일관된 추상화 없이 분산되어 있다.

3. **재사용 불가**: 실제 환경과 다른 스트림(예: HTTP 서버에서 CLI 기능을 재사용)에서 오작동한다.

## 권장 조치

`cli.ts` 진입점에서 `process.stdin.isTTY`와 `process.stdout.isTTY`를 읽어
`ITerminalEnvironment` 또는 `{ isInteractive: boolean, hasStdinData: boolean }` 객체로 만들고,
이를 startup 모듈들에 주입한다.

startup 모듈들은 `process.stdin/stdout`을 직접 참조하지 않고 주입된 값을 사용한다.

## Test Plan

- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 0 errors
- [ ] `pnpm --filter @robota-sdk/agent-cli test` 전체 통과
- [ ] `grep -rn "process\.stdin\.isTTY\|process\.stdout\.isTTY" packages/agent-cli/src/startup/` — 결과 없음
- [ ] `grep -n "process\.stdin\.isTTY" packages/agent-cli/src/modes/print-mode.ts` — 결과 없음
- [ ] TTY 상태를 목(mock)으로 교체하는 테스트가 `Object.defineProperty` 없이 동작함을 확인

## User Execution Test Scenarios

### Scenario 1 — 비-TTY 환경(pipe)에서 provider setup 건너뜀 확인

**Prerequisites**: `pnpm build`, provider 미설정 환경

**Steps**:

```bash
echo "hello" | robota --print
```

**Expected**: 비-TTY(pipe) 환경에서 interactive provider setup이 실행되지 않음.
리팩토링 전과 동일한 동작.

**Evidence**: (구현 후 채울 것)

### Scenario 2 — TTY 환경에서 interactive provider setup 실행 확인

**Prerequisites**: `pnpm build`, provider 미설정 환경, TTY 터미널

**Steps**:

```bash
robota
```

**Expected**: TTY 환경에서 interactive provider 선택 프롬프트가 표시됨.
기존과 동일한 동작.

**Evidence**: (구현 후 채울 것)

**Cleanup**: 세션 종료 (Ctrl+C)
