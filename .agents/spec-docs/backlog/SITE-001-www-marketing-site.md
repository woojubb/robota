---
status: review-ready
type: SCREEN
tags: [site, www, next-js, infra]
---

# SITE-001: www.robota.io 마케팅 랜딩 사이트 신설

## Problem

현재 `robota.io`는 VitePress 문서 사이트 하나에 마케팅·라이브러리 문서가 혼재되어 있다. 처음 방문한 개발자가 "이게 무엇인가"를 5초 안에 이해하기 어렵다.

재현 조건: `robota.io` 접속 → hero/랜딩 섹션 없음, 문서 사이트가 메인 랜딩으로 표시됨. `apps/www/` 디렉토리 존재하지 않음.

## Architecture Review

### Affected Scope

- `apps/www/` — Next.js 15 App Router + React 19 신규 앱 (현재 없음)
- `pnpm-workspace.yaml` — apps/www 등록 필요

### Alternatives Considered

- **Alt A (채택): Next.js 15 App Router + React 19 (apps/www 신규)** — Pro: Cost Calculator 등 interactive 요소 지원, apps/docs와 기술 스택 통일 가능. Con: Astro 등 정적 사이트 빌더보다 번들 크기 큰 편.
- **Alt B: Astro 정적 사이트** — Pro: 초경량 빌드, SEO 최적화. Con: frontend.md 규칙(React only)과 충돌, apps/www interactive 컴포넌트 지원 어려움.

### Decision

Alt A 채택. frontend.md 규칙(React only, Next.js for SSR)과 일치. `apps/www`에 Next.js 15 + Tailwind v4 + TypeScript로 초기화. Hero/랜딩 페이지, Header, Footer, SEO 메타 구현.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — pnpm-workspace.yaml, apps/docs 구조, frontend.md 규칙 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`apps/www/`에 Next.js 15 App Router 앱 초기화. `package.json` name: `robota-www`. Header(nav: Docs/Playground/GitHub), Hero(tagline + Install snippet + CTA), Footer, OG 메타태그, sitemap.xml, robots.txt 구현. `pnpm-workspace.yaml`에 등록.

## Affected Files

- `apps/www/package.json` (신규)
- `apps/www/src/app/page.tsx` (신규)
- `apps/www/src/components/Header.tsx` (신규)
- `apps/www/src/components/Footer.tsx` (신규)
- `pnpm-workspace.yaml`

## Completion Criteria

- [ ] TC-01: `pnpm --filter robota-www build` 명령이 오류 없이 완료됨
- [ ] TC-02: `pnpm --filter robota-www typecheck` 명령이 0 errors로 통과됨
- [ ] TC-03: `apps/www/src/app/page.tsx`가 Hero 섹션(tagline, Install snippet, CTA 버튼)을 렌더링하는 컴포넌트를 포함함
- [ ] TC-04: `apps/www/src/app/layout.tsx`에 OG 메타태그(`og:title`, `og:description`)가 설정됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                                    | Notes                                                  |
| ----- | --------- | -------------------------------------------------- | ------------------------------------------------------ |
| TC-01 | unit      | pnpm --filter robota-www build                     | Build exit code 0 — automated CI check                 |
| TC-02 | unit      | pnpm --filter robota-www typecheck                 | TypeScript 0 errors — automated CI check               |
| TC-03 | unit      | grep — page.tsx contains Install/CTA/tagline       | Automated string presence check in Hero component file |
| TC-04 | unit      | grep — layout.tsx contains og:title og:description | Automated string presence check for OG meta tags       |

## Tasks

- [ ] `.agents/tasks/SITE-001.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` ✅; `type: SCREEN` (valid from 11-prefix list) ✅; `tags: [site, www, next-js, infra]` ✅
- Problem section: concrete symptom present ("robota.io 접속 → hero/랜딩 섹션 없음, 문서 사이트가 메인 랜딩으로 표시됨"); reproduction condition stated ("robota.io 접속"); no TBD/TODO/vague single-sentence descriptions ✅
- Architecture Review Checklist: all 4 items `[x]` ✅; sibling scan `[x]` with explicit evidence ("pnpm-workspace.yaml, apps/docs 구조, frontend.md 규칙 확인") ✅
- Alternatives Considered: 2 entries (Alt A: Next.js 15, Alt B: Astro), each with Pro/Con ✅; Decision references trade-off ("frontend.md 규칙(React only, Next.js for SSR)과 일치") ✅
- Completion Criteria: 4 items (TC-01–TC-04), all with `TC-N` prefix ✅; each uses command form or observable behavior (exact CLI commands / file content checks) ✅; no forbidden vague language ("works correctly", "no errors", "implemented", "displays correctly") — TC-01/TC-02 specify exact commands with measurable exit conditions ✅
- Test Plan: section present ✅; 4 rows matching TC-01–TC-04 (count matches) ✅; all rows have non-empty Test Type and Tool/Approach, no TBD ✅; no "manual" rows requiring Notes justification ✅
- Structure: `## Tasks` section present with placeholder ✅; `## Evidence Log` section present and empty before this entry ✅; no `## Status` or `## Classification` sections in body ✅
- TC-N count: Completion Criteria = 4 (TC-01–TC-04), Test Plan rows = 4 — counts match ✅
