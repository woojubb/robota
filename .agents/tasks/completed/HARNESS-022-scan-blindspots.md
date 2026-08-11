---
title: 'HARNESS-022: 스캔 사각 보강: dep-kind 서브패스/export-from, devDeps 순환 + 재수출 잔존 제거'
status: done
completed: 2026-07-04
created: 2026-07-04
priority: high
urgency: now
area: scripts/harness, packages/agent-framework
depends_on: []
---

# 스캔 사각 보강: dep-kind 서브패스/export-from, devDeps 순환 + 재수출 잔존 제거

Re-audit P1-2 (CONTRACT-014, STRUCT-02/03, CONTRACT-013 병합; Medium→High 상향). 재스코프
(2026-07-04 사용자 원칙): orphan-exports의 type/배럴 확장은 제외 — 레포 내 미소비는 라이브러리
공개 표면의 결함 증거가 아니다(project-structure.md § Forward-Provisioned Surface Rule).
소유권 규칙 위반(pass-through 재수출)만 기계화 대상.

## What

1. dep-kind 스캔: 서브패스 value import(`@robota-sdk/x/sub`)와 `export ... from` 런타임 재수출
   매칭 추가 (STRUCT-02).
2. dependency-direction 스캔: devDeps+peer 포함 그래프 순환 검사 추가 (STRUCT-03; 방향 규칙은
   prod 한정 유지).
3. framework 공개 index의 type-only 재수출 잔존 3종(IInteractionChannel, InteractionEvent,
   ICommandInfo) 제거 (CONTRACT-013).
4. 각 보강에 위반 fixture 테스트 + red/green prove.

## Test Plan

- fixture: 서브패스 devDep value import fail; export-from 재수출 fail; devDep 순환 fail.
- 전체 스캔 green, 하네스 스위트 green.

## User Execution Test Scenarios

Not applicable — harness tooling only. Engineering evidence: red/green prove runs per fixture.

## Evidence (engineering verification, 2026-07-04)

- **Red/green proves (3종 전부 실측)**: ① 서브패스 value import fixture
  (`@robota-sdk/agent-interface-transport/sub`를 agent-cli src에 심음 — interface-transport는
  agent-cli의 실제 devDep) → dep-kind fail, 제거 후 pass. ② 런타임 `export … from` 재수출
  fixture → dep-kind fail, 제거 후 pass (초기 확장이 `export const`+템플릿 리터럴을 오탐해
  재수출 구문 형태로 정밀화 — 회귀 테스트가 그 케이스를 고정). ③ agent-command에
  devDep `agent-transport`를 심어 dev 순환 재현 → 방향 스캔 `[DEV-CYCLE]` fail
  (`agent-command -> agent-transport -> agent-command`), revert 후 pass.
- **CONTRACT-013 잔존 재수출 3종 제거**: framework 공개 index의 type-only pass-through
  (`IInteractionChannel`, `InteractionEvent`, `ICommandInfo`) 삭제 — repo typecheck 0
  (소비자 0 실증), interface-imports 스캔이 export-from을 이미 잡으므로 재발 기계 차단.
- **재스코프 준수**: orphan-export의 type/배럴 확장은 도입하지 않음 —
  § Forward-Provisioned Surface Rule(레포 내 미소비 ≠ 결함).
- Durable artifacts: `scripts/harness/check-dep-kind.mjs`(VALUE_REEXPORT_RE+서브패스),
  `scripts/harness/check-dependency-direction.mjs`(checkFullGraphCycles),
  `scripts/harness/__tests__/check-dep-kind.test.mjs`(+2),
  `scripts/harness/__tests__/check-interface-package-deps.test.mjs`(+2),
  `packages/agent-framework/src/index.ts`. 하네스 스위트 244 green; 45 스캔 green;
  typecheck 0; lint 0 errors; framework 1035 테스트 green.
