---
title: 'LESSON-006: 패키지 재배치 시 다운스트림 참조 일괄 검사 — stale 경로 기계적 탐지'
status: todo
created: 2026-06-15
priority: medium
urgency: later
area: scripts/harness, .agents/skills/architecture-conformance-audit
depends_on: []
---

# LESSON-006: 재배치 다운스트림 참조 일괄 검사

## Problem (이번 세션 실제 사건)

DQ-AUDIT-004(session-analytics 패키지 분리)·DQ-AUDIT-005(transport 패키지 분할)에서 코드를
재배치한 뒤, 여러 곳의 경로 참조가 stale로 남아 하네스가 연쇄 실패했다:

- `background-workspace-conformance` 스캔에 하드코딩된 tui 경로
- `agent-transport` SPEC의 ghost 경로(spec-paths 스캔 실패)
- 완료 백로그의 done-evidence stale 참조(sed로 일괄 수정)
- OBS-001 백로그 "Affected Files"가 이전 경로를 가리킴 → 수동 갱신
- `interface-imports` 스캔: agent-cli가 framework에서 import하던 타입을 analytics로 변경

즉 **재배치 시 코드는 옮겼으나 다운스트림 문서/스캔 설정/백로그 참조가 함께 갱신되지 않아**
여러 번의 스캔 실패-수정 루프를 돌았다.

## Solution

- 재배치 후 stale 참조를 한 번에 잡는 기계적 검사 또는 절차 추가:
  - 백로그/SPEC/스캔 설정에 존재하지 않는 경로 참조가 있으면 실패시키는 통합 점검
    (기존 `check-spec-paths`·`done-evidence` 확장 가능성 조사).
  - 스캔 스크립트 내 **하드코딩 경로 제거** — 패키지 목록을 동적으로 산출하도록 리팩터 검토.
- `architecture-conformance-audit`(또는 신규 design-quality-audit, LESSON-002) 스킬에
  "재배치 체크리스트: 코드 이동 후 다운스트림 참조(백로그 Affected Files, done-evidence,
  SPEC 경로, 스캔 하드코딩) 일괄 sweep" 절차 추가.

## Completion Criteria

- [ ] TC-01: 존재하지 않는 경로를 참조하는 백로그/SPEC/스캔 설정을 탐지하는 기계적 검사 추가
      (또는 기존 스캔 확장)
- [ ] TC-02: 스캔 스크립트의 하드코딩 패키지 경로 제거/동적화 여부 조사 및 적용/사유 기록
- [ ] TC-03: 재배치 sweep 체크리스트가 관련 스킬에 명문화됨
- [ ] TC-04: `pnpm harness:scan` 통과 (의도적 stale fixture로 탐지 검증)

## Test Plan

| TC-ID | Test Type  | Approach                                                     |
| ----- | ---------- | ------------------------------------------------------------ |
| TC-01 | Harness    | 의도적 ghost 경로 fixture로 탐지/미탐지 검증                 |
| TC-02 | Harness    | 스캔 스크립트 하드코딩 제거 후 패키지 추가 시 자동 반영 확인 |
| TC-03 | Doc review | 스킬 체크리스트 문구 확인                                    |
| TC-04 | Harness    | `pnpm harness:scan` 통과                                     |

## User Execution Test Scenarios

Not applicable — 하네스/스킬 거버넌스 변경. 사용자 대면 런타임 동작 무변경.

## Tasks

- [ ] stale 경로 검사 추가/확장 → 하드코딩 제거 조사 → 스킬 체크리스트 → harness:scan 검증

## Evidence Log

(구현 후 작성)
