---
title: 'DQ-AUDIT-002: SSOT 통합 — 가격/토큰추정/컨텍스트 타입/pass-through re-export'
status: done
created: 2026-06-14
completed: 2026-06-14
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
- **DQ-10 (P2) — `TContextState` 중복.** `agent-transport/src/tui/tui-state-manager.ts:23`가
  core `IContextWindowState`(`agent-core/src/context/types.ts:17`)와 동일 데이터를 `usedPercentage→percentage`
  로 rename해 평행 정의. → core 타입 재사용/`Pick`.
- **DQ-12 (P2) — ad-hoc pass-through re-export.** `agent-session/src/index.ts:26`(`IContextWindowState`),
  `session-interface.ts:2`(`ISession`), `agent-framework/src/types.ts:7-14`(`TRUST_TO_MODE` 값 포함).
  "for convenience" 릴레이가 SSOT 소유 패키지를 흐림. → 소비자가 오너에서 직접 import, 의도적 facade는
  DATA-001처럼 명시 문서화.

## Completion Criteria

- [x] TC-01: 모델 가격 테이블이 단일 오너 1곳에만 존재 (다른 두 임베디드 테이블 삭제, grep 검증)
- [x] TC-02: `CHARS_PER_TOKEN`/`len/4` 재구현이 core estimator import로 대체 (grep 검증)
- [x] TC-03: TUI 상태가 `IContextWindowState` 재사용, `TContextState` 평행정의 제거
- [x] TC-04: "for convenience" pass-through re-export 제거 또는 명시 facade로 전환
- [x] TC-05: 영향 패키지 typecheck/test + `pnpm harness:scan` 통과

## Test Plan

| TC-ID    | Test Type     | Approach                                                |
| -------- | ------------- | ------------------------------------------------------- |
| TC-01~04 | Static + Unit | grep 부재 확인 + 가격/추정 계산 단위 테스트로 동치 보장 |
| TC-05    | Build/Harness | filter typecheck + vitest + harness:scan                |

## User Execution Test Scenarios

Not applicable — 내부 SSOT 리팩터(동작 보존). 가격/컨텍스트 수치는 통합 후 단위 테스트로 동치 검증.

## Tasks

- [x] 가격 계약 오너 결정 — agent-core `context/model-pricing.ts` (기존 `context/models.ts` 모델 메타데이터 SSOT 패턴과 동일 위치)
- [x] DQ-04/09/10/12 순차 적용

## Evidence Log

### 구현 완료 — 2026-06-14

**오너 결정:** agent-core가 command·plugin·session·transport의 공통 조상이고 이미 `context/models.ts`로
모델 메타데이터(컨텍스트 윈도우, 벤더 모델 ID 포함) SSOT를 보유 → 가격 SSOT도 `context/model-pricing.ts`에
배치. 규칙/아키텍처 근거 명확하여 에이전트 직접 결정.

**DQ-04:** `agent-core/src/context/model-pricing.ts` 신설 — `IModelPrice`, `MODEL_PRICES`(정확 per-million),
`lookupModelPrice`, `calculateModelCost`, `estimateBlendedCostPer1000`. `context/index.ts` + `src/index.ts` export.
agent-command `model-pricing.ts`는 `calculateCost`를 core `calculateModelCost`에 위임(임베디드 테이블/패턴 삭제,
formatUsd/formatTokens 디스플레이 헬퍼만 유지). agent-plugin `limits-helpers.ts`는 stale `MODEL_COSTS` 삭제 →
`estimateBlendedCostPer1000(model) ?? tokenCostPer1000`.

**DQ-09:** `context-command.ts`(3곳)·`session-run.ts`(1곳)·`limits-helpers.ts`(1곳)의 `len/4` 매직넘버를
core `CONTEXT_ESTIMATE_CHARS_PER_TOKEN`로 교체.

**DQ-10:** `tui-state-manager.ts`의 `TContextState`를 독립 정의 → `Pick<IContextWindowState,'usedTokens'|'maxTokens'>
& { percentage }`로 파생(공유 필드 core에 구조적 결합, `percentage`는 명시적 디스플레이 미러).

**DQ-12:** dead pass-through re-export 제거 — `session-interface.ts`(ISession backward-compat 셔임, 무하위호환
규칙 위반) 삭제 + agent-session `index.ts`의 ISession·IContextWindowState re-export 제거(외부 소비자 0건 확인).
agent-session SPEC.md 3개 행 정리. agent-framework `types.ts`는 이미 "public entrypoint 미포함" 내부 alias로
문서화되어 유지.

**검증 증거:**

- TC-01~04: grep — 임베디드 가격 테이블 0건(core만), `len/4` 매직넘버 0건, `TContextState` 독립정의 제거,
  dead re-export 제거. 신규 `model-pricing.test.ts`(8 케이스) 추가.
- TC-05: agent-core/command/plugin/session/transport typecheck 통과; test **agent-core 720(+8)/command 186/
  plugin 298/session 72/transport 476 전부 passed**; 빌드 통과; agent-core SPEC.md에 Model Pricing(SSOT) 섹션 +
  agent-session SPEC.md 정합화. `pnpm harness:scan` **25/25 passed**.

User Execution Test Scenario gate: Not applicable(내부 SSOT 리팩터, 동작 보존 — 가격/컨텍스트 수치 단위 테스트 동치) — done-gate 충족.
