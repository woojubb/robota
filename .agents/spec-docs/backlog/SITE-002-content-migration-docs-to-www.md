---
status: review-ready
type: FLOW
tags: [site, www, docs, migration, content]
---

# SITE-002: 마케팅 콘텐츠 docs → www 이전 및 Cost Calculator React 재작성

## Problem

현재 VitePress docs에 마케팅 페이지(`/compare/`, `/showcase/`, `/roadmap`, `/enterprise/`, `/tools/cost-calculator`)가 혼재하고, `CostCalculator.vue`는 frontend.md 규칙(VitePress 외부에서 Vue 금지)을 위반하는 잠재 위험이 있다. SITE-001 완료 후 www로 이전해야 한다.

재현 조건: `apps/docs/.vitepress/theme/CostCalculator.vue` 존재 → Vue 컴포넌트가 VitePress 외부 컨텍스트에서 참조될 경우 frontend.md 규칙 위반. `apps/www/src/` 내 `/compare`, `/showcase`, `/roadmap`, `/enterprise` 경로 없음.

## Architecture Review

### Affected Scope

- `apps/www/src/app/` — compare, showcase, roadmap, enterprise, tools/cost-calculator 페이지 신규 추가
- `apps/www/src/components/CostCalculator.tsx` — Vue → React 재작성
- `apps/docs/.vitepress/` — nav에서 이전된 항목을 www 외부 링크로 교체
- `apps/docs/.vitepress/theme/CostCalculator.vue` — 삭제
- `content/compare/`, `content/enterprise/`, `content/showcase/`, `content/roadmap.md`, `content/tools/` — 삭제 (v2.0.0/ 제외)

### Alternatives Considered

- **Alt A (채택): www에 각 페이지 직접 구현 + docs nav를 외부 링크로 교체** — Pro: 이전 완료 후 docs는 라이브러리 문서에만 집중, Vue 위반 제거. Con: 페이지별 React 재구현 작업량.
- **Alt B: docs VitePress에 마케팅 콘텐츠 유지, CostCalculator만 React로 교체** — Pro: 작업량 최소. Con: docs/마케팅 혼재 구조 유지, 도메인 분리 목적 미달성.

### Decision

Alt A 채택. SITE-001 완료 후 각 마케팅 페이지를 www에 구현. CostCalculator는 React + useState/useMemo + Tailwind로 재작성. docs VitePress nav에서 이전된 항목은 www.robota.io 외부 링크로 교체.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — CostCalculator.vue 구현 확인, docs nav 구조 확인, content/ 디렉토리 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`apps/www/src/app/` 하위에 5개 마케팅 페이지 구현. `CostCalculator.vue`를 `CostCalculator.tsx`(React + Tailwind)로 재작성. docs `.vitepress/config`에서 이전된 nav 항목을 www.robota.io 링크로 교체. `CostCalculator.vue` 및 `content/` 마케팅 디렉토리 삭제.

## Affected Files

- `apps/www/src/app/compare/page.tsx` (신규)
- `apps/www/src/app/showcase/page.tsx` (신규)
- `apps/www/src/app/roadmap/page.tsx` (신규)
- `apps/www/src/app/enterprise/page.tsx` (신규)
- `apps/www/src/app/tools/cost-calculator/page.tsx` (신규)
- `apps/www/src/components/CostCalculator.tsx` (신규)
- `apps/docs/.vitepress/config/en.js` (nav 수정)
- `apps/docs/.vitepress/theme/CostCalculator.vue` (삭제)

## Completion Criteria

