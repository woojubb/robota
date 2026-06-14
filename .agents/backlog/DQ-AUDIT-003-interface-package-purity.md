---
title: 'DQ-AUDIT-003: 인터페이스 패키지 순수성 — tui 타입가드 런타임 로직 + interface-transport 하향 의존'
status: todo
created: 2026-06-14
priority: medium
urgency: soon
area: packages/agent-interface-tui, packages/agent-interface-transport, packages/agent-transport
depends_on: []
---

# DQ-AUDIT-003: 인터페이스 패키지 순수성

`agent-interface-*`는 타입 계약만 담아야 한다(Interface Package Rule). 두 위반.

## 포함 findings

- **DQ-01 (P1) — interface-tui가 런타임 함수 포함.** `agent-interface-tui/src/command-interaction.ts:25-35`의
  `isPickerInteraction`/`isConfirmInteraction` 타입가드는 JS로 컴파일되는 실런타임 함수이며
  `agent-transport/src/tui/command-interaction.ts:9`가 값으로 re-export. 유일하게 실행코드를 가진
  인터페이스 패키지 → "interface = 타입 전용" 불변식 위반. → 가드를 유일 소비자 `agent-transport`로 이동,
  패키지는 `ITui*` 인터페이스 + `TOnMissingArgsAction` union만 유지.
- **DQ-11 (P2) — interface-transport가 executor/session으로 하향 타입 의존.**
  `agent-interface-transport/package.json` deps에 `agent-core`/`agent-executor`/`agent-session`,
  `session-contracts.ts:43-44`가 `import type`로 끌어옴. 중립 계약 패키지가 하위 internals에 결합.
  (REFACTOR-018과 동일 맥락 — 상태 확인 후 통합/계승.) → 교차절단 타입이면 SSOT를 인터페이스 패키지로
  이전하고 executor/session이 역으로 import(의존 역전).

## Completion Criteria

- [ ] TC-01: `agent-interface-tui/src`에 런타임 함수/값 export 0건 (타입/인터페이스만)
- [ ] TC-02: 타입가드가 `agent-transport`에서 정상 동작 (TUI 커맨드 분기 단위 테스트)
- [ ] TC-03: interface-transport 의존 방향 결정 — 역전 또는 명시 정당화 문서화
- [ ] TC-04: `pnpm harness:scan`의 `interface-imports`/`conformance` 통과

## Test Plan

| TC-ID | Test Type | Approach                             |
| ----- | --------- | ------------------------------------ |
| TC-01 | Static    | interface-tui export 표면 검사       |
| TC-02 | Unit      | 이동된 가드의 transport 단위 테스트  |
| TC-03 | Design    | REFACTOR-018 상태 확인 + 결정 문서화 |
| TC-04 | Harness   | harness:scan                         |

## User Execution Test Scenarios

Not applicable — 패키지 내부 구조/타입 이동. 사용자 대면 동작 무변경.

## Tasks

- [ ] DQ-01 가드 이동
- [ ] DQ-11 의존 방향 결정 (REFACTOR-018 중복 확인)

## Evidence Log
