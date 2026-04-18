---
title: 'Phase 2: Build tool migration — tsup 대체 도구 도입'
status: backlog
created: 2026-03-30
priority: medium
urgency: later
packages:
  - all (48 packages)
depends_on:
  - INFRA-BL-008
---

## Problem

tsup은 유지보수 모드에 진입했으며, 모노레포 DTS 빌드에 구조적 한계가 있다. Phase 1에서 빌드 구조로 우회했지만, 장기적으로는 모노레포 네이티브 지원이 있는 도구가 필요하다.

## Evaluation Candidates

- **tsdown** — tsup 후속, Rolldown 기반, 모노레포 네이티브 지원. 안정화 대기
- **unbuild** — Nuxt 팀, Rollup 기반, stub 모드 지원
- **Rollup + tsc** — 수동 구성, 가장 유연
- 기타 안정화된 도구가 나오면 재평가

## Prerequisites

- INFRA-BL-008 완료 (Phase 1 빌드 구조 개선)
- 대상 도구의 1.0 안정 릴리즈 또는 충분한 실사용 검증

## Scope

- 도구 선정 및 PoC (1-2개 패키지)
- 전체 마이그레이션
- CI/CD 및 publish 워크플로우 검증

## Next Step

INFRA-BL-008 완료 후, 대상 도구 안정성 재평가 → 설계

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