- [ ] TC-01: `pnpm --filter robota-www build` 실행 시 compare, showcase, roadmap, enterprise, cost-calculator 경로가 빌드 산출물에 포함됨
- [ ] TC-02: `apps/docs/.vitepress/theme/CostCalculator.vue` 파일이 존재하지 않음
- [ ] TC-03: `apps/www/src/components/CostCalculator.tsx`가 존재하고 `useState` 또는 `useMemo`를 import함
- [ ] TC-04: `pnpm --filter robota-docs build` 명령이 exit code 0을 반환하고 빌드 산출물이 생성됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                                     | Notes                                         |
| ----- | --------- | --------------------------------------------------- | --------------------------------------------- |
| TC-01 | unit      | pnpm --filter robota-www build + ls out/            | Build exit code 0, output directories present |
| TC-02 | unit      | find — CostCalculator.vue absence check             | Automated file absence check in apps/docs     |
| TC-03 | unit      | grep — CostCalculator.tsx contains useState/useMemo | Automated React hook import presence check    |
| TC-04 | unit      | pnpm --filter robota-docs build                     | docs build must still pass after nav changes  |

## Tasks

- [ ] `.agents/tasks/SITE-002.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-05-25

**Status remains:** draft
**Failed criteria:**

- Completion Criteria — TC-04 vague language: TC-04 reads "명령이 오류 없이 완료됨" which translates to "no errors" — a banned phrase per the GATE-WRITE criterion "No criterion uses: 'works correctly', 'no errors', 'implemented', 'displays correctly'". Must be rewritten as an observable output form (e.g., "exit code 0 반환" or "빌드 산출물 디렉토리 생성됨").
  **Required action:** Rewrite TC-04 to use a concrete observable behavior or command output form that does not use "no errors" or its Korean equivalent "오류 없이".

**All other checks passed:**

- Frontmatter: `status: draft` ✓, `type: FLOW` (valid 11-prefix value) ✓, `tags:` present ✓, file opens with `---` block ✓
- Problem section: concrete symptom (CostCalculator.vue 파일 존재, www 경로 누락) ✓, reproduction condition present ✓, no TBD/TODO ✓
- Architecture Review Checklist: all 4 items `[x]` ✓, sibling scan `[x]` with evidence ✓, 2 alternatives with pro/con (Alt A, Alt B) ✓, decision references trade-off ✓
- Completion Criteria TC count: TC-01 through TC-04 (4 items) — TC-01/02/03 pass phrasing check ✓, TC-04 FAIL (vague)
- Test Plan: section present ✓, 4 rows matching 4 TC-Ns ✓, all rows have non-empty Test Type and Tool/Approach ✓, no manual rows requiring Notes ✓
- Structure: Tasks section present with placeholder ✓, Evidence Log present and was empty ✓, no `## Status` or `## Classification` sections in body ✓

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present ✓, `status: draft` ✓, `type: FLOW` (valid 11-prefix value) ✓, `tags: [site, www, docs, migration, content]` ✓
- Problem section: concrete symptom (CostCalculator.vue 존재 + www 경로 4개 누락) ✓, reproduction condition (apps/docs 파일 존재 조건) ✓, no TBD/TODO/vague single-sentence ✓
- Architecture Review Checklist: all 4 items `[x]` ✓, sibling scan `[x]` with completion evidence ✓, 2 alternatives (Alt A, Alt B) each with pro/con ✓, decision references trade-off (작업량 vs 도메인 분리) ✓
- Completion Criteria: TC-01 through TC-04 all have TC-N prefix ✓, 4 criteria covering 5 pages + component + docs build ✓, TC-01 "빌드 산출물에 포함됨" (observable output) ✓, TC-02 "파일이 존재하지 않음" (observable behavior) ✓, TC-03 "파일 존재하고 useState/useMemo import" (observable behavior) ✓, TC-04 "exit code 0을 반환하고 빌드 산출물이 생성됨" (observable behavior, no banned phrases) ✓
- Test Plan: section present ✓, 4 rows matching 4 TC-Ns (count match confirmed) ✓, all rows have non-empty Test Type (unit) and Tool/Approach ✓, no TBD ✓, no manual rows requiring Notes ✓
- Structure: Tasks section present with placeholder ✓, Evidence Log section present ✓, no `## Status` or `## Classification` body sections ✓
- TC-N count match: Completion Criteria = 4 (TC-01–TC-04), Test Plan rows = 4 (TC-01–TC-04) ✓
