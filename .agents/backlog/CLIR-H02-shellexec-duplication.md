---
title: 'CLIR-H02: shellExec 클로저 중복 — print-mode와 tui-mode에 동일 코드 분리'
status: todo
created: 2026-05-17
priority: high
urgency: soon
area: packages/agent-cli
---

## 배경

코드리뷰 보고서: `.design/agent-cli-review-2026-05-17.html` #H-02

`SHELL_EXEC_TIMEOUT_MS = 5_000` 상수와 `execSync` 기반 `shellExec` 클로저가
`print-mode.ts`와 `tui-mode.ts` 두 파일에 완전히 동일하게 정의되어 있다.

```typescript
// print-mode.ts:10, 43–45
const SHELL_EXEC_TIMEOUT_MS = 5_000;
const shellExec = (command: string): string =>
  execSync(command, { timeout: SHELL_EXEC_TIMEOUT_MS, encoding: 'utf-8', stdio: 'pipe' }).trimEnd();

// tui-mode.ts:5, 47–49 — 완전히 동일한 코드
const SHELL_EXEC_TIMEOUT_MS = 5_000;
shellExec: (command: string): string =>
  execSync(command, { timeout: SHELL_EXEC_TIMEOUT_MS, encoding: 'utf-8', stdio: 'pipe' }).trimEnd(),
```

timeout 값 변경 시 두 파일을 모두 수정해야 하며, 하나를 놓치면 동작 불일치가 발생한다.

## 규칙 참조

- `code-quality.md` — "No magic numbers or strings. Use named constants."
- Anti-monolith: 중복 로직은 단일 소유 모듈로 분리해야 한다.

## 권장 조치

`packages/agent-cli/src/startup/shell-exec.ts` (또는 `utils/shell-exec.ts`) 단일 유틸 모듈을 만들어
`SHELL_EXEC_TIMEOUT_MS`와 `createShellExec()` 팩토리를 내보낸다.
두 mode 파일이 이를 import하여 사용한다.

더 나아가 이 어댑터를 startup 계층에서 생성하여 mode 함수에 주입하면
테스트 시 mock으로 교체 가능해진다.

## Test Plan

- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 0 errors
- [ ] `pnpm --filter @robota-sdk/agent-cli test` 전체 통과
- [ ] `grep -n "SHELL_EXEC_TIMEOUT_MS" packages/agent-cli/src/modes/print-mode.ts packages/agent-cli/src/modes/tui-mode.ts` — 두 파일 모두 결과 없음
- [ ] 상수와 팩토리가 단일 파일에만 정의됨을 확인

## User Execution Test Scenarios

### Scenario 1 — shell 명령 실행 기능 regression 없음

**Prerequisites**: `pnpm build`, TUI 모드 실행 가능 환경

**Steps**:

```bash
robota
# TUI에서 shell 명령을 실행하는 작업 입력
# 예: "Run ls -la and show the output"
```

**Expected**: shell 명령이 실행되고 결과가 TUI에 표시됨.
리팩토링 전과 동일한 동작.

**Evidence**: (구현 후 채울 것)

**Cleanup**: 세션 종료 (`/exit`)
