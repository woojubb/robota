---
title: 'Phase 1: Fix DTS race condition — tsup 유지, 빌드 구조 개선'
status: backlog
created: 2026-03-30
priority: high
urgency: now
packages:
  - all (48 packages use tsup)
---

## Problem

`pnpm build` intermittently fails due to DTS race condition. tsup runs ESM/CJS bundling (~60ms) and DTS generation (~5-20s) as a single command. Dependent packages start DTS build before dependency's DTS is ready.

Observed: `dag-adapters-local` fails because `dag-core` DTS isn't ready. Consistent in CI, intermittent locally.

## Approach

tsup을 유지하면서 root 빌드 스크립트를 2-pass로 분리:

1. **Phase 1 — JS 번들링** (병렬, DTS 없이, 빠름)
2. **Phase 2 — DTS 생성** (topological 순서 보장)

## Scope

- Root `package.json` build 스크립트 변경
- 각 패키지에 `build:js`, `build:types` 스크립트 추가
- 기존 `build` 스크립트는 개별 패키지 빌드용으로 유지
- CI workflow 검증

## Constraints

- 개별 패키지 `pnpm --filter <pkg> build` 동작 유지
- `pnpm publish:beta` 워크플로우 유지
- tsup 설정 최소 변경

## Next Step

Design spec → implementation plan
