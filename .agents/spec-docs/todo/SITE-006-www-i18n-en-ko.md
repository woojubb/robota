---
status: approved
type: BEHAVIOR
tags: [site, www, i18n, next-intl, localization]
---

# SITE-006: www 사이트 i18n — en/ko 이중 언어 지원 (next-intl)

## Problem

`apps/www`가 영어 하드코딩 텍스트만 지원한다. 한국 개발자 대상 마케팅 효과를 높이려면 `/ko/` 경로에서 한국어 페이지를 제공해야 한다.

재현 조건: `apps/www/src/app/` 디렉토리에 `[locale]` dynamic segment 없음. `http://localhost:3010/ko` 접속 → 404 또는 영어 페이지 표시.

## Architecture Review

### Affected Scope

- `apps/www/src/app/[locale]/` — 기존 page.tsx 파일들을 locale dynamic segment 하위로 이동
- `apps/www/src/messages/en.json`, `ko.json` — 번역 사전 파일
- `apps/www/src/i18n/routing.ts`, `request.ts` — next-intl 설정
- `apps/www/src/components/Header.tsx` — 언어 전환 토글 UI 추가

### Alternatives Considered

- **Alt A (채택): next-intl + `[locale]` dynamic segment + generateStaticParams** — Pro: Next.js 15 static export 공식 지원, `output: 'export'`와 호환. Con: 기존 app/ 파일 구조 전체 이동 필요.
- **Alt B: i18next + 수동 라우팅** — Pro: 더 많은 플러그인 생태계. Con: Next.js App Router static export와 통합 복잡, next-intl 대비 보일러플레이트 많음.

### Decision

Alt A 채택. next-intl은 Next.js 15 App Router + `output: 'export'`를 공식 지원. `locales: ['en', 'ko']`, `defaultLocale: 'en'`. locale prefix 전략 `always` — `/en/`, `/ko/` 모두 명시.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — apps/www/src/app/ 구조, next.config.ts, package.json 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`next-intl` 설치. `src/app/[locale]/`로 라우팅 구조 변경. `src/messages/en.json`, `ko.json` 번역 사전 작성. 각 page에 `generateStaticParams` 추가. Header에 언어 전환 토글(en/ko) 추가. `pnpm --filter robota-www build` 시 `out/en/`, `out/ko/` 정적 파일 생성.

## Affected Files

- `apps/www/package.json` (next-intl 추가)
- `apps/www/src/app/[locale]/` (신규 구조)
- `apps/www/src/messages/en.json` (신규)
- `apps/www/src/messages/ko.json` (신규)
- `apps/www/src/i18n/routing.ts` (신규)
- `apps/www/src/components/Header.tsx`

## Completion Criteria

- [ ] TC-01: `pnpm --filter robota-www build` 실행 후 `apps/www/out/en/` 디렉토리가 존재함
- [ ] TC-02: `pnpm --filter robota-www build` 실행 후 `apps/www/out/ko/` 디렉토리가 존재함
- [ ] TC-03: `apps/www/src/messages/ko.json` 파일이 존재하고 비어 있지 않음

## Test Plan

| TC-ID | Test Type | Tool / Approach                                  | Notes                                                |
| ----- | --------- | ------------------------------------------------ | ---------------------------------------------------- |
| TC-01 | unit      | pnpm --filter robota-www build + ls out/en/      | Build exit code 0, out/en/ directory present         |
| TC-02 | unit      | pnpm --filter robota-www build + ls out/ko/      | Build exit code 0, out/ko/ directory present         |
| TC-03 | unit      | find — apps/www/src/messages/ko.json exists + wc | Automated file existence and non-empty content check |

## Tasks

- [ ] `.agents/tasks/SITE-006.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present, `status: draft`, `type: BEHAVIOR` (valid from 11-prefix list), `tags: [site, www, i18n, next-intl, localization]` present.
- Problem section: concrete symptom present ("http://localhost:3010/ko 접속 → 404 또는 영어 페이지 표시"), reproduction condition present ("[locale] dynamic segment 없음"), no TBD/TODO/vague single-sentence.
- Architecture Review Checklist: all 4 items are `[x]`. Sibling scan `[x]` with explicit evidence ("apps/www/src/app/ 구조, next.config.ts, package.json 확인"). Alternatives: Alt A and Alt B each have Pro/Con listed. Decision references trade-off (static export compatibility drove choice of next-intl).
- Completion Criteria: 3 items (TC-01, TC-02, TC-03) — all have TC-N prefix, use command/observable-output form, no vague language ("works correctly" etc. absent).
- Test Plan: section present, 3 rows matching TC-01/TC-02/TC-03. Each row has non-empty Test Type ("unit") and Tool/Approach. No manual rows requiring Notes justification — all rows automated.
- Structure: `## Tasks` section present with placeholder, `## Evidence Log` present and was empty (first run). No `## Status` or `## Classification` sections in body.
- TC-N count match: Completion Criteria = 3 (TC-01, TC-02, TC-03); Test Plan rows = 3 (TC-01, TC-02, TC-03). ✅ Count matches.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: SITE group (SITE-001~007) + FRONTEND group (FRONTEND-001)
