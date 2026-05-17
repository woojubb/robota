---
title: 'ARCH-MAP-003: Remove non-existent auth/credits package references from architecture map'
status: todo
created: 2026-05-18
priority: medium
urgency: later
area: .agents/specs/architecture-map
depends_on: []
---

## Problem

`auth`, `credits` 패키지가 `packages/` 디렉토리에 존재하지 않으나 `cross-cutting-contracts.md`에서
SPEC.md 링크를 포함해 참조하고 있음.

## Required Changes

**File: `cross-cutting-contracts.md`**

1. Lines 33–34 (Mermaid diagram): `auth SPEC`, `credits SPEC` 노드 제거 또는 "planned" 표기로 교체
2. Lines 55–56 (contract owner table):
   - `packages/auth/docs/SPEC.md` 링크 행 제거 또는 플레이스홀더로 대체
   - `packages/credits/docs/SPEC.md` 링크 행 제거 또는 플레이스홀더로 대체

**선택지:**

- A. 행 자체를 삭제 (패키지 계획 없을 경우)
- B. `TBD — package not yet created` 주석으로 대체 (향후 생성 예정일 경우)

어느 쪽이든 현재 존재하지 않는 파일 경로를 유효한 링크처럼 표시하지 않아야 함.

## Test Plan

- [ ] `grep -r "packages/auth\|packages/credits" .agents/specs/architecture-map/` 결과 없음 (또는 존재 여부 명시한 주석만 남음)
- [ ] `cross-cutting-contracts.md` Mermaid 다이어그램 렌더링 오류 없음
- [ ] 실제 `packages/` 디렉토리와 architecture map 간 패키지 목록 일치

## Source

`.design/arch-map-audit/COMPREHENSIVE-REPORT.md` Category 4 (MEDIUM)
