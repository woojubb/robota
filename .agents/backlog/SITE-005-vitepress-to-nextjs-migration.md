---
title: 'SITE-005: VitePress → Next.js docs 마이그레이션'
status: todo
created: 2026-05-23
priority: medium
urgency: later
area: apps/docs
depends_on: [SITE-003]
---

## Background

현재 `apps/docs`는 VitePress(Vue 기반) 로 운영 중이다.
`frontend.md` 규칙은 React를 유일한 UI 프레임워크로 지정하며, VitePress는 "sole Vue exception"으로
한시적으로 허용된 상태다.

이 백로그는 VitePress를 Next.js(App Router + MDX)로 전면 교체하여:

1. Vue exception을 제거하고 프론트엔드 스택을 React로 통일
2. `apps/www`와 동일한 기술 스택 및 컴포넌트 공유
3. Tailwind v4 + 공통 디자인 토큰 적용
4. Cloudflare Pages 정적 배포(`output: 'export'`) 유지

---

## 마이그레이션 범위

### 현재 VitePress 기능 → Next.js 대체 방안

| VitePress 기능                                       | Next.js 대체                                              |
| ---------------------------------------------------- | --------------------------------------------------------- |
| `.md` 파일 → 페이지 라우팅                           | `@next/mdx` + App Router 파일 기반 라우팅                 |
| 자동 사이드바 (`vite-plugin-vitepress-auto-sidebar`) | 빌드 타임 `fs` 스캔으로 sidebar tree 생성                 |
| 코드 블록 syntax highlighting                        | `rehype-pretty-code` (Shiki 기반)                         |
| Mermaid 다이어그램                                   | `rehype-mermaid` 또는 클라이언트 컴포넌트 래퍼            |
| 검색 (`vitepress` 내장)                              | `pagefind` (정적 사이트 전문 검색, Cloudflare Pages 호환) |
| 다크 모드                                            | `next-themes`                                             |
| OG/SEO 메타                                          | Next.js `Metadata` API                                    |
| `<CostCalculator />` Vue 컴포넌트                    | 이미 `apps/www`에 React로 재작성됨 → 공유 패키지 or 복사  |
| Sitemap 생성                                         | `next-sitemap` 또는 `app/sitemap.ts`                      |
| CNAME / public 파일                                  | `public/` 디렉토리 그대로 유지                            |

### 콘텐츠 구조 (변경 없음)

`content/` 디렉토리의 마크다운 파일 구조는 그대로 유지.
`copy-docs.js`의 복사 로직 대신 Next.js 빌드 시 `content/`를 직접 참조하거나
`next.config.ts`의 `pageExtensions`로 처리.

---

## 작업 항목

### 1단계 — 기반 설정

- [ ] `apps/docs` 패키지를 Next.js 15 + `@next/mdx` + Tailwind v4로 재초기화
- [ ] `content/` 디렉토리를 `srcDir`로 직접 사용하는 방법 확정
  - 옵션 A: `app/[[...slug]]/page.tsx`에서 `content/**/*.md` 동적 라우팅
  - 옵션 B: `next.config.ts`에서 `pageExtensions: ['tsx', 'md', 'mdx']` + 파일 복사
- [ ] rehype/remark 플러그인 체인 구성:
  - `rehype-pretty-code` (Shiki, `github-dark` 테마)
  - `rehype-slug` + `rehype-autolink-headings`
  - `remark-gfm` (표, 체크박스)
  - `remark-frontmatter` + `remark-mdx-frontmatter`

### 2단계 — 레이아웃 / 내비게이션

- [ ] `DocsLayout` 컴포넌트: 좌측 사이드바 + 우측 ToC + 메인 콘텐츠
- [ ] 빌드 타임 사이드바 트리 생성 (`lib/sidebar.ts`):
  - `content/` 디렉토리 재귀 스캔
  - frontmatter `title` 또는 파일명으로 제목 결정
  - 지정된 폴더 순서 적용 (guide → getting-started → examples → packages 순)
