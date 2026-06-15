---
title: 'DOCFIX-002: 백로그 DOCS ID 충돌 해소 (DOCS-001 3중복)'
status: done
created: 2026-06-16
completed: 2026-06-16
priority: medium
urgency: soon
area: .agents/backlog
depends_on: []
---

# DOCFIX-002: 백로그 DOCS ID 충돌 해소

## Problem

`DOCS-001`이 3개 파일에 중복 사용됨: 레거시 2개
(`DOCS-001-content-docs-architecture-sync.md`, `DOCS-001-update-command-inventory-settings-user-local.md`)

- 2026-06-16 freshness 배치(`DOCS-001-content-transport-split-refs.md`). ID가 비고유하면 "DOCS-001"
  참조가 모호해진다(파일명은 고유라 기능 무영향이나 추적 위생 불량).

## Solution

전 DOCS ID를 고유화:

- 레거시 `DOCS-001-content-docs-architecture-sync` → 유지(`DOCS-001`, 이제 단독).
- 레거시 `DOCS-001-update-command-inventory-settings-user-local` → `DOCS-013`.
- freshness 배치 `DOCS-001~006` → `DOCS-007~012`(순서 보존):
  - 001 transport-split-refs → 007
  - 002 content-phantom-api-refs → 008
  - 003 readme-accuracy → 009
  - 004 ko-docs-refresh → 010
  - 005 changelog-and-new-package-docs → 011
  - 006 api-reference-disposition → 012

각 파일: `git mv` + 본문 `title:`·헤더의 ID 갱신. 참조 갱신: `.agents/backlog/README.md`,
`.design/docs-audit/2026-06-16/SUMMARY.md`.

## Completion Criteria

- [x] TC-01: `completed/DOCS-*` 중 동일 번호 중복 0건 (각 DOCS-NNN 파일 1개)
- [x] TC-02: 재번호 파일의 frontmatter `title:`/헤더 ID가 파일명과 일치
- [x] TC-03: README/SUMMARY의 링크가 새 파일명으로 갱신(끊긴 링크 0)
- [x] TC-04: `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type | Approach                              |
| ----- | --------- | ------------------------------------- |
| TC-01 | Script    | `ls completed/DOCS-*` 번호별 1개 확인 |
| TC-02 | Doc/grep  | 파일명 ID ↔ title/헤더 ID 대조        |
| TC-03 | Doc/grep  | README/SUMMARY 링크 대상 존재 확인    |
| TC-04 | Harness   | `pnpm harness:scan`                   |

## User Execution Test Scenarios

Not applicable — 백로그 ID 위생(거버넌스). 런타임 동작 무변경.

## Tasks

- [x] git mv 재번호 → 본문 ID 갱신 → README/SUMMARY 참조 갱신 → harness:scan

## Evidence Log

### 구현 완료 — 2026-06-16

- **TC-01:** `git mv`로 재번호 — freshness 배치 DOCS-001~006 → DOCS-007~012, 레거시 중복
  `DOCS-001-update-command-inventory…` → DOCS-013. 레거시 `DOCS-001-content-docs-architecture-sync`는
  단독으로 유지. `completed/DOCS-*` 번호별 1개(중복 0) 확인: 001, 007–013.
- **TC-02:** 재번호 파일의 frontmatter `title:`·H1 헤더·`depends_on`(DOCS-010 → [DOCS-008])이
  새 ID와 일치하도록 본문 remap.
- **TC-03:** `.agents/backlog/README.md`(6개 링크)·`.design/docs-audit/2026-06-16/SUMMARY.md`(테마 표 +
  본문) 참조를 새 ID/파일명으로 갱신 — README 링크 대상 6/6 존재 확인.
- **TC-04:** `pnpm harness:scan` **26/26 passed**.
