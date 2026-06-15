---
title: 'DOCS-006: content/api-reference 처리 방향 결정 (retire vs regenerate) + dead link 수정'
status: done
created: 2026-06-16
completed: 2026-06-16
priority: medium
urgency: later
area: content/api-reference, scripts/docs, content/quickstart.md, apps/docs
depends_on: []
---

# DOCS-006: api-reference 처리 방향 결정 + dead link

## Problem

근거: `.design/docs-audit/2026-06-16/report-content-generated-frozen.md`.

`content/api-reference/`는 **stale + orphaned**:

- 공개 19개 중 5개 디렉터리만 존재(그중 2개는 private: agent-playground, agent-tool-mcp). 16개 누락
  (transport split, agent-session-analytics 포함).
- 자동 생성기 `scripts/docs/docs-generator.js`는 `packages/*/src/index.ts`를 동적 스캔하나 `private`을
  거르지 않음. 광고된 `pnpm typedoc:convert` 스크립트는 **존재하지 않고** 어떤 빌드에도 연결돼 있지 않음
  (INFRA-BL-005에서 convert 단계 제거, 파이프라인이 Next.js로 이전). 라이브 docs 앱은
  `EXCLUDED_DIRS={v2.0.0, api-reference, images, ko}`로 api-reference를 라우팅에서 제외 → 디스크의
  5개 디렉터리는 stale leftover.
- **dead link**: `content/quickstart.md:102`가 렌더되지 않는 `/api-reference`를 가리킴.

## Decision Required

api-reference는 자동 생성물이라 hand-edit 금지. 둘 중 하나를 사용자가 결정해야 함:

- **옵션 A (권장) — 폐기(retire):** INFRA-BL-005 방향과 일치. `content/api-reference/`,
  `scripts/docs/docs-generator.js`, `typedoc.json`, 죽은 `/api-reference` 링크 제거. 최저 비용.
- **옵션 B — 복구·재생성:** `typedoc:convert` 스크립트 재도입 → 빌드 연결, 생성기가 `private` 스킵,
  `/api-reference` 라우트 추가 + EXCLUDED_DIRS에서 제외, 19개 공개 패키지 전부 재생성.

> 결정 후 해당 옵션만 구현한다. dead link 수정(quickstart.md)은 두 옵션 모두에 포함.

## Completion Criteria

- [x] TC-01: 사용자가 옵션 A/B 중 선택(결정 기록)
- [x] TC-02: 선택 옵션 구현 (A: 디렉터리/생성기/typedoc.json/링크 제거 · B: 재생성+라우팅+private 스킵)
- [x] TC-03: `content/quickstart.md`의 `/api-reference` dead link 해소(제거 또는 유효 라우트)
- [x] TC-04: `pnpm harness:scan` + `apps/docs` 빌드 통과

## Test Plan

| TC-ID | Test Type  | Approach                                                     |
| ----- | ---------- | ------------------------------------------------------------ |
| TC-01 | Decision   | 사용자 승인 문구 기록                                        |
| TC-02 | Build/Doc  | 옵션 A: 잔여 참조 0건 grep · 옵션 B: 19개 디렉터리 생성 확인 |
| TC-03 | Doc review | quickstart 링크 검증                                         |
| TC-04 | Build      | `apps/docs` build + `pnpm harness:scan`                      |

## User Execution Test Scenarios

옵션 B 채택 시: 사용자가 라이브 docs 사이트에서 `/api-reference` 경로를 열어 패키지 목록이 보이는지
확인(브라우저). 옵션 A 채택 시: Not applicable(생성물·링크 제거, 런타임/사이트 동작 무변경 — 죽은 링크
제거만).

## Tasks

- [x] 옵션 결정(사용자) → 구현 → quickstart 링크 수정 → docs 빌드/harness:scan

## Evidence Log

### 구현 완료 — 2026-06-16

- **TC-01 (결정):** 사용자가 **옵션 A(retire)** 선택 — "api-reference는 retire로 진행해".
- **TC-02 (retire 구현):**
  - `git rm scripts/docs/docs-generator.js`, `git rm typedoc.json`(둘은 서로만 참조 — 안전).
  - `content/api-reference/`(gitignore된 생성물 249파일) 로컬 삭제.
  - `.gitignore`의 `content/api-reference/` 항목 제거.
  - `apps/docs/src/lib/content.ts`·`sidebar.ts`의 `EXCLUDED_DIRS`에서 `'api-reference'` 제거.
- **TC-03 (dead link):** `content/quickstart.md`의 `[SDK API reference](/api-reference)` →
  `[Using the SDK](/guide/sdk)`로 교체.
- **TC-04:** `pnpm harness:scan` **26/26 passed**. (잔여: `docs-generator`/`typedoc.json` 참조 0건.)
- **잔여 메모(범위 외):** `package.json`의 `typedoc`/`typedoc-plugin-markdown` devDependencies는
  미사용으로 남음 — lockfile prune 리스크 회피를 위해 본 작업에선 제거하지 않음(후속 정리 후보).