- [ ] 우측 ToC (Table of Contents): MDX `rehype-slug`로 생성된 `#heading` 추출
- [ ] 검색: `pagefind` 빌드 후 정적 검색 인덱스 생성 + `SearchBox` 컴포넌트
- [ ] 다크 모드: `next-themes` + CSS 커스텀 프로퍼티 (apps/www 디자인 토큰 공유)
- [ ] `← robota.io` 상단 링크 (apps/www Header 패턴 동일)

### 3단계 — 특수 기능

- [ ] Mermaid 렌더링: `<MermaidDiagram>` 클라이언트 컴포넌트 (mermaid.js 동적 import)
- [ ] 코드 블록 복사 버튼 (`<CodeBlock>` 래퍼)
- [ ] `<Callout>` 컴포넌트 (info / warning / danger 3종)
- [ ] `<PackageManagerTabs>` 컴포넌트 (npm / pnpm / yarn 탭)

### 4단계 — 빌드 / 배포

- [ ] `output: 'export'` 정적 빌드 검증 (Cloudflare Pages 호환)
- [ ] `pagefind` 인덱스 빌드 스크립트 통합 (`postbuild` 훅)
- [ ] `wrangler.toml` 유지 (project: `robota-docs`, domain: `docs.robota.io`)
- [ ] 기존 `copy-docs.js`, `copy-public.js` 스크립트 제거
- [ ] VitePress 관련 의존성 전체 제거

### 5단계 — 검증

- [ ] 전체 마크다운 페이지 정상 렌더링 확인 (특히 코드 블록, 표, Mermaid)
- [ ] 사이드바 순서 VitePress 동일 수준 검증
- [ ] 검색 기능 동작 확인
- [ ] `pnpm --filter robota-docs typecheck` 통과
- [ ] `pnpm --filter robota-docs build` 통과
- [ ] Cloudflare Pages 배포 및 `docs.robota.io` 정상 서빙 확인

---

## 의존성 스택 (예상)

```json
{
  "dependencies": {
    "next": "15.x",
    "react": "19.x",
    "react-dom": "19.x",
    "@next/mdx": "15.x",
    "next-themes": "^0.4",
    "remark-gfm": "^4",
    "remark-frontmatter": "^5",
    "remark-mdx-frontmatter": "^4",
    "rehype-pretty-code": "^0.14",
    "rehype-slug": "^6",
    "rehype-autolink-headings": "^7",
    "shiki": "^1",
    "mermaid": "^11"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "tailwindcss": "^4",
    "pagefind": "^1",
    "typescript": "^5"
  }
}
```

---

## 주의 사항

- `content/v2.0.0/` 절대 삭제 금지 (영구 보존 대상, 메모리 참조)
- `frontend.md` 규칙에 따라 VitePress 완전 제거 후 Vue exception 항목 삭제
- 마이그레이션 완료 전까지 기존 VitePress + CF Pages 병행 운영
- 검색 솔루션: Algolia DocSearch 대신 `pagefind` 우선 (self-hostable, 무료)

---

## Test Plan

- `pnpm --filter robota-docs typecheck` — 0 errors
- `pnpm --filter robota-docs build` — static export 성공
- `pnpm --filter robota-docs deploy` — CF Pages 배포 성공
- 전체 docs 페이지 브라우저 렌더링 확인 (코드 블록, Mermaid, 표, 체크박스)
- 검색: 키워드 입력 → 정확한 결과 반환

## User Execution Test Scenarios

1. `docs.robota.io` 방문 → 좌측 사이드바 구조가 VitePress와 동일하게 표시
2. 사이드바에서 임의 페이지 클릭 → 마크다운 콘텐츠 정상 렌더링
3. 코드 블록 복사 버튼 클릭 → 클립보드에 코드 복사
4. 검색창에 "Getting Started" 입력 → 관련 페이지 즉시 표시
5. 다크 모드 토글 → 전체 페이지 다크/라이트 전환
6. `← robota.io` 링크 클릭 → `www.robota.io` 이동
