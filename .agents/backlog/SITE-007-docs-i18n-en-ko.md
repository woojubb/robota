---
title: 'SITE-007: docs 사이트 i18n — en/ko 이중 언어 지원 (next-intl + content/ko/)'
status: done
created: 2026-05-24
priority: medium
urgency: soon
area: apps/docs
depends_on: ['SITE-006']
---

## Background

`apps/docs`는 현재 영어 `.md` 파일만 서빙한다 (272개, `content/` + `packages/*/docs/`). 한국어 개발자 온보딩을 위해 주요 페이지의 한국어 번역을 제공하고, 번역이 없는 페이지는 영어로 fallback한다.

docs 앱은 geistdocs 템플릿이 아닌 **커스텀 Next.js 15 + MDX 파이프라인**이므로 next-intl을 활용해 직접 구현한다.

## 현재 상태

- Next.js 15 App Router, `output: 'export'`
- `src/app/[[...slug]]/page.tsx` — catch-all route로 모든 docs 서빙
- `src/lib/content.ts` — `content/` + `packages/*/docs/` 에서 `.md` 파일 로드
- `src/lib/sidebar.ts` — 사이드바 구조 생성
- UI 문자열: Header, Sidebar, TOC 등에 영어 하드코딩
- i18n 라이브러리 없음

## URL 구조 결정

```
/docs/...          → 영어 (현재 URL 유지, 기존 링크 보존)
/ko/docs/...       → 한국어 (번역 파일 없으면 영어 fallback)
```

**왜 영어에 prefix 없이?**: 기존 외부 링크/SEO 보존. 영어가 primary locale.

## 작업 항목

### Phase 1 — 라우팅 + 인프라

1. **next-intl 설치 및 설정**

   ```bash
   pnpm --filter robota-docs add next-intl
   ```

   - `src/i18n/routing.ts`: `locales: ['en', 'ko']`, `defaultLocale: 'en'`, prefix: `as-needed`
   - `src/i18n/request.ts`: `getRequestConfig` (정적 export용)
   - `middleware.ts`: locale 감지 + 리다이렉트

2. **라우팅 구조 변경**

   ```
   src/app/
     [[...slug]]/page.tsx      ← 영어 (prefix 없음)
     ko/[[...slug]]/page.tsx   ← 한국어 (또는 [locale]/[[...slug]]로 통합)
   ```

   또는 통합 방식:

   ```
   src/app/
     (en)/[[...slug]]/page.tsx
     (ko)/[[...slug]]/page.tsx
   ```

   **추천: `[locale]/[[...slug]]`** — `en`은 rewrite로 prefix 제거, `ko`는 명시

3. **`content.ts` + `sidebar.ts` locale 파라미터 수용**
   - `getAllSlugs(locale)`, `getFilePath(slug, locale)`, `getPageContent(slug, locale)`
   - locale별 content 디렉터리 탐색: 먼저 `content/ko/`, fallback `content/en/` (또는 `content/`)
   - `buildSidebar(locale)` — locale에 따라 번역된 title 사용

4. **UI 문자열 번역 파일**

   ```
   src/messages/
     en.json    ← Header, Sidebar, TOC, SearchButton 등 UI 텍스트
     ko.json
   ```

5. **Header에 언어 전환 토글** (SITE-006 공통 패턴)
   - 현재 페이지 기준 `/ko/...` ↔ `/docs/...` 전환 링크

### Phase 2 — 콘텐츠 구조

**콘텐츠 디렉터리 전략**:

```
content/            ← 기존 영어 콘텐츠 (변경 없음)
content/ko/         ← 한국어 번역 파일 (점진적으로 추가)
  getting-started/
  guide/
  ...
```

`getFilePath(slug, 'ko')` 로직:

1. `content/ko/<slug>.md` 존재하면 반환
2. 없으면 `content/<slug>.md` fallback (영어)
3. fallback 시 페이지 상단에 "이 페이지는 아직 번역되지 않았습니다" 배너 표시

**번역 파일 네이밍**: geistdocs 방식(`file.ko.md`)이 아닌 **디렉터리 분리** 방식 사용. 이유: 기존 `content/`의 수백 개 파일에 접미사 추가 없이 점진적 번역 가능.

### Phase 3 — 번역 실행 (콘텐츠)

**우선순위 번역 대상** (온보딩 전환율 직결):

| 우선순위 | 대상                                                        | 파일 수 |
| -------- | ----------------------------------------------------------- | ------- |
| P0       | `content/getting-started/`                                  | ~5개    |
| P0       | `content/guide/README.md` + `cli.md` + `building-agents.md` | 3개     |
| P1       | `content/guide/` 전체                                       | ~8개    |
| P2       | `content/changelog/` 최신 항목                              | ~5개    |
| P3       | `packages/*/docs/SPEC.md` (기술 참조, 영어 유지 가능)       | —       |

번역 방식: AI 번역 초안 생성 → 사람 검토. 기술 용어(패키지명, API명)는 번역하지 않음.

### Phase 4 — SEO + 빌드

- `<html lang={locale}>` 설정
- `<link rel="alternate" hreflang="en" href="..." />` / `hreflang="ko"` 상호 참조
- `generateStaticParams`에서 `['en', 'ko'] × 모든슬러그` 조합 생성
- `pnpm --filter robota-docs build` 검증

## 기술 결정

| 항목              | 결정                         | 이유                                 |
| ----------------- | ---------------------------- | ------------------------------------ |
| i18n 라이브러리   | `next-intl`                  | SITE-006과 동일, static export 지원  |
| 영어 URL prefix   | 없음 (`/docs/...`)           | 기존 링크 보존                       |
| 한국어 URL prefix | `/ko/docs/...`               | 명시적, SEO 구분                     |
| 번역 파일 위치    | `content/ko/` 별도 디렉터리  | 점진적 번역, 기존 파일 무수정        |
| 번역 없는 페이지  | 영어 fallback + 안내 배너    | 미번역 페이지도 한국어 URL 접근 가능 |
| packages/\*/docs  | 영어만 (SPEC.md는 기술 문서) | 번역 가성비 낮음                     |

## Test Plan

- `pnpm --filter robota-docs build` 성공
- `/docs/getting-started` → 영어 렌더링
- `/ko/docs/getting-started` → 한국어 렌더링 (번역 파일 있음)
- `/ko/docs/api-reference/agent-core` → 영어 fallback + 안내 배너
- Header 언어 전환 버튼 `/docs/...` ↔ `/ko/docs/...` 전환
- `<html lang="ko">` 한국어 페이지에 적용 확인

## User Execution Test Scenarios

### Scenario 1: 한국어 getting-started 접근

```
http://localhost:3020/ko/docs/getting-started
```

Expected: 한국어로 번역된 getting started 페이지

### Scenario 2: 미번역 페이지 fallback

```
http://localhost:3020/ko/docs/api-reference/agent-core
```

Expected: 영어 내용 + "이 페이지는 아직 번역 중입니다" 상단 안내 배너

### Scenario 3: 언어 전환

```
/docs/guide/cli → Header KO 클릭 → /ko/docs/guide/cli
```
