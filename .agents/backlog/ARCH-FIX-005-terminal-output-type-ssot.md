---
title: 'ARCH-FIX-005: ITerminalOutput/ISpinner 타입 SSOT 위반 수정'
status: done
created: 2026-05-10
priority: high
urgency: soon
area: architecture
related: [V-SYS-005]
---

## Problem

`agent-cli`에서 `ITerminalOutput`과 `ISpinner` 인터페이스가 중복 선언되어 있다. `agent-cli SPEC.md`는 이를 명시적 예외로 인정하지만, 근본 원인은 타입 소유권이 잘못 배치된 구조 문제다.

이 타입들은 `agent-sessions`이 소유하지만 `agent-cli`가 자체 선언을 유지한다. 동일 데이터에 대한 별개 타입 생성은 `code-quality.md`의 타입 SSOT 원칙 위반이다.

## Solution

1. `ITerminalOutput`과 `ISpinner`의 실제 사용처와 의존 방향을 조사한다.
2. 소유권 배치를 결정한다:
   - `agent-core`로 이동 (터미널 출력 계약이 core 도메인에 속한다면)
   - `agent-sessions` 소유권 확정 및 `agent-cli`에서 직접 임포트
3. `agent-cli`의 중복 선언을 제거하고 SSOT 위치에서 임포트한다.
4. `agent-cli SPEC.md`에서 해당 예외 섹션을 제거하고 정규 임포트 경로를 기록한다.

## Test Plan

- `pnpm typecheck` 전체 통과
- `pnpm --filter @robota-sdk/agent-cli build` 통과
- `agent-cli` 소스에서 `ITerminalOutput`/`ISpinner` 직접 선언 없음 확인 (`rg 'interface ITerminalOutput' packages/agent-cli`)
- `pnpm harness:verify -- --scope packages/agent-cli`

## User Execution Test Scenarios

### 시나리오: CLI TUI 렌더링 정상 동작 확인

**전제 조건**: Node.js 22+, pnpm 빌드 완료, 인터랙티브 터미널

**실행 단계**:

```bash
pnpm build
robota
```

**기대 결과**: TUI가 정상 렌더링되고 스피너/터미널 출력 컴포넌트가 동작한다.

**증거**: (구현 후 기록)
