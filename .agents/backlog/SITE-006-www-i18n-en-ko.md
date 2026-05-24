---
title: 'SITE-006: www 사이트 i18n — en/ko 이중 언어 지원 (next-intl)'
status: todo
created: 2026-05-24
priority: medium
urgency: soon
area: apps/www
depends_on: []
---

## Background

`apps/www`는 현재 영어 하드코딩 텍스트만 지원한다. 한국 개발자 대상 마케팅 효과를 극대화하려면 한국어 페이지가 필요하다. Next.js 15 `output: 'export'` 정적 빌드에서 `next-intl` + `generateStaticParams`로 `/en/...` / `/ko/...` 두 locale을 빌드한다.

## 현재 상태

- Next.js 15 App Router, `output: 'export'`
- i18n 라이브러리 없음
- 하드코딩 문자열이 있는 파일:
  - `src/app/page.tsx` (205줄, 랜딩 페이지)
  - `src/app/compare/page.tsx` (312줄)
  - `src/app/enterprise/page.tsx` (223줄)
  - `src/app/roadmap/page.tsx` (170줄)
  - `src/app/showcase/page.tsx` (157줄)
  - `src/app/tools/cost-calculator/page.tsx`
  - `src/components/Header.tsx` (66줄)
  - `src/components/Footer.tsx` (114줄)
  - `src/components/CostCalculator.tsx`

## 작업 항목

### 1. next-intl 설치 및 기본 설정

```bash
pnpm --filter robota-www add next-intl
```

- `next.config.ts`에 `createNextIntlPlugin` 적용
- `src/i18n/routing.ts` — locales: `['en', 'ko']`, defaultLocale: `'en'`
- `src/i18n/request.ts` — `getRequestConfig` 구현 (정적 export용)
- `middleware.ts` — 루트(`/`) 접근 시 브라우저 언어에 따라 `/en` 또는 `/ko`로 리다이렉트

### 2. 라우팅 구조 변경

```
src/app/
  [locale]/               ← 새 dynamic segment
    layout.tsx            ← locale 주입
    page.tsx              ← 랜딩
    compare/page.tsx
    enterprise/page.tsx
    roadmap/page.tsx
    showcase/page.tsx
    tools/cost-calculator/page.tsx
```

- 기존 `src/app/*.tsx` 파일들을 `src/app/[locale]/` 하위로 이동
- 각 page에 `generateStaticParams` 추가: `return [{locale:'en'},{locale:'ko'}]`

### 3. 번역 사전 파일 작성

```
src/messages/
  en.json    ← 영어 원본 (기존 하드코딩 텍스트 추출)
  ko.json    ← 한국어 번역
```

키 네임스페이스 구조:

```json
{
  "common": { "nav": {...}, "footer": {...} },
  "home": { "hero": {...}, "features": {...}, "cta": {...} },
  "compare": { ... },
  "enterprise": { ... },
  "roadmap": { ... },
  "showcase": { ... },
  "costCalculator": { ... }
}
```

### 4. 컴포넌트 적용

- 모든 page/component에서 `useTranslations` 훅으로 하드코딩 텍스트 교체
- `Header.tsx`에 언어 전환 토글(en/ko) UI 추가 — 현재 locale 표시, 클릭 시 상대 locale URL로 이동
- `next/link` href에 `usePathname` + locale prefix 처리

### 5. SEO 처리

- `layout.tsx`에서 `<html lang={locale}>` 설정
- `alternate` hreflang 메타태그: `<link rel="alternate" hreflang="en" href="https://www.robota.io/en/..." />`
- `robots.txt` / `sitemap.xml`에 두 locale URL 포함

### 6. 빌드 검증

```bash
pnpm --filter robota-www build
# out/ 디렉터리에 en/*, ko/* 정적 파일 생성 확인
```

## 번역 범위 (ko.json 작성 대상)

우선 번역 대상 (마케팅 전환율 직결):

1. 랜딩 페이지 hero / CTA / features
2. Header nav
3. Footer

2차 번역: 4. Compare 페이지 (경쟁사 비교표) 5. Enterprise 페이지 6. Roadmap / Showcase

## 기술 결정

- **라이브러리**: `next-intl` — Next.js 15 App Router + static export 공식 지원
- **기본 locale**: `en` (URL prefix 없이 `/` 접근 → 리다이렉트 또는 `/en` 사용 결정 필요)
- **locale prefix 전략**: `always` — `/en/`, `/ko/` 모두 명시 (SEO canonical 명확화)
- **번역 자동화**: `ko.json` 초안은 AI 번역 후 사람이 검토

## Test Plan

- `pnpm --filter robota-www build` 성공, out/en/ + out/ko/ 파일 생성
- `/en` 페이지 영어 렌더링 확인
- `/ko` 페이지 한국어 렌더링 확인
- Header 언어 토글 작동 확인
- `<html lang>` attribute 각 locale별 올바른 값 확인

## User Execution Test Scenarios

### Scenario 1: 언어 전환

1. `http://localhost:3010/en` 접속 → 영어 랜딩 페이지
2. Header의 `KO` 버튼 클릭
3. `http://localhost:3010/ko`로 이동, 한국어 텍스트 표시

### Scenario 2: 정적 빌드 산출물

```bash
pnpm --filter robota-www build
ls apps/www/out/
# en/  ko/  확인
```
