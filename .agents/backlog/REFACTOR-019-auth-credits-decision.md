---
title: 'REFACTOR-019: auth/credits 패키지 소비자 연결 또는 삭제 결정'
status: backlog
created: 2026-05-15
priority: low
urgency: backlog
area: packages/auth, packages/credits, apps/agent-server
---

## Problem

`packages/auth`와 `packages/credits`가 어떤 production 패키지에서도 소비되지 않는다. `apps/agent-server`는 JWT 인증을 `jsonwebtoken`으로 직접 inline 구현해 auth port를 완전히 우회한다.

forward-declared contract(계획된 구현 대기)인지 obsolete인지 명확히 해야 한다.

Source: COMBINED-019 (SA-012)

## Scope

결정 필요:

- **Option A**: `agent-server`를 `@robota-sdk/auth`를 사용하도록 마이그레이션. SPEC에 "consumer: agent-server" 명시.
- **Option B**: forward-declared contract으로 유지. SPEC에 "planned consumer" 및 마이그레이션 경로 명시. 현재 inline 구현을 acknowledged technical debt로 문서화.
- **Option C**: 계획이 없다면 패키지 삭제.

## Test Plan

- 선택한 옵션에 따라 결정.
- Option A: `pnpm typecheck`, `pnpm --filter apps/agent-server test` 통과.
- Option C: 삭제 후 `pnpm build` 전체 통과.

## User Execution Test Scenarios

Not applicable — 계약 문서화 또는 패키지 정리이며 단기적으로 사용자 관찰 가능한 동작 변화 없음.
