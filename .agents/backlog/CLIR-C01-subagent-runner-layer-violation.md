---
title: 'CLIR-C01: agent-cli subagent-setup.ts — @robota-sdk/agent-subagent-runner 직접 import 제거'
status: todo
created: 2026-05-17
priority: critical
urgency: soon
area: packages/agent-cli, packages/agent-subagent-runner, packages/agent-framework
---

## 배경

코드리뷰 보고서: `.design/agent-cli-review-2026-05-17.html` #C-01

ARCH-FIX-020(done)에서 `ChildProcessSubagentRunner` 자체는 `agent-sdk`로 이동했으나,
`packages/agent-cli/src/startup/subagent-setup.ts:6`이 여전히
`@robota-sdk/agent-subagent-runner`를 직접 import한다.

```typescript
// subagent-setup.ts:6 — 현재 위반 상태
} from '@robota-sdk/agent-subagent-runner';
```

`agent-subagent-runner`는 `agent-framework` 위에 선택적으로 올라오는 패키지다.
CLI가 이 패키지를 직접 의존하면 `agent-cli → agent-framework → agent-subagent-runner` 단방향
의존 관계 대신 CLI가 두 계층을 동시에 직접 쥐는 구조가 된다.
`agent-cli/package.json`의 `dependencies`에도 `@robota-sdk/agent-subagent-runner`가 명시되어
배포 번들 의존성이 직접 노출된다.

## 문제 상세

`subagent-setup.ts`가 현재 직접 호출하는 것들:

- `getDefaultSubagentWorkerPath()` — worker 경로 해석
- `createChildProcessSubagentRunnerFactory()` — runner 팩토리 생성

이 두 함수가 `agent-framework`를 통해 재수출되거나, CLI가 받아야 할 것은
팩토리 자체가 아니라 설정값 + 경로뿐이어야 한다.

## 규칙 참조

- `code-quality.md` — "No layer skipping. CLI must not directly use internals that should be wired through agent-sessions or agent-sdk."
- `project-structure.md` — "Orchestrator/adapter split."

## 권장 조치

**옵션 A (선호):** `agent-framework`가 `createChildProcessSubagentRunnerFactory`와
`getDefaultSubagentWorkerPath`를 re-export한다. `agent-cli`는 `agent-subagent-runner`를 직접 import하지 않는다.

**옵션 B:** CLI가 runner를 소유해야 한다면, 어댑터 인터페이스만 주입받고 실제 팩토리 생성은
`agent-subagent-runner` 패키지가 직접 공개하는 진입점을 통해서만 한다.

구현 전 **설계 컨펌 필요** (옵션 A vs B).

## Test Plan

- [ ] `pnpm --filter @robota-sdk/agent-cli build` 통과
- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 0 errors
- [ ] `grep -r "agent-subagent-runner" packages/agent-cli/src/` — subagent-setup.ts에 결과 없음
- [ ] `cat packages/agent-cli/package.json | grep agent-subagent-runner` — dependencies에 없음
- [ ] `pnpm test` 전 범위 통과

## User Execution Test Scenarios

### Scenario 1 — Subagent 실행 regression 없음

**Prerequisites**: Robota CLI 빌드 완료, subagent 기능 활성화 설정

**Steps**:

```bash
robota --subagent-worker-path auto
# (TUI에서 subagent를 spawn하는 작업 실행)
```

**Expected**: subagent가 child process로 실행되고 결과가 main 세션에 반환됨.
이동 전과 동일한 동작.

**Evidence**: (구현 후 채울 것)

**Cleanup**: 세션 종료 (`/exit`)
