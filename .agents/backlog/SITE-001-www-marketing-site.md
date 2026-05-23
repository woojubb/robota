---
title: 'SITE-001: www.robota.io 마케팅 랜딩 사이트 신설'
status: todo
created: 2026-05-23
priority: high
urgency: soon
area: apps/www (신규)
depends_on: []
---

## Background

현재 `robota.io`는 VitePress 문서 사이트 하나에 라이브러리 문서·마케팅·도구·엔터프라이즈 등이 혼재되어 있다.
일반 사용자(개발자가 아닌 잠재 고객)가 처음 robota.io에 접속했을 때 "이게 무엇인가"를 5초 안에 이해하기 어렵다.

www.robota.io는 **일반 사용자 대상 마케팅/랜딩 사이트**로, docs와 완전히 분리하여 운영한다.

## 콘텐츠 범위 (www.robota.io에 들어갈 것)

| 페이지                   | 현재 위치                | 비고                          |
| ------------------------ | ------------------------ | ----------------------------- |
| Hero / 랜딩              | 없음 (신규)              | robota가 무엇인지 5초 설명    |
| Why Robota (비교)        | `/compare/`              | 이전                          |
| Cost Calculator          | `/tools/cost-calculator` | Vue → React 재작성 (SITE-002) |
| Showcase                 | `/showcase/`             | 이전                          |
| Roadmap                  | `/roadmap`               | 이전                          |
| Enterprise               | `/enterprise/`           | 이전                          |
| Pricing (BYOK 모델 설명) | 없음 (신규)              | Claude Code $20 vs BYOK 설명  |
| Playground 링크          | 외부 링크                | play.robota.io 로 연결        |
| Blog 링크                | blog.robota.io (별도)    | 링크만                        |
| Docs 링크                | 없음 → docs.robota.io    | 헤더 상단 노출                |

## 기술 스택

- **프레임워크**: Next.js 15 App Router + React 19
- **스타일링**: Tailwind CSS (frontend.md 규칙)
- **위치**: `apps/www/` (신규 monorepo 앱)
- **패키지명**: `robota-www`

> apps/blog는 Astro로 별도 운영 중. www는 interactive 요소(Cost Calculator 등)가 있으므로 Next.js 채택.

## 작업 항목

1. `apps/www/` Next.js 15 앱 초기화
   - pnpm workspace 등록
   - Tailwind v4 설정
   - `tsconfig.json`, `package.json` 구성
2. 레이아웃 설계
   - Header: logo, nav (Docs / Playground / GitHub), CTA 버튼
   - Footer: links, copyright
3. Hero 페이지 구현 (`/`)
   - tagline, sub-copy, Install snippet, CTA (Get Started → docs.robota.io)
   - 제품 스크린샷 또는 코드 애니메이션
4. Nav 항목 라우팅 연결 (실제 콘텐츠 이전은 SITE-002에서)
5. OG/SEO 메타태그, sitemap.xml, robots.txt

## 도메인

- 개발: `localhost:3000` (또는 빈 포트)
- 배포: Vercel 프로젝트 신규 생성 → `www.robota.io` 도메인 연결

## Test Plan

- `pnpm --filter robota-www build` pass
- `pnpm --filter robota-www typecheck` pass
- Hero 페이지 lighthouse score ≥ 90

## User Execution Test Scenarios

Not applicable — web marketing site.
