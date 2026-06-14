---
title: 'DQ-AUDIT-002: SSOT 통합 — 가격/토큰추정/컨텍스트 타입/pass-through re-export'
status: todo
created: 2026-06-14
priority: high
urgency: soon
area: packages/agent-command, packages/agent-plugin, packages/agent-session, packages/agent-core, packages/agent-transport, packages/agent-framework
depends_on: []
---

# DQ-AUDIT-002: SSOT 통합

설계 품질 감사에서 발견된 동일 데이터/로직의 다중 정의. drift가 비용·컨텍스트% 오표시로 직결되어
정확성 가치가 가장 높다. 근거: `.design/architecture-audit/2026-06-14/design-quality-audit.md`.

## 포함 findings

- **DQ-04 (P1) — 모델 가격 테이블 3중복.** `agent-command/src/session/model-pricing.ts:7`(per-million),
  `agent-plugin/src/limits/limits-helpers.ts:20`(per-1000, 다른 숫자/형태), 그리고 올바른 패턴
  `agent-plugin/src/usage/usage-plugin-helpers.ts:41`(config 주입). 동일 사실(모델→가격)을 세 형태로
  중복, 두 곳은 하드코딩 테이블이 drift 중. → 단일 가격 계약+테이블 오너 1곳, 나머지는 주입 소비.
- **DQ-09 (P2) — 토큰추정 `len/4` 4중복.** 오너는 `agent-core/src/context/estimation.ts:5`이나
  `agent-plugin/.../limits-helpers.ts:14`, `agent-session/src/session-run.ts:123`,
  `agent-command/src/context/context-command.ts:286,352`가 재구현(주석이 중복을 자인). → core estimator import.
- **DQ-10 (P2) — `IContextState` 중복.** `agent-transport/src/tui/tui-state-manager.ts:23`가
  core `IContextWindowState`(`agent-core/src/context/types.ts:17`)와 동일 데이터를 `usedPercentage→percentage`
  로 rename해 평행 정의. → core 타입 재사용/`Pick`.
- **DQ-12 (P2) — ad-hoc pass-through re-export.** `agent-session/src/index.ts:26`(`IContextWindowState`),
  `session-interface.ts:2`(`ISession`), `agent-framework/src/types.ts:7-14`(`TRUST_TO_MODE` 값 포함).
  "for convenience" 릴레이가 SSOT 소유 패키지를 흐림. → 소비자가 오너에서 직접 import, 의도적 facade는
  DATA-001처럼 명시 문서화.

## Completion Criteria

- [ ] TC-01: 모델 가격 테이블이 단일 오너 1곳에만 존재 (다른 두 임베디드 테이블 삭제, grep 검증)
- [ ] TC-02: `CHARS_PER_TOKEN`/`len/4` 재구현이 core estimator import로 대체 (grep 검증)
- [ ] TC-03: TUI 상태가 `IContextWindowState` 재사용, `IContextState` 평행정의 제거
- [ ] TC-04: "for convenience" pass-through re-export 제거 또는 명시 facade로 전환
- [ ] TC-05: 영향 패키지 typecheck/test + `pnpm harness:scan` 통과

## Test Plan

| TC-ID    | Test Type     | Approach                                                |
| -------- | ------------- | ------------------------------------------------------- |
| TC-01~04 | Static + Unit | grep 부재 확인 + 가격/추정 계산 단위 테스트로 동치 보장 |
| TC-05    | Build/Harness | filter typecheck + vitest + harness:scan                |

## User Execution Test Scenarios

Not applicable — 내부 SSOT 리팩터(동작 보존). 가격/컨텍스트 수치는 통합 후 단위 테스트로 동치 검증.

## Tasks

- [ ] 가격 계약 오너 결정(core provider-metadata vs 전용 모듈) — 설계 컨펌 필요
- [ ] DQ-04/09/10/12 순차 적용

## Evidence Log
