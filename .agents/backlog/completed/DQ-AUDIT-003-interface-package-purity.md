---
title: 'DQ-AUDIT-003: 인터페이스 패키지 순수성 — tui 타입가드 런타임 로직 + interface-transport 하향 의존'
status: done
created: 2026-06-14
completed: 2026-06-14
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

- [x] DQ-01 가드 제거 (이동 아님 — 호출처 0건으로 dead code 확정)
- [x] DQ-11 의존 방향 결정 — justification 문서화 (REFACTOR-018을 향후 inversion 트랙으로)

## Evidence Log

### 구현 완료 — 2026-06-14

**DQ-01 (결정 변경: 이동 → 삭제):** audit은 가드를 유일 소비자 agent-transport로 "이동"을 권했으나,
조사 결과 `isPickerInteraction`/`isConfirmInteraction`는 **호출처 0건**(정의·export·re-export·문서뿐).
agent-transport로 이동하자 `orphan-export` 스캔이 dead code로 정확히 검출 → 이동이 아니라 **삭제**가
정답(interface 순수성 + no-dead-code 동시 충족). `TAnyTuiCommandInteraction`은 discriminated union이라
`onMissingArgs` 판별자로 직접 narrowing 가능 — 전용 가드 불필요.

- `agent-interface-tui/src/command-interaction.ts`: 두 함수 삭제(타입만 잔존), `index.ts` export 제거.
- `agent-transport/src/tui/command-interaction.ts`: 타입 re-export만 유지(가드 미정의).
- 문서 동기화: interface-tui SPEC/README/docs에서 "narrow runtime type guards" 목적 문구 + 가드 행 제거,
  "타입 전용, onMissingArgs로 narrowing" 으로 정정.

**DQ-11 (결정: justification 문서화):** interface-transport의 `agent-core`/`agent-executor`/`agent-session`
의존은 전부 `import type`(런타임 결합 0, conformance 순환 0). agent-core는 zero-dep foundation으로 항상 허용.
executor/session 도메인 타입(`ICompactEvent`, `TBackgroundTaskStatus`, `IBackgroundTaskError`)은 transport
계약이 **참조**할 뿐 소유/재수출하지 않음(계약 합성). 전체 inversion은 P2 대비 churn/리스크가 커서 deferred —
SPEC Boundaries에 아키텍처 justification 명시 + REFACTOR-018을 향후 inversion 트랙으로 연결.

**검증:** interface-tui/transport typecheck + build 통과; transport test **476 passed**; 가드 참조 레포 전체
0건; `pnpm harness:scan` **25/25 passed**(orphan-export 포함), conformance PASS.

User Execution Test Scenario gate: Not applicable(타입 패키지 구조/문서 변경, 사용자 동작 무변경).
