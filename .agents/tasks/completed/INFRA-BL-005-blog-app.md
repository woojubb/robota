# INFRA-BL-005: Blog App

## Status: in-progress

## Summary

별도 도메인(blog.robota.io)으로 블로그를 만든다. Astro + Cloudflare Pages로 배포한다.

## Decision

- **프레임워크:** Astro (정적 빌드, Content Collections, RSS/sitemap 내장)
- **호스팅:** Cloudflare Pages (무제한 대역폭, 서울 PoP, D1/Workers 확장 가능)
- **디자인:** 프레젠테이션 터미널 테마 그대로 적용 (CSS 변수, JetBrains Mono + Noto Sans KR, dark theme)
- **위치:** `apps/blog` (pnpm workspace)
- **도메인:** blog.robota.io (별도 도메인, CF Pages에서 커스텀 도메인 연결)
- **DB:** 불필요 (정적 콘텐츠)

## Design Source

- `apps/docs/public/slides/how-coding-agent-works.html` — CSS 변수, 타이포그래피, 컬러 시스템
- 모바일 레이아웃(@media max-width: 800px) — 블로그 기본 레이아웃의 베이스

## First Content

- 현재 프레젠테이션 글("코딩 에이전트 CLI는 어떻게 만들까")을 블로그 첫 포스트로 이전
- 마크다운 소스: `apps/docs/public/slides/how-coding-agent-works.md`

## Implementation Steps

1. `apps/blog` Astro 프로젝트 생성
2. 프레젠테이션 CSS를 레이아웃에 적용
3. Content Collections 설정 (blog posts)
4. 첫 포스트 마크다운 이전
5. 글 목록 페이지 (index)
6. RSS + sitemap
7. Cloudflare Pages 배포 설정
8. blog.robota.io 도메인 연결
