---
title: 'LESSON-001: 라이브 상태변경 seam의 cold-state 테스트 — mock-the-buggy-collaborator 방지'
status: todo
created: 2026-06-15
priority: high
urgency: soon
area: .agents/skills/vitest-testing-strategy, scripts/harness
depends_on: []
---

# LESSON-001: 라이브 상태변경 seam의 cold-state 테스트

## Problem (이번 세션 실제 사건)

`/preset` 커맨드가 TUI 진입 직후(첫 `run()` 전, 즉 lazy-init 미완료 상태)에서
`ConfigurationError: Agent must be fully initialized before changing model configuration`로
실패했다. 그러나 해당 seam의 단위 테스트(`apply-model-options.test.ts`)는 통과하고 있었다.

근본 원인: 테스트가 `Robota`를 `vi.fn()` mock으로 대체했고, mock `setModel`은 실제의
**init 가드(fully-initialized 선결조건)를 재현하지 않았다**. 즉 버그가 있는 협력자를 mock으로
치환해 버그를 가린 것이다 — 라이브 상태변경 seam을 실제 협력자 없이 검증했기 때문에
cold-state(초기화 전) 경로가 한 번도 실제로 실행되지 않았다.

이미 `common-mistakes.md` #60에 안티패턴으로 기록했으나, **체계적 탐지 방법**이 스킬/하네스에
녹아있지 않아 동일 부류가 재발할 수 있다.

## Solution

1. `vitest-testing-strategy` 스킬에 "라이브 상태변경 seam" 절 추가:
   - lazy-init/지연 초기화에 의존하는 seam은 **실제 협력자(no mock)로 cold-state(초기화 전)
     경로를 반드시 검증**한다.
   - 협력자를 mock할 때는 실제 메서드의 **선결조건(init 가드 등)을 mock에도 반영**한다.
   - 회귀 테스트 패턴: `apply-model-options-cold-session.test.ts`(real `Robota`, never `run()`)를
     레퍼런스로 명시.
2. 기계적 검사(`scripts/harness/`): live-seam 후보(상태변경 메서드를 호출하는 경로)에 대해
   "cold-state 통합 테스트가 존재하는가"를 휴리스틱으로 점검하는 스캐너를 추가하거나,
   최소한 `vi.fn()` mock이 init 가드가 있는 메서드를 대체할 때 경고하는 린트성 검사 가능성 조사.

## Completion Criteria

- [ ] TC-01: `vitest-testing-strategy` 스킬에 "라이브 상태변경 seam의 cold-state 테스트" 절이
      추가되고 cold-session 회귀 테스트 레퍼런스가 명시됨
- [ ] TC-02: mock 작성 시 실제 선결조건(init 가드) 반영 규칙이 스킬에 명문화됨
- [ ] TC-03: live-seam cold-state 커버리지 기계적 검사 추가 여부를 조사하고, 가능하면
      `harness:scan`에 편입(불가 시 사유와 대안을 스킬에 기록)
- [ ] TC-04: `pnpm harness:scan` + harness-governance 일관성 검사 통과

## Test Plan

| TC-ID | Test Type  | Approach                                                       |
| ----- | ---------- | -------------------------------------------------------------- |
| TC-01 | Doc review | 스킬 diff 검토 — 절 존재 + 레퍼런스 링크 확인                  |
| TC-02 | Doc review | mock 선결조건 규칙 문구 확인                                   |
| TC-03 | Harness    | 스캐너 추가 시 fixture로 탐지/미탐지 검증, 또는 조사 결과 기록 |
| TC-04 | Harness    | `pnpm harness:scan` 통과                                       |

## User Execution Test Scenarios

Not applicable — 스킬/하네스 거버넌스 변경. 사용자 대면 런타임 동작 무변경.
실제 `/preset` cold-session 버그 자체는 fix/cold-session-preset-model(PR #789)에서 이미 수정·검증됨.

## Tasks

- [ ] vitest-testing-strategy 스킬 업데이트 → 기계적 검사 조사/구현 → harness:scan 검증

## Evidence Log

(구현 후 작성)
