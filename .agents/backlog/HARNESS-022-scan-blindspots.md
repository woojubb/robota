---
title: 'HARNESS-022: 스캔 사각 보강: dep-kind 서브패스/export-from, devDeps 순환 + 재수출 잔존 제거'
status: todo
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
