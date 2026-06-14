---
title: 'HAUDIT-001: AGENTS.md 최상위 구조 트리 인라인 — ctx-agents-arch hollow 해소'
status: todo
created: 2026-06-15
priority: medium
urgency: soon
area: AGENTS.md
depends_on: []
---

# HAUDIT-001: AGENTS.md 최상위 구조 트리 인라인

## Problem

rulebased-harness 감사(2026-06-15)에서 `ctx-agents-arch`가 **hollow**로 판정됨. AGENTS.md
"Project Structure" 섹션이 순수 포인터("see project-structure.md")만 있고 인라인 구조가 없어,
범용(generic) 에이전트가 AGENTS.md만으로 레포 형태를 파악할 수 없다.

도메인-프리 설계(AGENTS.md는 패키지명/도메인 개념 미참조)는 유지하되, **generic 최상위
디렉터리 트리**만 인라인하면 발견성과 도메인-프리를 모두 만족한다.

## Solution

AGENTS.md "Project Structure" 섹션에 최상위 디렉터리 트리(generic dir명만: `packages/`,
`apps/`, `.agents/`, `scripts/`, `docs/`, `content/`, `examples/` 등)를 3~8줄로 추가.
패키지명/도메인 개념은 넣지 않고, 상세는 계속 `.agents/project-structure.md`가 SSOT.

## Completion Criteria

- [ ] TC-01: AGENTS.md "Project Structure"에 최상위 디렉터리 트리가 인라인됨
- [ ] TC-02: 트리에 개별 패키지명/도메인 개념이 없음(domain-free 유지)
- [ ] TC-03: `.agents/project-structure.md`로의 SSOT 포인터 유지
- [ ] TC-04: `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type  | Approach                               |
| ----- | ---------- | -------------------------------------- |
| TC-01 | Doc review | AGENTS.md diff — 트리 존재 확인        |
| TC-02 | Doc review | generic dir명만 사용 확인 (패키지명 0) |
| TC-03 | Doc review | SSOT 포인터 유지 확인                  |
| TC-04 | Harness    | `pnpm harness:scan` 통과               |

## User Execution Test Scenarios

Not applicable — 컨텍스트 문서(AGENTS.md) 발견성 개선. 런타임 동작 무변경.

## Tasks

- [ ] AGENTS.md 트리 추가 → harness:scan 검증

## Evidence Log

(구현 후 작성)
