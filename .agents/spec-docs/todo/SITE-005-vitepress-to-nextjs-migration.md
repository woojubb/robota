---
status: approved
type: SCREEN
tags: [site, docs, next-js, migration, vitepress]
---

# SITE-005: VitePress → Next.js docs 마이그레이션

## Problem

`apps/docs`가 VitePress(Vue 기반)로 운영 중이며 frontend.md 규칙이 React를 유일한 UI 프레임워크로 지정하고 VitePress를 "sole Vue exception"으로 한시적으로 허용하고 있다. Vue exception을 제거하고 apps/www와 기술 스택을 통일해야 한다.

재현 조건: `apps/docs/package.json`에 `vitepress` 의존성 존재 → frontend.md "VitePress is the sole Vue exception" 항목이 여전히 존재해야 함. `apps/docs/src/`에 Next.js App Router 구조 없음.

## Architecture Review

### Affected Scope

- `apps/docs/` — VitePress 완전 제거, Next.js 15 + `@next/mdx` + Tailwind v4로 전환
- `apps/docs/src/app/[[...slug]]/page.tsx` — catch-all 동적 라우팅으로 content/ 서빙
- `apps/docs/src/lib/sidebar.ts` — 빌드 타임 사이드바 트리 생성
- `.agents/rules/frontend.md` — VitePress sole Vue exception 항목 제거

### Alternatives Considered

- **Alt A (채택): Next.js 15 App Router + @next/mdx + rehype-pretty-code + pagefind** — Pro: frontend.md 규칙 완전 준수, apps/www와 컴포넌트 공유 가능, output:export로 Cloudflare Pages 호환. Con: 사이드바 자동 생성, 검색 등 VitePress 내장 기능을 별도 구현해야 함.
- **Alt B: Docusaurus(React 기반) 도입** — Pro: 검색/사이드바 내장, 학습 비용 낮음. Con: 외부 프레임워크 추가, apps/www와 다른 스택 유지, Tailwind 통합 복잡.

### Decision

Alt A 채택. frontend.md 규칙과 완전 정렬. content/ 디렉토리 구조 유지, `app/[[...slug]]/page.tsx`로 동적 라우팅. rehype-pretty-code(Shiki), pagefind 검색, next-themes 다크 모드.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — apps/docs 현재 구조, content/ 파일 수(272개+), wrangler.toml, frontend.md 규칙 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`apps/docs`를 Next.js 15 + `@next/mdx` + Tailwind v4로 재초기화. `app/[[...slug]]/page.tsx`로 `content/` 동적 라우팅. `lib/sidebar.ts`로 빌드 타임 사이드바 생성. rehype-pretty-code, remark-gfm, pagefind 검색, next-themes 적용. `output: 'export'`로 정적 빌드. VitePress 의존성 전체 제거. `frontend.md`의 VitePress 예외 항목 삭제.

## Affected Files

- `apps/docs/package.json`
- `apps/docs/next.config.ts` (신규)
- `apps/docs/src/app/[[...slug]]/page.tsx` (신규)
- `apps/docs/src/lib/sidebar.ts` (신규)
- `.agents/rules/frontend.md`

## Completion Criteria

- [ ] TC-01: `pnpm --filter robota-docs build` 명령이 오류 없이 완료되고 `out/` 정적 산출물이 생성됨
- [ ] TC-02: `pnpm --filter robota-docs typecheck` 명령이 0 errors로 통과됨
- [ ] TC-03: `apps/docs/package.json`에 `vitepress` 의존성이 없음
- [ ] TC-04: `content/v2.0.0/` 디렉토리가 삭제되지 않고 존재함

## Test Plan

| TC-ID | Test Type | Tool / Approach                                | Notes                                                |
| ----- | --------- | ---------------------------------------------- | ---------------------------------------------------- |
| TC-01 | unit      | pnpm --filter robota-docs build + ls out/      | Build exit code 0, out/ directory present            |
| TC-02 | unit      | pnpm --filter robota-docs typecheck            | TypeScript 0 errors                                  |
| TC-03 | unit      | grep — package.json does not contain vitepress | Automated absence check for VitePress dependency     |
| TC-04 | unit      | find — content/v2.0.0/ exists                  | Permanent preservation check — must never be deleted |

## Tasks

- [ ] `.agents/tasks/SITE-005.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: SCREEN` is a valid value from the 11-prefix list; `tags: [site, docs, next-js, migration, vitepress]` present.
- Problem section: concrete symptom (VitePress/Vue dependency in apps/docs conflicts with frontend.md React-only rule); reproduction condition (vitepress in package.json + no Next.js App Router structure in apps/docs/src/); no TBD/TODO/vague single-sentence descriptions.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan `[x]` with explicit evidence (apps/docs structure, content/ 272+ files, wrangler.toml, frontend.md rule); Alternatives Considered has 2 entries (Alt A and Alt B) each with Pro/Con; Decision references trade-off (frontend.md 규칙 완전 준수, apps/www 컴포넌트 공유).
- Completion Criteria: 4 items, all with TC-N prefix (TC-01–TC-04); at least 1 criterion per distinct feature; all use command or observable-behavior form; no vague language ("works correctly", "no errors", "implemented", "displays correctly") detected.
- Test Plan: `## Test Plan` section present; 4 rows matching TC-01–TC-04 (count matches Completion Criteria); each row has non-empty Test Type ("unit") and Tool/Approach; no manual rows present so Notes-for-manual check is N/A.
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and was empty (first GATE-WRITE run); no `## Status` or `## Classification` body sections found.
- TC-N count: 4 in Completion Criteria, 4 in Test Plan — counts match.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: SITE group (SITE-001~007) + FRONTEND group (FRONTEND-001)
