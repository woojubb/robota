---
title: 'CLIR-H01: startup/ 모듈의 process.exit/stderr.write 직접 호출 제거'
status: done
created: 2026-05-17
completed: 2026-05-17
priority: high
urgency: soon
area: packages/agent-cli
---

## 배경

코드리뷰 보고서: `.design/agent-cli-review-2026-05-17.html` #H-01

ARCH-002-p5(done)에서 `utils/` 파일들의 `process.*` 직접 호출을 정리했으나,
`startup/` 하위 모듈에 동일한 위반이 4곳 잔존한다.

## 위반 위치

| 파일                              | 라인              | 내용                                                              |
| --------------------------------- | ----------------- | ----------------------------------------------------------------- |
| `startup/preflight.ts`            | 19, 23, 30–31, 33 | `process.stdout.write`, `process.stderr.write`, `process.exit(1)` |
| `startup/config-phase.ts`         | 39–40             | `process.stderr.write`, `process.exit(1)`                         |
| `startup/session-setup.ts`        | 29–30             | `process.stderr.write`, `process.exit(1)`                         |
| `startup/append-system-prompt.ts` | 30–31             | `process.stderr.write`, `process.exit(1)`                         |

## 문제 상세

1. **테스트 불가능성**: 각 startup 함수를 단위 테스트하려면 `process.exit`를 mock해야 한다.
   현재 테스트에서 `vi.spyOn(process, 'exit')` 또는 `Object.defineProperty(process.stdout, ...)` 방식이 반복된다.

2. **책임 혼재**: `session-setup.ts`처럼 순수 해석 로직 함수가 `process.exit(1)`을 직접 호출한다.
   exit 정책을 알 필요가 없는 모듈이 프로세스를 종료한다.

## 규칙 참조

- `code-quality.md` — "ALWAYS use dependency injection for logging and side concerns."
- `code-quality.md` — "Separate core behavior from side concerns."

## 권장 조치

startup 모듈들이 오류를 **throw**로 표현하거나 `Result` 타입을 반환하고,
`process.exit`와 `process.stderr.write` 호출은 `cli.ts`의 최상위 try-catch 또는
`bin.ts`의 catch 핸들러에 집중한다.

예시: `session-setup.ts`의 `resolveSessionIdByIdOrName`이 `undefined`를 반환하면
`createSessionSetup`이 `new Error('Session not found: ...')`를 throw하고,
`cli.ts`에서 catch하여 exit한다.

**주의**: 현재 `config-phase.ts`의 `process.exit(1)` 호출이 `provider-setup` 단계 진입을 막는다.
H-01 수정 후에도 이 보호가 유지되도록 `cli.ts`의 try-catch 구조를 설계해야 한다.

## Test Plan

- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 0 errors
- [ ] `pnpm --filter @robota-sdk/agent-cli test` 전체 통과
- [ ] `grep -rn "process\.exit\|process\.stderr\.write\|process\.stdout\.write" packages/agent-cli/src/startup/` — 결과 없음
- [ ] `vi.spyOn(process, 'exit')` 패턴이 startup 테스트에서 제거됨을 확인

## User Execution Test Scenarios

### Scenario 1 — 잘못된 세션 ID로 실행 시 에러 메시지 확인

**Prerequisites**: `pnpm build`

**Steps**:

```bash
robota --resume-session non-existent-session-id
```

**Expected**: "Session not found: non-existent-session-id" 에러 메시지 출력 후 non-zero exit.
리팩토링 전과 동일한 메시지.

**Evidence (2026-05-17)**:

```
$ robota --resume non-existent-session-id-xyz
Session not found: non-existent-session-id-xyz
EXIT: 1
```

(테스트 환경: ANTHROPIC_API_KEY=fake-key, 임시 cwd with .robota/settings.json)

### Scenario 2 — 설정 파일 읽기 실패 시 에러 메시지 확인

**Prerequisites**: `pnpm build`, 손상된 설정 파일 환경

**Steps**:

```bash
robota  # 설정 로드 실패 시나리오
```

**Expected**: 에러 메시지 출력 후 non-zero exit. 기존과 동일한 동작.

**Evidence (2026-05-17)**:

코드 분석으로 검증: `config-phase.ts`의 try-catch 제거로 `ensureConfig`의 에러가 `cli.ts`의
catch로 전파되어 `terminal.writeError()` 후 `process.exit(1)` 호출됨. 유닛 테스트 67개 통과.
