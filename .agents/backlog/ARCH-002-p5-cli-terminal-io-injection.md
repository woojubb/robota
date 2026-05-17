---
title: 'ARCH-002-p5: agent-cli 터미널 I/O 직접 호출 분리 — process.* 누수 제거'
status: in-progress
created: 2026-05-17
priority: high
urgency: now
area: packages/agent-cli
---

# ARCH-002-p5 — agent-cli 터미널 I/O 직접 호출 분리

## Context

ARCH-002 기준("UI는 TUI에, 로직은 UI 없이도 동작")으로 Phase 2~4 완료 후 남은 위반 4건.
utils/ 레이어가 `process.stdout.write` / `process.stderr.write` / `process.exit` / `process.stdin.isTTY`를
직접 호출하고 있어 비-터미널 환경(헤드리스, 스크립트, 테스트)에서 재사용이 불가능하다.

## Violations

### 1. `utils/cli-args.ts` — 검증 함수가 process.exit 직접 호출

`parseOutputFormat`, `parsePermissionMode`, `parseMaxTurns`가 유효하지 않은 값을 받으면
`process.stderr.write()` + `process.exit(1)`을 직접 호출한다.
`printHelp()`는 `process.stdout.write()`로 출력한다.

- **위반 이유**: 순수 파싱/검증 함수가 프로세스를 종료하면 caller가 에러를 처리할 수 없고
  headless/scripted 환경에서 재사용이 불가능하다.
- **수정**: `parse*()` 함수는 throw로 교체한다. caller(`cli.ts`)에서 catch → 출력 + exit 처리.
  `printHelp()`는 `terminal: ITerminalOutput` 파라미터 또는 문자열 반환으로 교체.

### 2. `utils/provider-setup.ts` — 설정 로직에 출력 혼재

`handleProviderConfigurationArgs` (L45, L54), `runInteractiveProviderSetup` (L110)에서
`process.stdout.write()` 직접 호출. `isInteractiveTerminal()` (L166)이 `process.stdin.isTTY` 직접 참조.

- **위반 이유**: 이 함수들은 `ITerminalOutput` 인터페이스가 이미 있음에도 사용하지 않는다.
  설정 저장·스위치 결과 메시지가 caller가 아닌 로직 내부에서 출력된다.
- **수정**: `handleProviderConfigurationArgs`, `runInteractiveProviderSetup`에
  `terminal: ITerminalOutput` 파라미터 추가. `isInteractiveTerminal()`을 독립 유틸로 분리.

### 3. `cli.ts` — `promptInput()` 내부 정의 (raw terminal)

L119~167에 `process.stdin.setRawMode`, `process.stdout.write`, `process.exit(0)` 등
raw terminal 코드가 `cli.ts` 안에 인라인 정의되어 있다.

- **위반 이유**: `cli.ts`는 composition root여야 하는데 raw terminal 처리 로직을 직접 포함한다.
- **수정**: `utils/cli-input.ts`로 추출, `cli.ts`에서 import해서 사용.

### 4. `user-local-direct-command.ts` — 실행 결과를 직접 출력

L20~24에서 명령 결과를 `process.stdout.write` / `process.stderr.write`로 직접 출력 후
`process.exit(1)` 호출.

- **위반 이유**: 명령 실행 결과가 caller에게 반환되지 않아 programmatic 사용 불가.
- **수정**: `terminal: ITerminalOutput` 파라미터 수용 또는 결과 반환 후 `cli.ts`에서 출력.

## Acceptance Criteria

- `utils/cli-args.ts`의 `parse*()` 함수가 `process.exit`을 호출하지 않는다.
- `utils/provider-setup.ts`의 `handleProviderConfigurationArgs`, `runInteractiveProviderSetup`이
  `process.stdout.write`를 직접 호출하지 않는다.
- `cli.ts`에 `process.stdin.setRawMode` 직접 호출이 없다.
- `user-local-direct-command.ts`에 `process.stdout.write` / `process.stderr.write` 직접 호출이 없다.
- `pnpm --filter @robota-sdk/agent-cli typecheck` 통과.
- `pnpm --filter @robota-sdk/agent-cli test` 111개 테스트 전부 통과.

## Test Plan

- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 에러 없음
- [ ] `pnpm --filter @robota-sdk/agent-cli test` 전체 통과
- [ ] `grep -n "process\.stdout\.write\|process\.stderr\.write\|process\.exit" packages/agent-cli/src/utils/cli-args.ts` — 결과 없음
- [ ] `grep -n "process\.stdout\.write\|process\.stderr\.write" packages/agent-cli/src/utils/provider-setup.ts` — 결과 없음
- [ ] `grep -n "process\.stdin\.setRawMode\|process\.stdin\.isTTY" packages/agent-cli/src/cli.ts` — 결과 없음
- [ ] `grep -n "process\.stdout\.write\|process\.stderr\.write\|process\.exit" packages/agent-cli/src/user-local-direct-command.ts` — 결과 없음

## User Execution Test Scenarios

이 작업은 내부 리팩토링이다. 사용자 관점의 CLI 동작은 동일하게 유지되어야 한다.

### Scenario 1: 유효하지 않은 인수 에러 메시지 확인

**Prerequisites**: robota CLI 빌드 완료

**Steps**:

```bash
robota --output-format invalid-value
```

**Expected**: 에러 메시지 출력 후 non-zero exit (기존과 동일한 메시지)

**Evidence**: <!-- 구현 후 실제 출력 기록 -->

### Scenario 2: 프로바이더 설정 커맨드 동작 확인

**Prerequisites**: 기존 설정 파일 있는 환경

**Steps**:

```bash
robota --configure-provider test --type openai --model gpt-4o --set-current
```

**Expected**: `Provider profile saved to <path>` 메시지 출력 후 정상 종료

**Evidence**: <!-- 구현 후 실제 출력 기록 -->
